import { addDaysKey, nowStamp, todayKey } from "@/core/dates";
import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { assertDepartmentAccess } from "./department";
import { getMemberRowById } from "./members.service";
import { readSetting, SETTING_KEYS } from "./settings.service";
import { mockTransport, whatsappTransport, type MessageTransport, DEVELOPER_CREDIT_LINE } from "./card-delivery.service";

export interface RenewalCandidate {
  subscriptionId: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  phone: string | null;
  planName: string;
  endDate: string;
  daysRemaining: number;
  lastReminderSentAt: string | null;
  reminderStatus: "pending" | "already_sent" | "no_phone";
}

export interface RenewalReminderLogRow extends Row {
  id: string;
  subscription_id: string;
  member_id: string;
  phone: string;
  expiry_date: string;
  sent_channel: string;
  status: string;
  sent_at: string;
  created_by: string | null;
}

export interface SendRenewalReminderResult {
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  details: Array<{
    memberId: string;
    memberName: string;
    status: "sent" | "failed" | "skipped";
    error?: string;
  }>;
}

function envFlag(name: string): boolean {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return proc.process?.env?.[name] === "1";
}

function resolveTransport(db: Db): { transport: MessageTransport | null; provider: "mock" | "whatsapp" | "none" } {
  if (envFlag("GYM_CRM_MOCK")) return { transport: mockTransport, provider: "mock" };
  const enabled = readSetting(db, SETTING_KEYS.whatsappEnabled) === "1";
  const apiUrl = (readSetting(db, SETTING_KEYS.whatsappApiUrl) || "").trim() || "http://127.0.0.1:8891";
  if (enabled && apiUrl !== "") {
    return { transport: whatsappTransport(apiUrl), provider: "whatsapp" };
  }
  return { transport: null, provider: "none" };
}

/**
 * List members whose active subscriptions expire within the next N days (default 7 days).
 */
export function listExpiringSubscriptionsForRenewal(
  db: Db,
  actor: ServiceActor,
  daysAhead: number = 7,
): RenewalCandidate[] {
  requirePermission(actor, "subscriptions.view");
  const maxDays = Math.max(1, Math.min(30, daysAhead));
  const today = todayKey();
  const targetEnd = addDaysKey(today, maxDays);

  const rows = db.all<{
    subscription_id: string;
    member_id: string;
    member_code: string;
    member_name: string;
    phone: string | null;
    department: "general" | "men" | "women";
    plan_name: string;
    end_date: string;
    last_sent_at: string | null;
  }>(
    `SELECT 
       s.id AS subscription_id,
       m.id AS member_id,
       m.member_code AS member_code,
       m.full_name AS member_name,
       m.phone AS phone,
       m.department AS department,
       COALESCE(p.name, 'اشتراك') AS plan_name,
       s.end_date AS end_date,
       (SELECT MAX(r.sent_at) FROM renewal_reminder_logs r WHERE r.subscription_id = s.id) AS last_sent_at
     FROM member_subscriptions s
     JOIN members m ON m.id = s.member_id
     LEFT JOIN membership_plans p ON p.id = s.plan_id
     WHERE s.status = 'active'
       AND s.end_date IS NOT NULL
       AND s.end_date >= ?
       AND s.end_date <= ?
       AND m.status != 'archived'
     ORDER BY s.end_date ASC`,
    [today, targetEnd],
  );

  const candidates: RenewalCandidate[] = [];

  for (const row of rows) {
    // Check actor department scope
    try {
      assertDepartmentAccess(actor, row.department);
    } catch {
      continue;
    }

    const endDate = row.end_date;
    // Calculate days difference
    const diffMs = new Date(endDate).getTime() - new Date(today).getTime();
    const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    let reminderStatus: RenewalCandidate["reminderStatus"] = "pending";
    if (!row.phone || !row.phone.trim()) {
      reminderStatus = "no_phone";
    } else if (row.last_sent_at && row.last_sent_at.slice(0, 10) === today) {
      reminderStatus = "already_sent";
    }

    candidates.push({
      subscriptionId: row.subscription_id,
      memberId: row.member_id,
      memberCode: row.member_code,
      memberName: row.member_name,
      phone: row.phone,
      planName: row.plan_name,
      endDate: row.end_date,
      daysRemaining,
      lastReminderSentAt: row.last_sent_at,
      reminderStatus,
    });
  }

  return candidates;
}

export function buildRenewalMessageText(
  memberName: string,
  planName: string,
  endDate: string,
  daysRemaining: number,
): string {
  const urgency = daysRemaining === 0 ? "ينتهي اليوم" : daysRemaining === 1 ? "ينتهي غداً" : `ينتهي بعد ${daysRemaining} أيام (${endDate})`;
  return `مرحباً كابتن ${memberName} 👋
نود تذكيرك بأن اشتراكك في باقة "${planName}" ${urgency}.
يسعدنا دائماً استمرارك معنا في تمرينك وتحقيق أهدافك الرياضية! 🏋️‍♂️💪

لتجديد اشتراكك أو الاستفسار عن عروض التجديد يرجى مراجعة الاستقبال.

${DEVELOPER_CREDIT_LINE}`;
}

/**
 * Send renewal reminders via WhatsApp to selected or all pending expiring subscriptions.
 */
export async function sendRenewalReminders(
  db: Db,
  actor: ServiceActor,
  subscriptionIds: string[],
): Promise<SendRenewalReminderResult> {
  requirePermission(actor, "subscriptions.edit");

  if (!subscriptionIds || subscriptionIds.length === 0) {
    throw errValidation("errors.noSubscriptionsSelected");
  }

  const { transport, provider } = resolveTransport(db);

  const result: SendRenewalReminderResult = {
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    details: [],
  };

  const today = todayKey();
  const stamp = nowStamp();

  for (const subId of subscriptionIds) {
    const sub = db.first<{
      subscription_id: string;
      member_id: string;
      end_date: string;
      plan_name: string;
      status: string;
    }>(
      `SELECT s.id AS subscription_id, s.member_id, s.end_date, s.status, COALESCE(p.name, 'اشتراك') AS plan_name
       FROM member_subscriptions s
       LEFT JOIN membership_plans p ON p.id = s.plan_id
       WHERE s.id = ?`,
      [subId],
    );

    if (!sub || sub.status !== "active") {
      result.skippedCount++;
      result.details.push({
        memberId: sub?.member_id ?? "",
        memberName: "غير معروف",
        status: "skipped",
        error: "الاشتراك غير متاح أو غير نشط",
      });
      continue;
    }

    const member = getMemberRowById(db, sub.member_id);
    if (!member) {
      result.skippedCount++;
      continue;
    }

    assertDepartmentAccess(actor, member.department);

    if (!member.phone || !member.phone.trim()) {
      result.skippedCount++;
      result.details.push({
        memberId: member.id,
        memberName: member.full_name,
        status: "skipped",
        error: "لا يوجد رقم هاتف مسجل",
      });
      continue;
    }

    // Check if already sent today for this subscription
    const alreadySentToday = db.count(
      `SELECT COUNT(*) FROM renewal_reminder_logs 
       WHERE subscription_id = ? AND substr(sent_at, 1, 10) = ?`,
      [sub.subscription_id, today],
    ) > 0;

    if (alreadySentToday) {
      result.skippedCount++;
      result.details.push({
        memberId: member.id,
        memberName: member.full_name,
        status: "skipped",
        error: "تم إرسال تذكير اليوم بالفعل",
      });
      continue;
    }

    const diffMs = new Date(sub.end_date).getTime() - new Date(today).getTime();
    const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const message = buildRenewalMessageText(member.full_name, sub.plan_name, sub.end_date, daysRemaining);

    if (!transport) {
      // Gateway not configured
      result.failedCount++;
      result.details.push({
        memberId: member.id,
        memberName: member.full_name,
        status: "failed",
        error: "بوابة الواتساب غير مفعلة في الإعدادات",
      });
      continue;
    }

    const sendRes = await transport(member.phone, message);
    if (sendRes.ok) {
      // Record reminder in log
      db.run(
        `INSERT INTO renewal_reminder_logs (
           id, subscription_id, member_id, phone, expiry_date, sent_channel, status, sent_at, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          sub.subscription_id,
          member.id,
          member.phone,
          sub.end_date,
          provider,
          "sent",
          stamp,
          actor.userId,
        ],
      );

      result.sentCount++;
      result.details.push({
        memberId: member.id,
        memberName: member.full_name,
        status: "sent",
      });
    } else {
      result.failedCount++;
      result.details.push({
        memberId: member.id,
        memberName: member.full_name,
        status: "failed",
        error: sendRes.error ?? "فشل الإرسال",
      });
    }
  }

  return result;
}
