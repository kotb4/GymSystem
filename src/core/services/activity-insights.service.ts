import { addDaysKey, todayKey } from "@/core/dates";
import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import {
  departmentScopeCondition,
  mayBypassDepartment,
} from "./department";
import { getInactiveDays } from "./settings.service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InactiveMemberRow {
  memberId: string;
  memberCode: string;
  memberName: string;
  department: string;
  lastVisitAt: string | null;
  daysSinceLastVisit: number;
}

export interface VisitorSplit {
  newMembers: number;
  returning: number;
}

export interface DayOfWeekPoint {
  dow: number; // 0 = Sunday .. 6 = Saturday
  count: number;
}

export interface DepartmentPoint {
  department: string; // 'men' | 'women' | 'general'
  count: number;
}

export interface RetentionInsights {
  range: { fromKey: string; toKey: string };
  inactiveThresholdDays: number;
  inactiveMembers: InactiveMemberRow[];
  inactiveWithActiveSub: number;
  visitorSplit: VisitorSplit;
  totalVisitors: number;
  avgCheckinsPerVisitingMember: number;
  byDayOfWeek: DayOfWeekPoint[];
  byDepartment: DepartmentPoint[];
}

function assertRange(fromKey: string, toKey: string): void {
  if (!DATE_RE.test(fromKey) || !DATE_RE.test(toKey)) throw errValidation("errors.invalidDate");
  if (fromKey > toKey) throw errValidation("errors.invalidRange");
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/**
 * Retention & activity analytics: which members are drifting away, how many
 * visitors were new vs returning, visit frequency, attendance by day-of-week
 * and by department. Pure read aggregations — no schema change, gated by
 * `reports.view`, department-scoped for men/women staff.
 */
export function getRetentionInsights(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string },
): RetentionInsights {
  requirePermission(actor, "reports.view");
  assertRange(range.fromKey, range.toKey);
  const { fromKey, toKey } = range;
  const today = todayKey();
  const threshold = getInactiveDays(db);
  const cutoffStamp = `${addDaysKey(today, -threshold)} 23:59:59`;

  const bypass = mayBypassDepartment(actor);

  // ---- Inactive members: active + active/paid-ish subscription, no visit.
  let inactiveSql =
    "SELECT m.id AS member_id,\n  m.member_code AS member_code,\n  m.full_name AS member_name,\n  m.department AS department,\n  (SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL) AS last_visit\nFROM members m\nWHERE m.deleted_at IS NULL AND m.status = 'active'\nAND EXISTS (SELECT 1 FROM member_subscriptions s WHERE s.member_id = m.id AND s.status = 'active' AND s.end_date >= ?)\nAND COALESCE((SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL), '') <= ?";
  const inactiveParams: Array<string | number> = [today, cutoffStamp];
  if (!bypass) {
    const scoped = departmentScopeCondition(actor);
    inactiveSql += scoped.sql;
    inactiveParams.push(...scoped.params);
  }
  const inactiveRows = db.all<Row>(inactiveSql, inactiveParams);

  const inactiveMembers: InactiveMemberRow[] = inactiveRows.map((r) => {
    const last = str(r.last_visit);
    const lastKey = last ? last.slice(0, 10) : null;
    const days = lastKey ? Math.max(0, diffDays(lastKey, today)) : threshold;
    return {
      memberId: str(r.member_id),
      memberCode: str(r.member_code),
      memberName: str(r.member_name),
      department: str(r.department) || "general",
      lastVisitAt: last || null,
      daysSinceLastVisit: days,
    };
  });

  // ---- Visitors in range (dept-scoped): total, unique, new vs returning.
  let visitorFilter = "a.deleted_at IS NULL AND substr(a.checkin_at, 1, 10) >= ? AND substr(a.checkin_at, 1, 10) <= ?";
  const visitorParams: Array<string | number> = [fromKey, toKey];
  if (!bypass) {
    // Scope by the visiting member's department.
    const scope = departmentScopeCondition(actor);
    visitorFilter += ` AND ${scope.sql.replace(/m\./g, "m2.")}`;
    visitorParams.push(...scope.params);
  }

  const visitsTotal = db.count(
    `SELECT COUNT(*) FROM attendance a JOIN members m2 ON m2.id = a.member_id WHERE ${visitorFilter}`,
    visitorParams,
  );
  const uniqueRows = db.all<{ member_id: string }>(
    `SELECT DISTINCT a.member_id AS member_id
     FROM attendance a JOIN members m2 ON m2.id = a.member_id
     WHERE ${visitorFilter}`,
    visitorParams,
  );
  const uniqueMembers = uniqueRows.length;
  let newMembers = 0;
  for (const row of uniqueRows) {
    const memberId = str(row.member_id);
    const firstStamp = db.scalar(
      "SELECT MIN(checkin_at) FROM attendance WHERE member_id = ? AND deleted_at IS NULL",
      [memberId],
    );
    const firstKey = firstStamp ? String(firstStamp).slice(0, 10) : toKey;
    // A visitor is "new" when this period holds their very first check-in.
    if (firstKey >= fromKey && firstKey <= toKey) newMembers += 1;
  }
  const returning = uniqueMembers - newMembers;

  const avgCheckinsPerVisitingMember =
    uniqueMembers > 0 ? Math.round((visitsTotal / uniqueMembers) * 100) / 100 : 0;

  // ---- Attendance by day of week (0 = Sunday .. 6 = Saturday).
  const dowRows = db.all<{ dow: number; total: number }>(
    `SELECT CAST(strftime('%w', a.checkin_at) AS INTEGER) AS dow, COUNT(*) AS total
     FROM attendance a JOIN members m2 ON m2.id = a.member_id
     WHERE ${visitorFilter}
     GROUP BY dow ORDER BY dow`,
    visitorParams,
  );
  const dowMap = new Map<number, number>();
  for (const r of dowRows) dowMap.set(Number(r.dow), Number(r.total));
  const byDayOfWeek: DayOfWeekPoint[] = [];
  for (let d = 0; d <= 6; d++) byDayOfWeek.push({ dow: d, count: dowMap.get(d) ?? 0 });

  // ---- Attendance by department.
  const deptRows = db.all<{ department: string; total: number }>(
    `SELECT COALESCE(m2.department, 'general') AS department, COUNT(*) AS total
     FROM attendance a JOIN members m2 ON m2.id = a.member_id
     WHERE ${visitorFilter}
     GROUP BY m2.department`,
    visitorParams,
  );
  const deptMap = new Map<string, number>();
  for (const r of deptRows) deptMap.set(str(r.department) || "general", Number(r.total));

  return {
    range: { fromKey, toKey },
    inactiveThresholdDays: threshold,
    inactiveMembers,
    inactiveWithActiveSub: inactiveMembers.length,
    visitorSplit: { newMembers, returning },
    totalVisitors: visitsTotal,
    avgCheckinsPerVisitingMember,
    byDayOfWeek,
    byDepartment: ["general", "men", "women"]
      .filter((d) => deptMap.has(d))
      .map((d) => ({ department: d, count: deptMap.get(d) ?? 0 })),
  };
}

function diffDays(fromKey: string, toKey: string): number {
  const a = fromKey.split("-").map(Number);
  const b = toKey.split("-").map(Number);
  const utc = Date.UTC;
  return Math.round((utc(b[0], b[1] - 1, b[2]) - utc(a[0], a[1] - 1, a[2])) / 86400000);
}