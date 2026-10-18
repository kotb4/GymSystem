import { addDaysKey, diffDaysKeys, nextAnniversaryKey, nowStamp, todayKey } from "@/core/dates";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, requireAnyPermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById, type MemberRow } from "./members.service";
import { assertDepartmentAccess, departmentScopeCondition } from "./department";
import {
  getMessagesAbsentDays,
  getMessagesAbsentTemplate,
  getMessagesBirthdayDays,
  getMessagesBirthdayTemplate,
  getMessagesExpiryDays,
  getMessagesExpiryTemplate,
  getMessagesWelcomeTemplate,
  getMessagesPaymentTemplate,
  getMessagesPacingMinSeconds,
  getMessagesPacingMaxSeconds,
  getMessagesCooldownDays,
  getWhatsappHourlyLimit,
  getWhatsappDailyLimit,
  getMessagesRenewalTodayTemplate,
  getMessagesRenewalAfterTemplate,
  readSetting,
  SETTING_KEYS,
} from "./settings.service";
import {
  mockTransport,
  whatsappTransport,
  sendPendingCardDeliveries,
  type CardDeliveryStatus,
  type CardDeliveryMediaPayload,
  DEVELOPER_CREDIT_LINE,
} from "./card-delivery.service";
import { fillMessagePlaceholders, applyAntiBanVariations } from "@/core/whatsapp";
import { getMemberPortalUrl } from "./member-portal.service";
import { renderQrPngBase64 } from "@/core/qr";

export type MessageSegment = "absent" | "birthday" | "expiry" | "welcome" | "payment" | "custom";
export type MessageStatus = CardDeliveryStatus | "skipped_cooldown";

export const MESSAGE_SEGMENTS: readonly MessageSegment[] = [
  "absent",
  "birthday",
  "expiry",
  "welcome",
  "payment",
  "custom",
];

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
  message_type: string | null;
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
  skippedCooldown: number;
  notConfigured: number;
}

export interface MessagesConfig {
  absentDays: number;
  birthdayDays: number;
  expiryDays: number;
  /** Free-text template used to compose `birthday` outreach (`{اسم العميل}` / `{الخصم}` / `{رقم العضوية}` blocks). */
  birthdayTemplate: string;
  /** Free-text template used to compose `absent` outreach (`{اسم العميل}` / `{الخصم}` / `{رقم العضوية}` blocks). */
  absentTemplate: string;
  /** Free-text template used to compose `expiry` outreach (`{اسم العميل}` / `{الخصم}` / `{رقم العضوية}` blocks). */
  expiryTemplate: string;
  /** Free-text template used for new member welcome messages. */
  welcomeTemplate: string;
  /** Free-text template used for payment confirmation receipts. */
  paymentTemplate: string;
  /** Minimum safe delay between segment sends in seconds. */
  pacingMinSeconds: number;
  /** Maximum safe delay between segment sends in seconds. */
  pacingMaxSeconds: number;
  /** Cool-down window in days: skip segment outreach to members who already received a message. */
  cooldownDays: number;
}

const SEGMENT_RE = /^(absent|birthday|expiry|welcome|payment|custom)$/;

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
  send: ((phone: string, body: string, media?: CardDeliveryMediaPayload) => Promise<{ ok: boolean; error?: string }>) | null;
  provider: "mock" | "whatsapp" | "none";
} {
  if (envFlag("GYM_CRM_MOCK")) return { send: mockTransport, provider: "mock" };
  const enabled = readSetting(db, SETTING_KEYS.whatsappEnabled) === "1";
  const apiUrl = (readSetting(db, SETTING_KEYS.whatsappApiUrl) || "").trim() || "http://127.0.0.1:8891";
  if (enabled && apiUrl !== "") {
    const transport = whatsappTransport(apiUrl);
    return {
      send: async (phone, body, media) => transport(phone, body, media),
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
  input: { memberId: string; segment: MessageSegment; body: string; media?: CardDeliveryMediaPayload },
): Promise<MessageSendResult> {
  if (input.segment === "payment") {
    requireAnyPermission(actor, ["messages.send", "subscriptions.create", "payments.create", "cards.send"]);
  } else if (input.segment === "welcome") {
    requireAnyPermission(actor, ["messages.send", "members.create", "cards.send"]);
  } else {
    requirePermission(actor, "messages.send");
  }
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
    const result = await send(member.phone, body, input.media);
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
/**
 * Batch-sends to every recipient of a segment with anti-ban protections:
 * - 15–35s extended randomized pacing with jitter
 * - Quiet hours nocturnal enforcement (10 PM - 9 AM)
 * - Dynamic per-recipient text personalization and unique zero-width cryptographic salt
 * - Hourly / daily rate limiting
 */
export async function sendSegment(
  db: Db,
  actor: ServiceActor,
  input: { segment: MessageSegment; body: string; limit?: number; bypassCooldown?: boolean; bypassQuietHours?: boolean },
): Promise<SegmentSendSummary> {
  requirePermission(actor, "messages.send");
  assertSegment(input.segment);
  const targets = computeRecipients(db, actor, input.segment);
  return sendCustomRecipients(db, actor, {
    recipients: targets,
    segment: input.segment,
    body: input.body,
    limit: input.limit,
    bypassCooldown: input.bypassCooldown,
    bypassQuietHours: input.bypassQuietHours,
  });
}

export async function sendCustomRecipients(
  db: Db,
  actor: ServiceActor,
  input: {
    recipients: MessageRecipient[];
    segment: MessageSegment;
    body: string;
    limit?: number;
    bypassCooldown?: boolean;
    bypassQuietHours?: boolean;
  },
): Promise<SegmentSendSummary> {
  requirePermission(actor, "messages.send");
  assertSegment(input.segment);
  const body = assertBody(input.body);
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));

  const targets = input.recipients.slice(0, limit);
  const { send, provider } = resolveTransport(db);
  const mock = envFlag("GYM_CRM_MOCK");

  // Anti-ban: hourly and daily rate limiting
  if (!mock) {
    const hourlyLimit = getWhatsappHourlyLimit(db);
    const recentSent1h = db.count(
      "SELECT COUNT(*) FROM member_messages WHERE status = 'sent' AND created_at >= datetime('now', '-1 hour')",
    );
    if (recentSent1h >= hourlyLimit) {
      throw errValidation("errors.messagesHourlyLimitExceeded");
    }

    const dailyLimit = getWhatsappDailyLimit(db);
    const recentSent24h = db.count(
      "SELECT COUNT(*) FROM member_messages WHERE status = 'sent' AND created_at >= datetime('now', '-24 hours')",
    );
    if (recentSent24h >= dailyLimit) {
      throw errValidation("errors.messagesDailyLimitExceeded");
    }
  }

  const pacingMin = getMessagesPacingMinSeconds(db);
  const pacingMax = getMessagesPacingMaxSeconds(db);
  const cooldownDays = getMessagesCooldownDays(db);
  const gymName = readSetting(db, SETTING_KEYS.gymName) || "Gym";

  let sent = 0;
  let failed = 0;
  let skippedNoPhone = 0;
  let skippedCooldown = 0;
  let notConfigured = 0;

  for (const target of targets) {
    const member = getMemberRowById(db, target.memberId);
    if (!member || member.deleted_at) continue;
    assertDepartmentAccess(actor, member.department);

    if (!input.bypassCooldown && cooldownDays > 0) {
      const cutoff = `${addDaysKey(todayKey(), -cooldownDays)} 00:00:00`;
      const recent = db.scalar(
        "SELECT 1 FROM member_messages WHERE member_id = ? AND status = 'sent' AND created_at >= ? LIMIT 1",
        [member.id, cutoff],
      );
      if (recent) {
        insertOutbox(db, actor, member, input.segment, body, "skipped_cooldown");
        skippedCooldown++;
        continue;
      }
    }

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

    // Dynamic per-recipient personalization
    const personalized = fillMessagePlaceholders(body, {
      memberName: member.full_name,
      memberCode: member.member_code,
      gymName,
      daysUntilExpiry: target.daysUntilExpiry,
      endDate: target.subscriptionEndKey,
      daysSinceLastVisit: target.daysSinceLastVisit,
    });

    // Anti-ban dynamic variation & zero-width cryptographic salt
    const antiBanBody = applyAntiBanVariations(personalized, {
      memberName: member.full_name,
      salt: `${member.id}:${Date.now()}`,
    });

    const result = await send(member.phone, antiBanBody);
    if (result.ok) {
      insertOutbox(db, actor, member, input.segment, personalized, "sent", null, nowStamp());
      recordAudit(db, actor, "MESSAGE_SENT", "member", member.id, {
        memberCode: member.member_code,
        phone: member.phone,
        segment: input.segment,
        provider,
      });
      sent++;
    } else {
      insertOutbox(db, actor, member, input.segment, personalized, "failed", result.error ?? null);
      recordAudit(db, actor, "MESSAGE_FAILED", "member", member.id, {
        memberCode: member.member_code,
        phone: member.phone,
        segment: input.segment,
        error: result.error,
      });
      failed++;
    }

    if (!mock) {
      const span = Math.max(0, pacingMax - pacingMin);
      const jitterMs = Math.floor(Math.random() * 2000) + 500;
      const delayMs = Math.floor((pacingMin + Math.random() * span) * 1000) + jitterMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { sent, failed, skippedNoPhone, skippedCooldown, notConfigured };
}

/**
 * 3-Stage Renewal Reminder Recipient Finder:
 * - Stage 1: 5 days before expiry
 * - Stage 2: Today (expiry day)
 * - Stage 3: 3 days after expiry
 */
export function listRenewalStageRecipients(
  db: Db,
  actor: ServiceActor,
  stage: 1 | 2 | 3,
): MessageRecipient[] {
  requirePermission(actor, "messages.view");
  const today = todayKey();
  if (stage === 1) {
    const all = computeRecipients(db, actor, "expiry");
    return all.filter((r) => r.daysUntilExpiry != null && r.daysUntilExpiry <= 5 && r.daysUntilExpiry > 0);
  } else if (stage === 2) {
    const all = computeRecipients(db, actor, "expiry");
    return all.filter((r) => r.daysUntilExpiry === 0);
  } else {
    const targetEnd = addDaysKey(today, -3);
    const scope = departmentScopeCondition(actor, "m");
    const rows = db.all<Row>(
      `SELECT m.id AS member_id, m.member_code, m.full_name, m.phone, m.department, m.date_of_birth,
              (SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL) AS last_visit_at,
              s.end_date AS next_end_key
       FROM members m
       JOIN member_subscriptions s ON s.member_id = m.id AND s.end_date = ?
       WHERE m.deleted_at IS NULL AND m.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM member_subscriptions s2
           WHERE s2.member_id = m.id AND s2.status = 'active' AND s2.end_date > s.end_date
         )
         ${scope.sql}`,
      [targetEnd, ...scope.params],
    );
    return rows.map((r) => toRecipient(r, "expiry"));
  }
}

/**
 * Sends a specific stage renewal campaign with the appropriate template.
 */
export async function sendRenewalStage(
  db: Db,
  actor: ServiceActor,
  input: { stage: 1 | 2 | 3; limit?: number; bypassCooldown?: boolean; bypassQuietHours?: boolean },
): Promise<SegmentSendSummary> {
  requirePermission(actor, "messages.send");
  let body = getMessagesExpiryTemplate(db);
  if (input.stage === 2) body = getMessagesRenewalTodayTemplate(db);
  if (input.stage === 3) body = getMessagesRenewalAfterTemplate(db);

  const targets = listRenewalStageRecipients(db, actor, input.stage);
  return sendCustomRecipients(db, actor, {
    recipients: targets,
    segment: "expiry",
    body,
    limit: input.limit,
    bypassCooldown: input.bypassCooldown,
    bypassQuietHours: input.bypassQuietHours,
  });
}

export function listMessageHistory(
  db: Db,
  actor: ServiceActor,
  input: { limit?: number } = {},
): PublicMessageRow[] {
  requirePermission(actor, "messages.send");
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));

  const sql = `
    SELECT
      id,
      member_id,
      segment,
      member_code,
      member_name,
      phone,
      body,
      status,
      error,
      sent_at,
      created_by,
      created_at,
      'campaign' AS message_type
    FROM member_messages

    UNION ALL

    SELECT
      cd.id,
      cd.member_id,
      'custom' AS segment,
      COALESCE((SELECT member_code FROM members WHERE id = cd.member_id), '') AS member_code,
      COALESCE(cd.member_name, (SELECT full_name FROM members WHERE id = cd.member_id), 'عضو') AS member_name,
      cd.phone,
      ('إرسال بطاقة العضوية الذكية QR — باركود: ' || cd.barcode_value) AS body,
      cd.status,
      cd.error,
      cd.sent_at,
      cd.created_by,
      cd.created_at,
      'card' AS message_type
    FROM card_deliveries cd

    UNION ALL

    SELECT
      dm.id,
      dm.member_id,
      'custom' AS segment,
      COALESCE(m.member_code, '') AS member_code,
      COALESCE(m.full_name, 'عضو') AS member_name,
      m.phone,
      dm.message AS body,
      (CASE WHEN dm.status IN ('delivered', 'sent', 'read') THEN 'sent' ELSE 'failed' END) AS status,
      dm.error_reason AS error,
      dm.created_at AS sent_at,
      dm.sender_user_id AS created_by,
      dm.created_at,
      (CASE WHEN dm.sender_type = 'member' THEN 'direct' WHEN dm.message_type = 'bot' THEN 'bot' ELSE 'direct' END) AS message_type
    FROM member_direct_messages dm
    LEFT JOIN members m ON m.id = dm.member_id

    ORDER BY created_at DESC LIMIT ?
  `;

  try {
    return db.all<PublicMessageRow>(sql, [limit]);
  } catch {
    // Graceful fallback to legacy table if columns/tables differ
    return db.all<PublicMessageRow>(`${MESSAGE_SELECT} ORDER BY created_at DESC LIMIT ?`, [limit]);
  }
}

/**
 * Retries sending a failed message or card delivery via the WhatsApp gateway.
 */
export async function retryMessage(
  db: Db,
  actor: ServiceActor,
  input: { id: string; messageType?: string },
): Promise<{ ok: boolean; error?: string }> {
  requirePermission(actor, "messages.send");

  // 1. If card delivery:
  if (input.messageType === "card") {
    const delivery = db.first<{ id: string; member_id: string }>(
      "SELECT id, member_id FROM card_deliveries WHERE id = ?",
      [input.id],
    );
    if (!delivery) throw errNotFound("errors.notFound");
    db.run("UPDATE card_deliveries SET status = 'pending', error = NULL WHERE id = ?", [delivery.id]);
    const summary = await sendPendingCardDeliveries(db, actor, 1);
    if (summary.failed > 0) {
      const refreshed = db.first<{ error: string | null }>(
        "SELECT error FROM card_deliveries WHERE id = ?",
        [delivery.id],
      );
      return { ok: false, error: refreshed?.error || "فشل إرسال كرت العضوية" };
    }
    return { ok: true };
  }

  // 2. If campaign / member_messages:
  const msg = db.first<{ id: string; member_id: string; body: string; phone: string | null; segment: string }>(
    "SELECT id, member_id, body, phone, segment FROM member_messages WHERE id = ?",
    [input.id],
  );
  if (msg) {
    const member = getMemberRowById(db, msg.member_id);
    if (!member || member.deleted_at) throw errNotFound("errors.memberNotFound");
    const { send } = resolveTransport(db);
    if (!send) return { ok: false, error: "محرك الواتساب غير متصل" };
    const targetPhone = member.phone || msg.phone;
    if (!targetPhone) return { ok: false, error: "لا يوجد رقم هاتف مسجل للعضو" };

    const result = await send(targetPhone, msg.body);
    const now = nowStamp();
    if (result.ok) {
      db.run("UPDATE member_messages SET status = 'sent', error = NULL, sent_at = ? WHERE id = ?", [now, msg.id]);
      return { ok: true };
    } else {
      db.run("UPDATE member_messages SET status = 'failed', error = ? WHERE id = ?", [result.error || "فشل الإرسال", msg.id]);
      return { ok: false, error: result.error || "فشل إرسال الرسالة" };
    }
  }

  // 3. If direct message:
  const directMsg = db.first<{ id: string; member_id: string; message: string }>(
    "SELECT id, member_id, message FROM member_direct_messages WHERE id = ?",
    [input.id],
  );
  if (directMsg) {
    const member = getMemberRowById(db, directMsg.member_id);
    if (!member || !member.phone) return { ok: false, error: "لا يوجد رقم هاتف مسجل للعضو" };
    const { send } = resolveTransport(db);
    if (!send) return { ok: false, error: "محرك الواتساب غير متصل" };

    const result = await send(member.phone, directMsg.message);
    if (result.ok) {
      db.run("UPDATE member_direct_messages SET status = 'sent', error_reason = NULL WHERE id = ?", [directMsg.id]);
      return { ok: true };
    } else {
      db.run("UPDATE member_direct_messages SET status = 'failed', error_reason = ? WHERE id = ?", [result.error || "فشل الإرسال", directMsg.id]);
      return { ok: false, error: result.error || "فشل الإرسال" };
    }
  }

  throw errNotFound("errors.notFound");
}

export function getMessagesConfig(db: Db, actor: ServiceActor): MessagesConfig {
  requirePermission(actor, "messages.view");
  return {
    absentDays: getMessagesAbsentDays(db),
    birthdayDays: getMessagesBirthdayDays(db),
    expiryDays: getMessagesExpiryDays(db),
    birthdayTemplate: getMessagesBirthdayTemplate(db),
    absentTemplate: getMessagesAbsentTemplate(db),
    expiryTemplate: getMessagesExpiryTemplate(db),
    welcomeTemplate: getMessagesWelcomeTemplate(db),
    paymentTemplate: getMessagesPaymentTemplate(db),
    pacingMinSeconds: getMessagesPacingMinSeconds(db),
    pacingMaxSeconds: getMessagesPacingMaxSeconds(db),
    cooldownDays: getMessagesCooldownDays(db),
  };
}

export interface MemberMessageData {
  memberId: string;
  memberCode: string;
  memberName: string;
  phone: string | null;
  gymName: string;
  planName: string | null;
  startDate: string | null;
  endDate: string | null;
  daysUntilExpiry: number | null;
  remainingSessions: number | null;
  daysSinceLastVisit: number | null;
  latestPaymentPaid: number | null;
  latestPaymentRemaining: number | null;
}

export function getMemberMessageData(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): MemberMessageData {
  requirePermission(actor, "messages.view");
  const member = getMemberRowById(db, memberId);
  if (!member || member.deleted_at) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, member.department);

  const today = todayKey();
  const gymName = readSetting(db, SETTING_KEYS.gymName) || "Gym";

  const sub = db.first<{
    plan_name: string;
    start_date: string;
    end_date: string;
    sessions_total: number | null;
    sessions_used: number | null;
  }>(
    "SELECT p.name AS plan_name, s.start_date, s.end_date, s.sessions_total, s.sessions_used\n" +
      "FROM member_subscriptions s\n" +
      "JOIN membership_plans p ON p.id = s.plan_id\n" +
      "WHERE s.member_id = ? AND s.status = 'active' AND s.end_date >= ?\n" +
      "ORDER BY s.end_date ASC LIMIT 1",
    [memberId, today],
  );

  let remainingSessions: number | null = null;
  if (sub && sub.sessions_total != null) {
    remainingSessions = Math.max(0, sub.sessions_total - (sub.sessions_used ?? 0));
  }

  const lastVisit = db.scalar(
    "SELECT MAX(checkin_at) FROM attendance WHERE member_id = ? AND deleted_at IS NULL",
    [memberId],
  );
  let daysSinceLastVisit: number | null = null;
  if (lastVisit) {
    const lastVisitKey = String(lastVisit).slice(0, 10);
    daysSinceLastVisit = Math.max(0, diffDaysKeys(lastVisitKey, today));
  }

  const payment = db.first<{ paid_amount_minor: number; remaining_amount_minor: number }>(
    "SELECT paid_amount_minor, remaining_amount_minor FROM payments WHERE member_id = ? AND status != 'voided' ORDER BY paid_at DESC LIMIT 1",
    [memberId],
  );

  const daysUntilExpiry = sub ? Math.max(0, diffDaysKeys(today, sub.end_date)) : null;

  return {
    memberId: member.id,
    memberCode: member.member_code,
    memberName: member.full_name,
    phone: member.phone,
    gymName,
    planName: sub ? sub.plan_name : null,
    startDate: sub ? sub.start_date : null,
    endDate: sub ? sub.end_date : null,
    daysUntilExpiry,
    remainingSessions,
    daysSinceLastVisit,
    latestPaymentPaid: payment ? payment.paid_amount_minor / 100 : null,
    latestPaymentRemaining: payment ? payment.remaining_amount_minor / 100 : null,
  };
}

export async function sendWelcomeMessage(
  db: Db,
  actor: ServiceActor,
  input: { memberId: string },
): Promise<MessageSendResult> {
  requireAnyPermission(actor, ["messages.send", "members.create", "cards.send"]);
  const data = getMemberMessageData(db, actor, input.memberId);
  const tmpl = getMessagesWelcomeTemplate(db);

  let portalUrl: string | undefined;
  try {
    const portal = getMemberPortalUrl(db, actor, input.memberId);
    portalUrl = portal.url;
  } catch {
    /* non-fatal */
  }

  // Look up card barcode (virtual or assigned physical)
  const cardRow = db.first<{ barcode_value: string }>(
    "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned' ORDER BY kind ASC LIMIT 1",
    [input.memberId],
  );
  const barcodeValue = cardRow?.barcode_value || data.memberCode;

  let media: CardDeliveryMediaPayload | undefined;
  try {
    const base64 = await renderQrPngBase64(barcodeValue);
    media = {
      base64,
      mime: "image/png",
      caption: "",
    };
  } catch {
    /* non-fatal fallback to text */
  }

  let body = fillMessagePlaceholders(tmpl, {
    memberName: data.memberName,
    memberCode: data.memberCode,
    gymName: data.gymName,
    planName: data.planName,
    startDate: data.startDate,
    endDate: data.endDate,
    daysUntilExpiry: data.daysUntilExpiry,
    remainingSessions: data.remainingSessions,
    portalUrl,
  });

  // Ensure portal URL is included if not already present in the template
  if (portalUrl && !body.includes(portalUrl)) {
    body += `\n\n📲 رابط حسابك وبطاقتك الإلكترونية:\n${portalUrl}`;
  }

  // Ensure fixed developer brand is included at the bottom if not already present
  if (!body.includes(DEVELOPER_CREDIT_LINE)) {
    body += `\n\n${DEVELOPER_CREDIT_LINE}`;
  }

  if (media) {
    media.caption = body;
  }

  const result = await sendMessage(db, actor, { memberId: input.memberId, segment: "welcome", body, media });

  if (result.status === "sent") {
    try {
      db.run(
        "UPDATE card_deliveries SET status = 'sent', sent_at = ?, error = NULL WHERE member_id = ? AND status = 'pending'",
        [nowStamp(), input.memberId],
      );
    } catch {
      /* non-fatal */
    }
  }

  return result;
}

export async function sendPaymentMessage(
  db: Db,
  actor: ServiceActor,
  input: { memberId: string; amountPaid?: number; amountRemaining?: number; planName?: string; endDate?: string },
): Promise<MessageSendResult> {
  requireAnyPermission(actor, ["messages.send", "subscriptions.create", "payments.create", "cards.send"]);
  const data = getMemberMessageData(db, actor, input.memberId);
  const tmpl = getMessagesPaymentTemplate(db);
  const body = fillMessagePlaceholders(tmpl, {
    memberName: data.memberName,
    memberCode: data.memberCode,
    gymName: data.gymName,
    planName: input.planName ?? data.planName,
    startDate: data.startDate,
    endDate: input.endDate ?? data.endDate,
    amountPaid: input.amountPaid ?? data.latestPaymentPaid ?? 0,
    amountRemaining: input.amountRemaining ?? data.latestPaymentRemaining ?? 0,
  });
  return sendMessage(db, actor, { memberId: input.memberId, segment: "payment", body });
}