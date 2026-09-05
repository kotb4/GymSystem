import { addDaysKey, nowStamp, secondsBetweenStamps, todayKey } from "@/core/dates";
import { errNotFound } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getCardByBarcode } from "./cards.service";
import { readSetting, SETTING_KEYS } from "./settings.service";
import { getMemberRowById } from "./members.service";
import { activeTrialForMember } from "./trials.service";
import { unfreezeSubscription } from "./subscriptions.service";
import { applyEarnRule, loyaltyUsableCreditMinor } from "./loyalty.service";

/**
 * Internal sentinel used to abort a check-in write transaction when the
 * duplicate-scan window (checked inside the transaction) is hit. Throwing it
 * rolls the transaction back; the outer handler converts it into the
 * "duplicate" CheckInResult instead of a client-facing error.
 */
const CHECKIN_DUPLICATE_SENTINEL = Object.freeze({ __checkinDuplicate: true });

export type CheckInDenialReason =
  | "CARD_UNKNOWN"
  | "CARD_NOT_LINKED"
  | "CARD_LOST"
  | "CARD_BLOCKED"
  | "MEMBER_INACTIVE"
  | "MEMBER_DELETED"
  | "NO_ACTIVE_SUBSCRIPTION"
  | "NO_SESSIONS_LEFT";

export type CheckInResult =
  | {
      kind: "success";
      attendanceId: string;
      memberName: string;
      memberCode: string;
      photoFileId: string | null;
      planName: string | null;
      subscriptionEndsAt: string;
      sessionsRemaining?: number | null;
      /** Money still owed (subscription balance + open store debts). */
      outstandingMinor: number;
    }
  | { kind: "denied"; reason: CheckInDenialReason; barcode: string; memberName?: string }
  | { kind: "duplicate"; secondsAgo: number; memberName: string; memberCode: string };

export interface AttendanceRow extends Row {
  id: string;
  member_id: string;
  card_id: string | null;
  subscription_id: string | null;
  checkin_at: string;
  created_by: string | null;
  device_identifier: string | null;
  notes: string | null;
}

export interface RecentCheckIn {
  id: string;
  memberName: string;
  memberCode: string;
  checkinAt: string;
  deviceIdentifier: string | null;
}

const DEFAULT_DUPLICATE_WINDOW_SECONDS = 45;

export function duplicateWindowSeconds(db: Db): number {
  const raw = readSetting(db, SETTING_KEYS.duplicateWindowSeconds);
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DUPLICATE_WINDOW_SECONDS;
}

interface ActiveSubRow extends Row {
  id: string;
  end_date: string;
  plan_name: string | null;
  plan_kind: string | null;
  sessions_total: number | null;
  sessions_used: number;
}

/**
 * Finds the subscription that authorizes attendance today.
 * time/open plans authorize by date window; session plans additionally
 * require remaining sessions (enforced in the service layer, not just UI).
 * Exported so the reception eligibility lookup reuses the same rule.
 */
export function findActiveSubscription(db: Db, memberId: string, today: string): ActiveSubRow | null {
  const rows = db.all<ActiveSubRow>(
    "SELECT s.id, s.end_date, p.name AS plan_name, p.kind AS plan_kind, s.sessions_total, s.sessions_used\nFROM member_subscriptions s\nJOIN membership_plans p ON p.id = s.plan_id\nWHERE s.member_id = ? AND s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?\nORDER BY (CASE WHEN p.kind = 'sessions' THEN 0 ELSE 1 END), s.end_date DESC",
    [memberId, today, today],
  );
  for (const row of rows) {
    if ((row.plan_kind ?? "time") === "sessions") {
      if (row.sessions_total == null) return row;
      const remaining = Number(row.sessions_total) - Number(row.sessions_used ?? 0);
      if (remaining > 0) return row;
      continue;
    }
    return row;
  }
  // a session subscription fully consumed still counts as an existing but
  // exhausted subscription so the UI can show NO_SESSIONS_LEFT
  return (
    db.first<ActiveSubRow>(
      "SELECT s.id, s.end_date, p.name AS plan_name, p.kind AS plan_kind, s.sessions_total, s.sessions_used\nFROM member_subscriptions s\nJOIN membership_plans p ON p.id = s.plan_id\nWHERE s.member_id = ? AND s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?\nORDER BY (CASE WHEN p.kind = 'sessions' THEN 0 ELSE 1 END), s.end_date DESC LIMIT 1",
      [memberId, today, today],
    ) ?? null
  );
}

export function consumeSession(db: Db, subscriptionId: string): void {
  const updated = db.run(
    "UPDATE member_subscriptions SET sessions_used = sessions_used + 1, updated_at = ? WHERE id = ? AND sessions_total IS NOT NULL AND sessions_used < sessions_total",
    [nowStamp(), subscriptionId],
  );
  if (Number(updated.changes) !== 1) {
    throw Object.assign(new Error("session consumption race"), { code: "CONFLICT" });
  }
}

export async function recordCheckIn(
  db: Db,
  actor: ServiceActor,
  input: { barcode: string; deviceIdentifier?: string },
): Promise<CheckInResult> {
  requirePermission(actor, "checkin.create");
  const barcode = input.barcode.trim().toUpperCase();
  if (barcode === "") return { kind: "denied", reason: "CARD_UNKNOWN", barcode };

  const card = getCardByBarcode(db, barcode);
  if (!card) return { kind: "denied", reason: "CARD_UNKNOWN", barcode };
  if (card.status === "lost") return { kind: "denied", reason: "CARD_LOST", barcode };
  if (card.status === "blocked") return { kind: "denied", reason: "CARD_BLOCKED", barcode };
  if (!card.member_id) return { kind: "denied", reason: "CARD_NOT_LINKED", barcode };

  const member = getMemberRowById(db, card.member_id);
  if (!member) return { kind: "denied", reason: "CARD_NOT_LINKED", barcode };
  if (member.deleted_at) {
    return {
      kind: "denied",
      reason: "MEMBER_DELETED",
      barcode,
      memberName: member.full_name,
    };
  }
  if (member.status !== "active") {
    return {
      kind: "denied",
      reason: "MEMBER_INACTIVE",
      barcode,
      memberName: member.full_name,
    };
  }

  const today = todayKey();

  // Auto-unfreeze: if no active subscription, check for a suspended (frozen) one in-date-window
  let subscription = findActiveSubscription(db, member.id, today);
  if (!subscription) {
    const frozenSub = db.first<{ id: string; end_date: string; frozen_at: string | null }>(
      "SELECT id, end_date, frozen_at FROM member_subscriptions WHERE member_id = ? AND status = 'suspended' AND start_date <= ? AND end_date >= ? LIMIT 1",
      [member.id, today, today],
    );
    if (frozenSub) {
      // Use the centralized unfreeze logic with auto-unfreeze flag
      await unfreezeSubscription(db, actor, frozenSub.id, { isAutoUnfreeze: true });
      subscription = findActiveSubscription(db, member.id, today);
    }
  }
  if (!subscription) {
    // No paid subscription: a live trial window is a targeted check-in
    // authority (business rule: trial users may attend during the trial).
    const trial = activeTrialForMember(db, member.id, today);
    if (trial) {
      const stampNow = nowStamp();
      const windowSeconds = duplicateWindowSeconds(db);
      const lastVisit = db.first<AttendanceRow>(
        "SELECT * FROM attendance WHERE deleted_at IS NULL AND member_id = ? ORDER BY checkin_at DESC LIMIT 1",
        [member.id],
      );
      if (lastVisit) {
        const secondsAgo = secondsBetweenStamps(stampNow, lastVisit.checkin_at);
        if (secondsAgo < windowSeconds) {
          return {
            kind: "duplicate",
            secondsAgo,
            memberName: member.full_name,
            memberCode: member.member_code,
          };
        }
      }
      const attendanceId = crypto.randomUUID();
      await db.transaction(async () => {
        db.run(
          "INSERT INTO attendance (id, member_id, card_id, subscription_id, checkin_at, created_by, device_identifier, notes)\nVALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
          [
            attendanceId,
            member.id,
            card.id,
            stampNow,
            actor.userId,
            input.deviceIdentifier ?? null,
            `trial:${trial.id}`,
          ],
        );
        recordAudit(db, actor, "CHECKIN_RECORDED", "attendance", attendanceId, {
          memberCode: member.member_code,
          barcode,
          trialId: trial.id,
        });
        applyEarnRule(db, actor, member.id, "checkin", "attendance", attendanceId, { reason: "checkin:trial" });
      });
      return {
        kind: "success",
        attendanceId,
        memberName: member.full_name,
        memberCode: member.member_code,
        photoFileId: member.photo_file_id,
        planName: `trial:${trial.trialType}`,
        subscriptionEndsAt: trial.endDate,
        sessionsRemaining: null,
        outstandingMinor: memberOutstandingMinor(db, member.id),
      };
    }
    return {
      kind: "denied",
      reason: "NO_ACTIVE_SUBSCRIPTION",
      barcode,
      memberName: member.full_name,
    };
  }
  const planKind = (subscription.plan_kind ?? "time") as "time" | "sessions" | "open";
  const sessionsTotal =
    subscription.sessions_total == null ? null : Number(subscription.sessions_total);
  const sessionsRemaining =
    sessionsTotal == null ? null : Math.max(0, sessionsTotal - Number(subscription.sessions_used ?? 0));
  if (planKind === "sessions" && sessionsTotal != null && (sessionsRemaining ?? 0) <= 0) {
    return {
      kind: "denied",
      reason: "NO_SESSIONS_LEFT",
      barcode,
      memberName: member.full_name,
    };
  }

  const stampNow = nowStamp();
  const windowSeconds = duplicateWindowSeconds(db);

  // The duplicate-window check (read last visit + compare) is performed INSIDE
  // the write transaction (BEGIN IMMEDIATE) so two very quick scans for the same
  // member serialize and can't both pass before either insert commits — a
  // double-scan must not consume two session credits or record two identical
  // check-ins.
  let duplicateResult: CheckInResult | null = null;

  const attendanceId = crypto.randomUUID();
  try {
    await db.transaction(async () => {
      const lastVisit = db.first<AttendanceRow>(
        "SELECT * FROM attendance WHERE deleted_at IS NULL AND member_id = ? ORDER BY checkin_at DESC LIMIT 1",
        [member.id],
      );
      if (lastVisit) {
        const secondsAgo = secondsBetweenStamps(stampNow, lastVisit.checkin_at);
        if (secondsAgo < windowSeconds) {
          duplicateResult = {
            kind: "duplicate",
            secondsAgo,
            memberName: member.full_name,
            memberCode: member.member_code,
          };
          throw CHECKIN_DUPLICATE_SENTINEL;
        }
      }

      db.run(
        "INSERT INTO attendance (id, member_id, card_id, subscription_id, checkin_at, created_by, device_identifier, notes)\nVALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
        [
          attendanceId,
          member.id,
          card.id,
          subscription.id,
          stampNow,
          actor.userId,
          input.deviceIdentifier ?? null,
        ],
      );
      if (planKind === "sessions" && sessionsTotal != null) consumeSession(db, subscription.id);
      recordAudit(db, actor, "CHECKIN_RECORDED", "attendance", attendanceId, {
        memberCode: member.member_code,
        barcode,
      });
      applyEarnRule(db, actor, member.id, "checkin", "attendance", attendanceId, { reason: "checkin" });
    });
  } catch (error) {
    if (error === CHECKIN_DUPLICATE_SENTINEL) {
      // rollback already happened; swallow and report as a duplicate scan
    } else {
      throw error;
    }
  }

  if (duplicateResult) return duplicateResult;

  return {
    kind: "success",
    attendanceId,
    memberName: member.full_name,
    memberCode: member.member_code,
    photoFileId: member.photo_file_id,
    planName: subscription.plan_name,
    subscriptionEndsAt: subscription.end_date,
    sessionsRemaining:
      planKind === "sessions" && sessionsTotal != null ? (sessionsRemaining ?? 0) - 1 : null,
    outstandingMinor: memberOutstandingMinor(db, member.id),
  };
}

/** Money still owed by this member (active-subscription balance + open store debts). */
export function memberOutstandingMinor(db: Db, memberId: string): number {
  const subs = Number(
    db.scalar(
      `WITH paid AS (
        SELECT subscription_id, SUM(paid_amount_minor) AS p, SUM(discount_amount_minor) AS d
        FROM payments
        WHERE status IN ('partial', 'paid')
        GROUP BY subscription_id
      )
      SELECT COALESCE(SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(paid.p, 0) - COALESCE(paid.d, 0), 0)), 0)
      FROM member_subscriptions s
      LEFT JOIN paid ON paid.subscription_id = s.id
      WHERE s.member_id = ? AND s.status = 'active'`,
      [memberId],
    ) ?? 0,
  );
  const store = Number(
    db.scalar(
      "SELECT COALESCE(SUM(original_minor - paid_minor), 0) FROM store_debts WHERE member_id = ? AND status = 'open'",
      [memberId],
    ) ?? 0,
  );
  const credit = loyaltyUsableCreditMinor(db, memberId);
  return Math.max(0, subs + store - credit);
}

/** Optional check-out; enabled via attendance_checkout_enabled setting. */
export async function recordCheckOut(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): Promise<{ kind: "success"; checkoutAt: string } | { kind: "denied"; reason: "NOT_IN_OR_DONE" }> {
  requirePermission(actor, "checkin.create");
  const today = todayKey();
  const dayStart = `${today} 00:00:00`;
  const nextDayStart = `${addDaysKey(today, 1)} 00:00:00`;
  const open = db.first<{ id: string; checkin_at: string }>(
    "SELECT id, checkin_at FROM attendance\nWHERE deleted_at IS NULL AND member_id = ? AND checkin_at >= ? AND checkin_at < ? AND checkout_at IS NULL\nORDER BY checkin_at DESC LIMIT 1",
    [memberId, dayStart, nextDayStart],
  );
  if (!open) return { kind: "denied", reason: "NOT_IN_OR_DONE" };
  const checkoutAt = nowStamp();
  await db.transaction(async () => {
    db.run("UPDATE attendance SET checkout_at = ? WHERE id = ?", [checkoutAt, open.id]);
    recordAudit(db, actor, "CHECKOUT_RECORDED", "attendance", open.id, {});
  });
  return { kind: "success", checkoutAt };
}

interface RecentCheckInRow extends AttendanceRow {
  full_name: string;
  member_code: string;
}

function toRecent(row: RecentCheckInRow): RecentCheckIn {
  return {
    id: row.id,
    memberName: row.full_name,
    memberCode: row.member_code,
    checkinAt: row.checkin_at,
    deviceIdentifier: row.device_identifier,
  };
}

export function listRecentCheckIns(
  db: Db,
  actor: ServiceActor,
  limit = 8,
): RecentCheckIn[] {
  requirePermission(actor, "checkin.view_history");
  return db
    .all<RecentCheckInRow>(
      "SELECT a.*, m.full_name, m.member_code\nFROM attendance a JOIN members m ON m.id = a.member_id\nWHERE a.deleted_at IS NULL\nORDER BY a.checkin_at DESC LIMIT ?",
      [limit],
    )
    .map(toRecent);
}

export function countCheckInsOnDate(db: Db, dateKey: string): number {
  return db.count(
    "SELECT COUNT(*) FROM attendance WHERE deleted_at IS NULL AND checkin_at >= ? AND checkin_at < ?",
    [`${dateKey} 00:00:00`, `${addDaysKey(dateKey, 1)} 00:00:00`],
  );
}

export function listAttendanceForMember(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  limit = 30,
): AttendanceRow[] {
  requirePermission(actor, "checkin.view_history");
  return db.all<AttendanceRow>(
    "SELECT * FROM attendance WHERE deleted_at IS NULL AND member_id = ? ORDER BY checkin_at DESC LIMIT ?",
    [memberId, limit],
  );
}

export function deleteAttendance(
  db: Db,
  actor: ServiceActor,
  attendanceId: string,
): void {
  requirePermission(actor, "checkin.delete");
  const row = db.first<AttendanceRow>(
    "SELECT * FROM attendance WHERE id = ?",
    [attendanceId],
  );
  if (!row) throw errNotFound("errors.attendanceNotFound");
  db.transaction(() => {
    db.run("UPDATE attendance SET deleted_at = ? WHERE id = ?", [nowStamp(), attendanceId]);
    recordAudit(db, actor, "ATTENDANCE_DELETED", "attendance", attendanceId, {
      memberId: row.member_id,
      checkinAt: row.checkin_at,
    });
  });
}

export function restoreAttendance(
  db: Db,
  actor: ServiceActor,
  attendanceId: string,
): void {
  requirePermission(actor, "checkin.delete");
  const row = db.first<AttendanceRow>(
    "SELECT * FROM attendance WHERE id = ?",
    [attendanceId],
  );
  if (!row) throw errNotFound("errors.attendanceNotFound");
  db.transaction(() => {
    db.run("UPDATE attendance SET deleted_at = NULL WHERE id = ?", [attendanceId]);
    recordAudit(db, actor, "ATTENDANCE_RESTORED", "attendance", attendanceId, {
      memberId: row.member_id,
      checkinAt: row.checkin_at,
    });
  });
}

export interface AttendanceDayPoint {
  date: string;
  count: number;
}

interface DayCountRow extends Row {
  day: string;
  total: number;
}

export function attendanceSeries(db: Db, days: number): AttendanceDayPoint[] {
  const today = todayKey();
  const startDate = addDaysKey(today, -(days - 1));
  const counts = new Map<string, number>();
  const rows = db.all<DayCountRow>(
    "SELECT substr(checkin_at, 1, 10) AS day, COUNT(*) AS total\nFROM attendance WHERE deleted_at IS NULL AND substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?\nGROUP BY day",
    [startDate, today],
  );
  for (const row of rows) counts.set(row.day, Number(row.total));

  const points: AttendanceDayPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDaysKey(today, -offset);
    points.push({ date, count: counts.get(date) ?? 0 });
  }
  return points;
}
