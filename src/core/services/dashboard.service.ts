import { todayKey } from "@/core/dates";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import {
  attendanceSeries,
  countCheckInsOnDate,
  type AttendanceDayPoint,
} from "./attendance.service";
import {
  countActiveSubscriptions,
  listExpiringSubscriptions,
  type SubscriptionWithMember,
} from "./subscriptions.service";

export interface DashboardStats {
  totalMembers: number;
  activeMembers: number;
  activeSubscriptions: number;
  checkinsToday: number;
}

export function getDashboardStats(db: Db, actor: ServiceActor): DashboardStats {
  requirePermission(actor, "members.view");
  return {
    totalMembers: db.count("SELECT COUNT(*) FROM members WHERE status != 'archived'"),
    activeMembers: db.count("SELECT COUNT(*) FROM members WHERE status = 'active'"),
    activeSubscriptions: countActiveSubscriptions(db),
    checkinsToday: countCheckInsOnDate(db, todayKey()),
  };
}

export function getDashboardAttendance(
  db: Db,
  actor: ServiceActor,
  days: 7 | 30,
): AttendanceDayPoint[] {
  requirePermission(actor, "members.view");
  return attendanceSeries(db, days);
}

export function getExpiringForDashboard(
  db: Db,
  actor: ServiceActor,
  withinDays = 7,
): SubscriptionWithMember[] {
  requirePermission(actor, "subscriptions.view");
  return listExpiringSubscriptions(db, actor, withinDays);
}

interface OutstandingRow {
  cnt: number;
  total_minor: number;
}

export interface DashboardOperationalStats {
  /** Members with at least one active subscription not fully paid. */
  membersWithOutstanding: number;
  outstandingTotalMinor: number;
  expiredSubscriptions: number;
  lostCards: number;
  busyHoursToday: Array<{ hour: number; count: number }>;
}

export function getDashboardOperational(
  db: Db,
  actor: ServiceActor,
): DashboardOperationalStats {
  requirePermission(actor, "payments.view");
  const balanceRow = db.first<OutstandingRow>(
    "WITH paid AS (\n  SELECT subscription_id, SUM(paid_amount_minor) AS paid_minor\n  FROM payments\n  WHERE subscription_id IS NOT NULL AND status IN ('partial', 'paid')\n  GROUP BY subscription_id\n)\nSELECT COUNT(*) AS cnt,\n  COALESCE(SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(p.paid_minor, 0), 0)), 0) AS total_minor\nFROM member_subscriptions s\nLEFT JOIN paid p ON p.subscription_id = s.id\nWHERE s.status = 'active'",
  );
  const hourRows = db.all<{ hour: number; total: number }>(
    "SELECT CAST(substr(checkin_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS total\nFROM attendance WHERE substr(checkin_at, 1, 10) = ?\nGROUP BY hour ORDER BY total DESC LIMIT 5",
    [todayKey()],
  );
  return {
    membersWithOutstanding: Number(balanceRow?.cnt ?? 0),
    outstandingTotalMinor: Number(balanceRow?.total_minor ?? 0),
    expiredSubscriptions: db.count(
      "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active' AND end_date < ?",
      [todayKey()],
    ),
    lostCards: db.count("SELECT COUNT(*) FROM cards WHERE status = 'lost'"),
    busyHoursToday: hourRows.map((row) => ({
      hour: Number(row.hour),
      count: Number(row.total),
    })),
  };
}
