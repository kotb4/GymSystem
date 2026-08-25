import { addDaysKey, nowStamp, secondsBetweenStamps, todayKey } from "@/core/dates";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getCardByBarcode } from "./cards.service";
import { readSetting, SETTING_KEYS } from "./settings.service";
import { getMemberRowById } from "./members.service";

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
      planName: string | null;
      subscriptionEndsAt: string;
      sessionsRemaining?: number | null;
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
 */
function findActiveSubscription(db: Db, memberId: string, today: string): ActiveSubRow | null {
  const rows = db.all<ActiveSubRow>(
    "SELECT s.id, s.end_date, p.name AS plan_name, p.kind AS plan_kind, s.sessions_total, s.sessions_used\nFROM member_subscriptions s\nJOIN membership_plans p ON p.id = s.plan_id\nWHERE s.member_id = ? AND s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?\nORDER BY (CASE WHEN p.kind = 'sessions' THEN 0 ELSE 1 END), s.end_date DESC",
    [memberId, today, today],
  );
  for (const row of rows) {
    if ((row.plan_kind ?? "time") === "sessions") {
      const remaining = Number(row.sessions_total ?? 0) - Number(row.sessions_used ?? 0);
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
  const subscription = findActiveSubscription(db, member.id, today);
  if (!subscription) {
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
  if (planKind === "sessions" && (sessionsRemaining ?? 0) <= 0) {
    return {
      kind: "denied",
      reason: "NO_SESSIONS_LEFT",
      barcode,
      memberName: member.full_name,
    };
  }

  const stampNow = nowStamp();
  const windowSeconds = duplicateWindowSeconds(db);
  const lastVisit = db.first<AttendanceRow>(
    "SELECT * FROM attendance WHERE member_id = ? ORDER BY checkin_at DESC LIMIT 1",
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
    if (planKind === "sessions") consumeSession(db, subscription.id);
    recordAudit(db, actor, "CHECKIN_RECORDED", "attendance", attendanceId, {
      memberCode: member.member_code,
      barcode,
    });
  });

  return {
    kind: "success",
    attendanceId,
    memberName: member.full_name,
    memberCode: member.member_code,
    planName: subscription.plan_name,
    subscriptionEndsAt: subscription.end_date,
    sessionsRemaining:
      planKind === "sessions" ? (sessionsRemaining ?? 0) - 1 : null,
  };
}

/** Optional check-out; enabled via attendance_checkout_enabled setting. */
export async function recordCheckOut(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): Promise<{ kind: "success"; checkoutAt: string } | { kind: "denied"; reason: "NOT_IN_OR_DONE" }> {
  requirePermission(actor, "checkin.create");
  const today = todayKey();
  const open = db.first<{ id: string; checkin_at: string }>(
    "SELECT id, checkin_at FROM attendance\nWHERE member_id = ? AND substr(checkin_at, 1, 10) = ? AND checkout_at IS NULL\nORDER BY checkin_at DESC LIMIT 1",
    [memberId, today],
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
      "SELECT a.*, m.full_name, m.member_code\nFROM attendance a JOIN members m ON m.id = a.member_id\nORDER BY a.checkin_at DESC LIMIT ?",
      [limit],
    )
    .map(toRecent);
}

export function countCheckInsOnDate(db: Db, dateKey: string): number {
  return db.count(
    "SELECT COUNT(*) FROM attendance WHERE substr(checkin_at, 1, 10) = ?",
    [dateKey],
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
    "SELECT * FROM attendance WHERE member_id = ? ORDER BY checkin_at DESC LIMIT ?",
    [memberId, limit],
  );
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
    "SELECT substr(checkin_at, 1, 10) AS day, COUNT(*) AS total\nFROM attendance WHERE substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?\nGROUP BY day",
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
