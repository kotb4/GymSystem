import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp, todayKey, addDaysKey } from "@/core/dates";
import { getExpiryThresholds, getInactiveDays, readSetting, SETTING_KEYS } from "./settings.service";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, memberDepartmentById } from "./department";

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function stamp(): string {
  return nowStamp();
}

// ------------------------------ templates --------------------------------

export interface CrmTemplate {
  code: string;
  bodyAr: string;
  isActive: boolean;
}

export function listTemplates(db: Db, actor: ServiceActor, includeInactive = true): CrmTemplate[] {
  requirePermission(actor, "crm.templates");
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return db
    .all<Row>(`SELECT * FROM crm_templates ${where} ORDER BY code`)
    .map((r) => ({ code: str(r.code), bodyAr: str(r.body_ar), isActive: num(r.is_active, 1) === 1 }));
}

/** Safe {{var}} substitution - no eval; unknown placeholders left intact. */
export function renderTemplate(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}

export async function upsertTemplate(
  db: Db,
  actor: ServiceActor,
  input: { code: string; bodyAr: string; isActive?: boolean },
): Promise<CrmTemplate> {
  requirePermission(actor, "crm.templates");
  const code = input.code.trim();
  if (!/^[a-z_]{2,40}$/.test(code)) throw errValidation("errors.crm.templateCodeInvalid");
  const body = input.bodyAr.trim();
  if (body.length < 5) throw errValidation("errors.crm.templateBodyShort");
  await db.transaction(async () => {
    db.run(
      "INSERT INTO crm_templates (code, body_ar, is_active, updated_at)\nVALUES (?, ?, ?, ?)\nON CONFLICT(code) DO UPDATE SET body_ar = excluded.body_ar, is_active = excluded.is_active, updated_at = excluded.updated_at",
      [code, body, input.isActive === false ? 0 : 1, stamp()],
    );
    recordAudit(db, actor, "CRM_TEMPLATE_UPDATED", "crm_template", code, {});
  });
  return { code, bodyAr: body, isActive: input.isActive !== false };
}

// ------------------------------- queue -----------------------------------

export type CrmStatus =
  | "pending"
  | "sent"
  | "manual_opened"
  | "failed"
  | "skipped_no_provider"
  | "skipped_no_phone";

export interface QueueMessageInput {
  memberId: string;
  templateCode?: string;
  customBody?: string;
  channel?: string;
  vars?: Record<string, string | number>;
  /** Deterministic dedupe id; duplicates return the existing row silently. */
  dedupeKey?: string;
}

function memberPhone(db: Db, memberId: string): { phone: string | null; name: string } {
  const mRow = db.first<Row>("SELECT full_name, phone FROM members WHERE id = ?", [memberId]);
  if (!mRow) throw errNotFound("errors.memberNotFound");
  const phone = mRow.phone == null || str(mRow.phone) === "" ? null : str(mRow.phone);
  return { phone, name: str(mRow.full_name) };
}

/**
 * Queue one message. Duplicate dedupe keys never spam: the existing row is
 * returned with duplicate=true instead of inserting again.
 */
export async function queueMessage(
  db: Db,
  actor: ServiceActor,
  input: QueueMessageInput,
): Promise<{ id: string; status: CrmStatus; duplicate: boolean }> {
requirePermission(actor, "crm.send");
assertDepartmentAccess(actor, memberDepartmentById(db, String(input.memberId)));

  let body: string;
  if (input.customBody && input.customBody.trim()) {
    body = input.customBody.trim();
  } else if (input.templateCode) {
    const tpl = db.first<Row>("SELECT body_ar, is_active FROM crm_templates WHERE code = ?", [
      input.templateCode,
    ]);
    if (!tpl) throw errNotFound("errors.crm.templateNotFound");
    if (num(tpl.is_active, 1) !== 1) throw errValidation("errors.crm.templateInactive");
    body = renderTemplate(str(tpl.body_ar), input.vars ?? {});
  } else {
    throw errValidation("errors.crm.emptyMessage");
  }

  const { phone } = memberPhone(db, input.memberId);
  const status: CrmStatus = phone ? "pending" : "skipped_no_phone";
  const dedupe = input.dedupeKey ?? null;

  if (dedupe) {
    const existing = db.first<Row>("SELECT id, status FROM crm_messages WHERE dedupe_key = ?", [dedupe]);
    if (existing) return { id: str(existing.id), status: str(existing.status) as CrmStatus, duplicate: true };
  }

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO crm_messages (id, member_id, template_code, channel, body, phone, status, dedupe_key, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.memberId,
        input.templateCode ?? "custom",
        input.channel ?? "whatsapp",
        body,
        phone,
        status,
        dedupe,
        actor.userId,
        stamp(),
      ],
    );
    recordAudit(db, actor, "CRM_MESSAGE_QUEUED", "member", input.memberId, {
      template: input.templateCode ?? "custom",
      status,
    });
  });
  return { id, status, duplicate: false };
}
// --------------------------- providers / send ----------------------------

export interface CrmMessageRow {
  id: string;
  memberId: string;
  memberName: string;
  templateCode: string | null;
  channel: string;
  body: string;
  phone: string | null;
  status: CrmStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

const MSG_SELECT =
  "SELECT cm.*, m.full_name AS member_name FROM crm_messages cm JOIN members m ON m.id = cm.member_id";

function mapMessage(r: Row): CrmMessageRow {
  return {
    id: str(r.id),
    memberId: str(r.member_id),
    memberName: str(r.member_name),
    templateCode: r.template_code == null ? null : str(r.template_code),
    channel: str(r.channel),
    body: str(r.body),
    phone: r.phone == null ? null : str(r.phone),
    status: str(r.status) as CrmStatus,
    error: r.error == null ? null : str(r.error),
    createdAt: str(r.created_at),
    sentAt: r.sent_at == null ? null : str(r.sent_at),
  };
}

export function listMessages(
  db: Db,
  actor: ServiceActor,
  query: { status?: CrmStatus | "all"; memberId?: string; limit?: number } = {},
): CrmMessageRow[] {
  requirePermission(actor, "crm.send");
  const limit = Math.min(300, Math.max(1, query.limit ?? 80));
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (query.status && query.status !== "all") {
    conditions.push("cm.status = ?");
    params.push(query.status);
  }
  if (query.memberId) {
    conditions.push("cm.member_id = ?");
    params.push(query.memberId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<Row>(`${MSG_SELECT} ${where} ORDER BY cm.created_at DESC LIMIT ?`, [...params, limit])
    .map(mapMessage);
}

export type TransportResult = { ok: true } | { ok: false; error: string };
export type MessageTransport = (phone: string, body: string) => Promise<TransportResult>;

/** Mock transport (tests / demo): always succeeds without touching the network. */
export const mockTransport: MessageTransport = async () => ({ ok: true });

/**
 * Real WhatsApp provider. Only used when the gym configured it in settings.
 * Offline-first: any network problem surfaces as a failed message, never as
 * an application error, and never blocks the local database.
 */
export const whatsappTransport =
  (apiUrl: string): MessageTransport =>
  async (phone, body) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: body }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error instanceof Error ? error.message : error) };
    }
  };

function resolveTransport(db: Db): { transport: MessageTransport | null; provider: "mock" | "whatsapp" | "none" } {
  if (envFlag("GYM_CRM_MOCK")) return { transport: mockTransport, provider: "mock" };
  const enabled = readSetting(db, SETTING_KEYS.whatsappEnabled) === "1";
  const apiUrl = readSetting(db, SETTING_KEYS.whatsappApiUrl) ?? "";
  if (enabled && apiUrl.trim() !== "") {
    return { transport: whatsappTransport(apiUrl.trim()), provider: "whatsapp" };
  }
  return { transport: null, provider: "none" };
}

function envFlag(name: string): boolean {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return proc.process?.env?.[name] === "1";
}

/**
 * Attempt delivery of pending messages through the resolved provider.
 * Without a configured provider everything is marked skipped_no_provider so
 * the queue stays honest instead of pretending messages were delivered.
 */
export async function sendPendingMessages(
  db: Db,
  actor: ServiceActor,
  limit = 50,
): Promise<{ sent: number; failed: number; skipped: number }> {
  requirePermission(actor, "crm.send");
  const { transport, provider } = resolveTransport(db);
  const pending = db
    .all<Row>(
      `${MSG_SELECT} WHERE cm.status = 'pending' ORDER BY cm.created_at ASC LIMIT ?`,
      [Math.min(200, Math.max(1, limit))],
    )
    .map(mapMessage);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const msg of pending) {
    if (!transport) {
      db.run("UPDATE crm_messages SET status = 'skipped_no_provider' WHERE id = ?", [msg.id]);
      skipped++;
      continue;
    }
    try {
      const result = await transport(msg.phone!, msg.body);
      if (result.ok) {
        db.run("UPDATE crm_messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [
          stamp(),
          msg.id,
        ]);
        recordAudit(db, actor, "CRM_MESSAGE_SENT", "member", msg.memberId, { provider });
        sent++;
      } else {
        db.run("UPDATE crm_messages SET status = 'failed', error = ? WHERE id = ?", [
          result.error,
          msg.id,
        ]);
        recordAudit(db, actor, "CRM_MESSAGE_FAILED", "member", msg.memberId, { error: result.error });
        failed++;
      }
    } catch (error) {
      db.run("UPDATE crm_messages SET status = 'failed', error = ? WHERE id = ?", [String(error), msg.id]);
      failed++;
    }
  }

  return { sent, failed, skipped };
}

/** Staff opened WhatsApp manually (web/click-to-chat) - honest manual state. */
export async function markManuallySent(db: Db, actor: ServiceActor, messageId: string): Promise<void> {
  requirePermission(actor, "crm.send");
  const row = db.first<Row>("SELECT id FROM crm_messages WHERE id = ?", [messageId]);
  if (!row) throw errNotFound("errors.crm.messageNotFound");
  await db.transaction(async () => {
    db.run("UPDATE crm_messages SET status = 'manual_opened', sent_at = ? WHERE id = ?", [
      stamp(),
      messageId,
    ]);
    recordAudit(db, actor, "CRM_MESSAGE_SENT", "member", messageId, { provider: "manual" });
  });
}
// ----------------------------- automation --------------------------------

export interface GenerateDueResult {
  queued: number;
  duplicates: number;
  skippedNoPhone: number;
}

function gymName(db: Db): string {
  return str(db.scalar("SELECT value FROM settings WHERE key = 'gym_name'") ?? "الجيم");
}

/**
 * Offline-first automation scan. Builds the due-message list from local data
 * and queues it with deterministic dedupe keys, so running this daily (or on
 * every boot) never duplicates messages. Delivery happens separately via
 * sendPendingMessages - queuing never requires internet.
 */
export async function generateDueMessages(db: Db, actor: ServiceActor): Promise<GenerateDueResult> {
  requirePermission(actor, "crm.send");
  const today = todayKey();
  const gym = gymName(db);
  const monthKey = today.slice(0, 7);
  let queued = 0;
  let duplicates = 0;
  let noPhone = 0;

  const run = async (
    memberId: string,
    templateCode: string,
    vars: Record<string, string | number>,
    dedupeKey: string,
  ) => {
    const res = await queueMessage(db, actor, { memberId, templateCode, vars, dedupeKey });
    if (res.duplicate) duplicates++;
    else {
      queued++;
      if (res.status === "skipped_no_phone") noPhone++;
    }
  };

  // 1) expiring subscriptions (within the largest configured window)
  const thresholds = getExpiryThresholds(db);
  const window = thresholds.length > 0 ? Math.max(...thresholds) : 7;
  const horizonEnd = addDaysKey(today, window);
  const expiring = db.all<Row>(
    "SELECT s.id AS sub_id, s.end_date, s.member_id, m.full_name AS member_name, p.name AS plan_name\nFROM member_subscriptions s\nJOIN members m ON m.id = s.member_id\nJOIN membership_plans p ON p.id = s.plan_id\nWHERE s.status = 'active' AND s.end_date >= ? AND s.end_date <= ?",
    [today, horizonEnd],
  );
  for (const row of expiring) {
    const days = Math.max(
      0,
      Math.round((Date.parse(`${str(row.end_date)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
    );
    await run(str(row.member_id), "expiry_reminder", {
      name: str(row.member_name),
      plan: str(row.plan_name),
      days,
      end: str(row.end_date),
      gym,
    }, `expiry:${str(row.sub_id)}:${str(row.end_date)}`);
  }

  // 2) birthdays today
  const mmdd = today.slice(5);
  const birthdays = db.all<Row>(
    "SELECT id, full_name FROM members WHERE deleted_at IS NULL AND substr(date_of_birth, 6) = ?",
    [mmdd],
  );
  for (const b of birthdays) {
    await run(str(b.id), "birthday", { name: str(b.full_name), gym }, `bday:${str(b.id)}:${today}`);
  }

  // 3) inactive members (no visit within configured window, has active sub)
  const inactiveDays = getInactiveDays(db);
  const cutoffStamp = `${addDaysKey(today, -inactiveDays)} 23:59:59`;
  const inactive = db.all<Row>(
    "SELECT m.id, m.full_name FROM members m\nWHERE m.deleted_at IS NULL AND m.status = 'active'\nAND EXISTS (SELECT 1 FROM member_subscriptions s WHERE s.member_id = m.id AND s.status = 'active' AND s.end_date >= ?)\nAND COALESCE((SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id), '') <= ?",
    [today, cutoffStamp],
  );
  for (const row of inactive) {
    await run(str(row.id), "inactive", { name: str(row.full_name), days: inactiveDays, gym }, `inactive:${str(row.id)}:${monthKey}`);
  }

  // 4) gym subscription debt (one reminder per member per month)
  const gymDebts = db.all<Row>(
    "WITH paid AS (\n  SELECT subscription_id, SUM(paid_amount_minor) AS paid_minor FROM payments\n  WHERE subscription_id IS NOT NULL AND status IN ('partial','paid') GROUP BY subscription_id\n)\nSELECT DISTINCT s.member_id, m.full_name AS member_name,\n  SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(p.paid_minor,0), 0)) OVER (PARTITION BY s.member_id) AS remaining_minor\nFROM member_subscriptions s\nLEFT JOIN paid p ON p.subscription_id = s.id\nJOIN members m ON m.id = s.member_id\nWHERE s.status = 'active'",
  );
  for (const row of gymDebts) {
    const remaining = num(row.remaining_minor);
    if (remaining <= 0) continue;
    await run(str(row.member_id), "gym_debt", {
      name: str(row.member_name),
      balance: (remaining / 100).toFixed(2),
      gym,
    }, `gymdebt:${str(row.member_id)}:${monthKey}`);
  }

  // 5) open store debts
  const storeDebts = db.all<Row>(
    "SELECT d.member_id, m.full_name AS member_name, SUM(d.original_minor - d.paid_minor) AS remaining_minor\nFROM store_debts d JOIN members m ON m.id = d.member_id\nWHERE d.status = 'open' GROUP BY d.member_id",
  );
  for (const row of storeDebts) {
    const remaining = num(row.remaining_minor);
    if (remaining <= 0) continue;
    await run(str(row.member_id), "store_debt", {
      name: str(row.member_name),
      balance: (remaining / 100).toFixed(2),
      gym,
    }, `storedebt:${str(row.member_id)}:${monthKey}`);
  }

  return { queued, duplicates, skippedNoPhone: noPhone };
}