import { addDaysKey, diffDaysKeys, nextAnniversaryKey, nowStamp, todayKey } from "@/core/dates";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById, type MemberRow } from "./members.service";
import { assertDepartmentAccess, departmentScopeCondition } from "./department";
import {
  getMessagesAbsentDays,
  getMessagesBirthdayDays,
  getMessagesExpiryDays,
  readSetting,
  SETTING_KEYS,
} from "./settings.service";
import {
  mockTransport,
  whatsappTransport,
  type CardDeliveryStatus,
} from "./card-delivery.service";

export type MessageSegment = "absent" | "birthday" | "expiry";
export type MessageStatus = CardDeliveryStatus;

export const MESSAGE_SEGMENTS: readonly MessageSegment[] = ["absent", "birthday", "expiry"];

export interface MessageRecipient {
  memberId: string;
  memberCode: string;
  memberName: string;
  department: string;
  segment: MessageSegment;
  phone: string | null;
  lastVisitAt: string | null;
  daysSinceLastVisit: number;
  subscriptionEndKey: string | null;
  daysUntilExpiry: number | null;
  nextBirthdayKey: string | null;
  daysUntilBirthday: number | null;
}

export interface PublicMessageRow extends Row {
  id: string;
  member_id: string;
  segment: MessageSegment;
  member_code: string;
  member_name: string;
  phone: string | null;
  body: string;
  status: MessageStatus;
  error: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MessageSendResult {
  messageId: string;
  memberId: string;
  memberName: string;
  phone: string | null;
  status: MessageStatus;
  error: string | null;
  sentAt: string | null;
}

export interface SegmentSendSummary {
  sent: number;
  failed: number;
  skippedNoPhone: number;
  notConfigured: number;
}

export interface MessagesConfig {
  absentDays: number;
  birthdayDays: number;
  expiryDays: number;
}

const SEGMENT_RE = /^(absent|birthday|expiry)$/;

function assertSegment(segment: string): void {
  if (!SEGMENT_RE.test(segment)) throw errValidation("errors.messageSegmentInvalid");
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function toRecipient(row: Row, segment: MessageSegment): MessageRecipient {
  const memberId = str(row.member_id);
  const today = todayKey();
  const lastVisitAt = row.last_visit_at == null ? null : String(row.last_visit_at);
  const lastVisitKey = lastVisitAt ? lastVisitAt.slice(0, 10) : null;
  const endKey = row.next_end_key == null ? null : str(row.next_end_key);
  const nextBirthdayKey =
    row.date_of_birth == null || row.date_of_birth === "" ? null : nextAnniversaryKey(String(row.date_of_birth), today);
  return {
    memberId,
    memberCode: str(row.member_code),
    memberName: str(row.full_name),
    department: str(row.department) || "general",
    segment,
    phone: row.phone == null ? null : str(row.phone),
    lastVisitAt,
    daysSinceLastVisit: lastVisitKey ? Math.max(0, diffDaysKeys(lastVisitKey, today)) : 0,
    subscriptionEndKey: endKey,
    daysUntilExpiry: endKey ? Math.max(0, diffDaysKeys(today, endKey)) : null,
    nextBirthdayKey,
    daysUntilBirthday: nextBirthdayKey ? diffDaysKeys(today, nextBirthdayKey) : null,
  };
}

/**
 * Recipients for one outreach segment, computed live and department-scoped.
 *
 * - `absent`: active members with a live subscription whose latest check-in is
 *   older than the configured absence window (default 14 days).
 * - `birthday`: active members whose next birthday falls inside the configured
 *   window (default upcoming 7 days).
 * - `expiry`: active members whose live subscription ends inside the window
 *   (default upcoming 7 days).
 */
export function listRecipients(
  db: Db,
  actor: ServiceActor,
  input: { segment: MessageSegment },
): MessageRecipient[] {
  requirePermission(actor, "messages.view");
  assertSegment(input.segment);
  return computeRecipients(db, actor, input.segment);
}

function computeRecipients(db: Db, actor: ServiceActor, segment: MessageSegment): MessageRecipient[] {
  const today = todayKey();
  const filter = appendSegmentFilter(segment, today);
  const scope = departmentScopeCondition(actor, "m");
  const rows = db.all<Row>(
    "SELECT m.id AS member_id,\n" +
      "  m.member_code AS member_code,\n" +
      "  m.full_name AS full_name,\n" +
      "  m.phone AS phone,\n" +
      "  m.department AS department,\n" +
      "  m.date_of_birth AS date_of_birth,\n" +
      "  (SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL) AS last_visit_at,\n" +
      "  (SELECT MIN(s2.end_date) FROM member_subscriptions s2 WHERE s2.member_id = m.id AND s2.status = 'active' AND s2.end_date >= ?) AS next_end_key\n" +
      "FROM members m\n" +
      "WHERE m.deleted_at IS NULL AND m.status = 'active'" +
      filter.sql +
      scope.sql,
    [today, ...filter.params, ...scope.params],
  );

  return rows
    .map((row) => toRecipient(row, segment))
    .filter((r) => matchesSegment(r, segment, db))
    .sort(segmentSort(segment));
}

function appendSegmentFilter(segment: MessageSegment, today: string): { sql: string; params: string[] } {
  switch (segment) {
    case "absent": {
      // Coarse SQL pre-filter: unattended since at least yesterday, AND holding a
      // live subscription; the exact settings window is applied in JS.
      const cutoff = `${addDaysKey(today, -1)} 23:59:59`;
      return {
        sql:
          " AND COALESCE((SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL), '') <= '" +
          cutoff +
          "'" +
          " AND EXISTS (SELECT 1 FROM member_subscriptions s1 WHERE s1.member_id = m.id AND s1.status = 'active' AND s1.end_date >= ?)",
        params: [today],
      };
    }
    case "birthday":
      return { sql: " AND m.date_of_birth IS NOT NULL AND m.date_of_birth != ''", params: [] };
    case "expiry":
      return {
        sql: " AND EXISTS (SELECT 1 FROM member_subscriptions s3 WHERE s3.member_id = m.id AND s3.status = 'active' AND s3.end_date >= ?)",
        params: [today],
      };
    default:
      return { sql: "", params: [] };
  }
}

function matchesSegment(r: MessageRecipient, segment: MessageSegment, db: Db): boolean {
  switch (segment) {
    case "absent": {
      const days = getMessagesAbsentDays(db);
      // No visit ever = maximally absent.
      return r.lastVisitAt == null || r.daysSinceLastVisit >= days;
    }
    case "birthday": {
      const days = getMessagesBirthdayDays(db);
      return r.daysUntilBirthday != null && r.daysUntilBirthday < days;
    }
    case "expiry": {
      const days = getMessagesExpiryDays(db);
      return r.daysUntilExpiry != null && r.daysUntilExpiry < days;
    }
    default:
      return false;
  }
}

function segmentSort(segment: MessageSegment): (a: MessageRecipient, b: MessageRecipient) => number {
  switch (segment) {
    case "absent": {
      // Never-visited members have no lastVisit; treat them as maximally absent.
      const absentSort = (r: MessageRecipient): number =>
        r.lastVisitAt == null ? Number.MAX_SAFE_INTEGER : r.daysSinceLastVisit;
      return (a, b) => absentSort(b) - absentSort(a);
    }
    case "birthday":
      return (a, b) => (a.daysUntilBirthday ?? 999) - (b.daysUntilBirthday ?? 999);
    case "expiry":
      return (a, b) => (a.daysUntilExpiry ?? 999) - (b.daysUntilExpiry ?? 999);
    default:
      return () => 0;
  }
}

// ----- WhatsApp transport resolution (shared with card delivery) -----

function envFlag(name: string): boolean {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return proc.process?.env?.[name] === "1";
}

function resolveTransport(db: Db): {
  send: ((phone: string, body: string) => Promise<{ ok: boolean; error?: string }>) | null;
  provider: "mock" | "whatsapp" | "none";
} {
  if (envFlag("GYM_CRM_MOCK")) return { send: mockTransport, provider: "mock" };
  const enabled = readSetting(db, SETTING_KEYS.whatsappEnabled) === "1";
  const apiUrl = readSetting(db, SETTING_KEYS.whatsappApiUrl) ?? "";
  if (enabled && apiUrl.trim() !== "") {
    const transport = whatsappTransport(apiUrl.trim());
    return {
      send: async (phone, body) => transport(phone, body),
      provider: "whatsapp",
    };
  }
  return { send: null, provider: "none" };
}

const BODY_MAX = 2000;

function assertBody(body: string): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) throw errValidation("errors.messageBodyRequired");
  if (trimmed.length > BODY_MAX) throw errValidation("errors.messageTooLong", { max: BODY_MAX });
  return trimmed;
}

const MESSAGE_SELECT = "SELECT * FROM member_messages";

function loadMessage(db: Db, id: string): PublicMessageRow {
  const row = db.first<PublicMessageRow>(`${MESSAGE_SELECT} WHERE id = ?`, [id]);
  if (!row) throw errNotFound("errors.messageNotFound");
  return row;
}

function insertOutbox(
  db: Db,
  actor: ServiceActor,
  member: MemberRow,
  segment: MessageSegment,
  body: string,
  status: MessageStatus = "pending",
  error: string | null = null,
  sentAt: string | null = null,
): PublicMessageRow {
  const id = crypto.randomUUID();
  const dedupe = `msg:${segment}:${member.id}:${id}`;
  db.run(
    "INSERT INTO member_messages (id, member_id, segment, member_code, member_name, phone, body, status, error, dedupe_key, sent_at, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      member.id,
      segment,
      member.member_code,
      member.full_name,
      member.phone ?? null,
      body,
      status,
      error,
      dedupe,
      sentAt,
      actor.userId,
      nowStamp(),
    ],
  );
  return loadMessage(db, id);
}

/**
 * Sends one text message to a member over the configured WhatsApp gateway.
 * Every attempt is persisted in the outbox; a missing/disabled gateway yields
 * `not_configured`, a member without a phone `skipped_no_phone`. Re-sends are
 * allowed (each attempt appends a fresh outbox row).
 */
export async function sendMessage(
  db: Db,
  actor: ServiceActor,
  input: { memberId: string; segment: MessageSegment; body: string },
): Promise<MessageSendResult> {
  requirePermission(actor, "messages.send");
  assertSegment(input.segment);
  const body = assertBody(input.body);

  const member = getMemberRowById(db, input.memberId);
  if (!member || member.deleted_at) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, member.department);

  const { send, provider } = resolveTransport(db);

  let status: MessageStatus;
  let error: string | null = null;
  let sentAt: string | null = null;

  if (!send) {
    status = "not_configured";
  } else if (!member.phone) {
    status = "skipped_no_phone";
  } else {
    const result = await send(member.phone, body);
    if (result.ok) {
      status = "sent";
      sentAt = nowStamp();
    } else {
      status = "failed";
      error = result.error ?? null;
    }
  }

  const row = insertOutbox(db, actor, member, input.segment, body, status, error, sentAt);

  if (status === "sent" || status === "failed") {
    recordAudit(db, actor, status === "sent" ? "MESSAGE_SENT" : "MESSAGE_FAILED", "member", member.id, {
      memberCode: member.member_code,
      phone: member.phone ?? null,
      segment: input.segment,
      provider,
      error: error ?? undefined,
    });
  }

  return {
    messageId: row.id,
    memberId: member.id,
    memberName: member.full_name,
    phone: member.phone,
    status,
    error,
    sentAt,
  };
}

/**
 * Batch-sends the same body to every recipient of a segment (2–5 s human
 * pacing; skipped in mock mode so tests stay fast). Individual rows are still
 * written for every target, so the outbox stays complete.
 */
export async function sendSegment(
  db: Db,
  actor: ServiceActor,
  input: { segment: MessageSegment; body: string; limit?: number },
): Promise<SegmentSendSummary> {
  requirePermission(actor, "messages.send");
  assertSegment(input.segment);
  const body = assertBody(input.body);
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));

  const targets = computeRecipients(db, actor, input.segment).slice(0, limit);
  const { send, provider } = resolveTransport(db);
  const mock = envFlag("GYM_CRM_MOCK");

  let sent = 0;
  let failed = 0;
  let skippedNoPhone = 0;
  let notConfigured = 0;

  for (const target of targets) {
    const member = getMemberRowById(db, target.memberId);
    if (!member || member.deleted_at) continue;
    assertDepartmentAccess(actor, member.department);

    if (!send) {
      insertOutbox(db, actor, member, input.segment, body, "not_configured");
      notConfigured++;
      continue;
    }
    if (!member.phone) {
      insertOutbox(db, actor, member, input.segment, body, "skipped_no_phone");
      skippedNoPhone++;
      continue;
    }

    const result = await send(member.phone, body);
    if (result.ok) {
      insertOutbox(db, actor, member, input.segment, body, "sent", null, nowStamp());
      recordAudit(db, actor, "MESSAGE_SENT", "member", member.id, {
        memberCode: member.member_code,
        phone: member.phone,
        segment: input.segment,
        provider,
      });
      sent++;
    } else {
      insertOutbox(db, actor, member, input.segment, body, "failed", result.error ?? null);
      recordAudit(db, actor, "MESSAGE_FAILED", "member", member.id, {
        memberCode: member.member_code,
        phone: member.phone,
        segment: input.segment,
        error: result.error,
      });
      failed++;
    }
    if (!mock) {
      await new Promise((resolve) => setTimeout(resolve, 2000 + Math.floor(Math.random() * 3001)));
    }
  }

  return { sent, failed, skippedNoPhone, notConfigured };
}

export function listMessageHistory(
  db: Db,
  actor: ServiceActor,
  input: { limit?: number } = {},
): PublicMessageRow[] {
  requirePermission(actor, "messages.send");
  const limit = Math.min(100, Math.max(1, input.limit ?? 30));
  return db.all<PublicMessageRow>(
    `${MESSAGE_SELECT} ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export function getMessagesConfig(db: Db, actor: ServiceActor): MessagesConfig {
  requirePermission(actor, "messages.view");
  return {
    absentDays: getMessagesAbsentDays(db),
    birthdayDays: getMessagesBirthdayDays(db),
    expiryDays: getMessagesExpiryDays(db),
  };
}