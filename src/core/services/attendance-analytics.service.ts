import { addDaysKey } from "@/core/dates";
import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AttendanceAnalytics {
  visits: number;
  uniqueMembers: number;
  daily: Array<{ date: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
  topMembers: MemberVisitRow[];
  leastMembers: MemberVisitRow[];
}

export interface MemberVisitRow {
  memberId: string;
  memberCode: string;
  memberName: string;
  visits: number;
  lastVisitAt: string | null;
}

function assertRange(fromKey: string, toKey: string): void {
  if (!DATE_RE.test(fromKey) || !DATE_RE.test(toKey)) throw errValidation("errors.invalidDate");
  if (fromKey > toKey) throw errValidation("errors.invalidRange");
}

export function getAttendanceAnalytics(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string; branchId?: string },
): AttendanceAnalytics {
  requirePermission(actor, "checkin.view_history");
  assertRange(range.fromKey, range.toKey);
  const { fromKey, toKey, branchId } = range;
  const targetBranch = branchId && branchId !== "all" ? branchId : undefined;
  const branchClause = targetBranch ? " AND COALESCE(branch_id, 'main') = ?" : "";
  const aBranchClause = targetBranch ? " AND COALESCE(a.branch_id, 'main') = ?" : "";
  const branchParams = targetBranch ? [targetBranch] : [];

  const visits = db.count(
    `SELECT COUNT(*) FROM attendance WHERE deleted_at IS NULL AND substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?${branchClause}`,
    [fromKey, toKey, ...branchParams],
  );
  const uniqueMembers = db.count(
    `SELECT COUNT(DISTINCT member_id) FROM attendance WHERE deleted_at IS NULL AND substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?${branchClause}`,
    [fromKey, toKey, ...branchParams],
  );

  const dayRows = db.all<{ day: string; total: number }>(
    `SELECT substr(checkin_at, 1, 10) AS day, COUNT(*) AS total
FROM attendance WHERE deleted_at IS NULL AND substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?${branchClause}
GROUP BY day ORDER BY day`,
    [fromKey, toKey, ...branchParams],
  );
  const byDay = new Map(dayRows.map((r) => [r.day, Number(r.total)]));
  const daily: Array<{ date: string; count: number }> = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    daily.push({ date: cursor, count: byDay.get(cursor) ?? 0 });
    cursor = addDaysKey(cursor, 1);
  }

  const hourRows = db.all<{ hour: number; total: number }>(
    `SELECT CAST(substr(checkin_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS total
FROM attendance WHERE deleted_at IS NULL AND substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?${branchClause}
GROUP BY hour ORDER BY hour`,
    [fromKey, toKey, ...branchParams],
  );
  const peakHours = hourRows.map((row) => ({ hour: Number(row.hour), count: Number(row.total) }));

  const memberSql =
    `SELECT a.member_id,
  m.member_code AS member_code,
  m.full_name AS full_name,
  COUNT(*) AS visits,
  MAX(a.checkin_at) AS last_visit
FROM attendance a JOIN members m ON m.id = a.member_id
WHERE substr(a.checkin_at, 1, 10) >= ? AND substr(a.checkin_at, 1, 10) <= ? AND m.status != 'archived'${aBranchClause}
GROUP BY a.member_id`;
  const allMemberRows = db.all<{
    member_id: string;
    member_code: string;
    full_name: string;
    visits: number;
    last_visit: string;
  }>(memberSql, [fromKey, toKey, ...branchParams]);
  const mapped: MemberVisitRow[] = allMemberRows.map((row) => ({
    memberId: row.member_id,
    memberCode: row.member_code,
    memberName: row.full_name,
    visits: Number(row.visits),
    lastVisitAt: row.last_visit,
  }));
  const sorted = [...mapped].sort((a, b) => b.visits - a.visits || a.memberName.localeCompare(b.memberName));
  return {
    visits,
    uniqueMembers,
    daily,
    peakHours,
    topMembers: sorted.slice(0, 5),
    leastMembers: [...sorted].reverse().slice(0, 5),
  };
}

export interface PeakHeatmapCell {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  hour: number;      // 0..23
  count: number;
}

export interface PeakHoursHeatmapData {
  matrix: PeakHeatmapCell[];
  maxCount: number;
  totalVisits: number;
  busiestDayOfWeek: number;
  busiestHour: number;
}

/**
 * 7x24 Matrix of attendance checkins by Day of Week and Hour of Day.
 * SQLite strftime('%w', checkin_at) returns '0' for Sunday .. '6' for Saturday.
 */
export function getPeakHoursHeatmap(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string; branchId?: string },
): PeakHoursHeatmapData {
  requirePermission(actor, "checkin.view_history");
  assertRange(range.fromKey, range.toKey);
  const { fromKey, toKey, branchId } = range;
  const targetBranch = branchId && branchId !== "all" ? branchId : undefined;
  const branchClause = targetBranch ? " AND COALESCE(branch_id, 'main') = ?" : "";
  const branchParams = targetBranch ? [targetBranch] : [];

  const rows = db.all<{ dow: number; hour: number; total: number }>(
    `SELECT 
       CAST(strftime('%w', checkin_at) AS INTEGER) AS dow,
       CAST(substr(checkin_at, 12, 2) AS INTEGER) AS hour,
       COUNT(*) AS total
     FROM attendance
     WHERE deleted_at IS NULL
       AND substr(checkin_at, 1, 10) >= ?
       AND substr(checkin_at, 1, 10) <= ?${branchClause}
     GROUP BY dow, hour`,
    [fromKey, toKey, ...branchParams],
  );

  const cellMap = new Map<string, number>();
  let maxCount = 0;
  let totalVisits = 0;
  const dowTotals = new Array(7).fill(0);
  const hourTotals = new Array(24).fill(0);

  for (const r of rows) {
    const dow = Number(r.dow);
    const hour = Number(r.hour);
    const count = Number(r.total);
    cellMap.set(`${dow}:${hour}`, count);
    if (count > maxCount) maxCount = count;
    totalVisits += count;
    if (dow >= 0 && dow < 7) dowTotals[dow] += count;
    if (hour >= 0 && hour < 24) hourTotals[hour] += count;
  }

  const matrix: PeakHeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      matrix.push({
        dayOfWeek: dow,
        hour,
        count: cellMap.get(`${dow}:${hour}`) ?? 0,
      });
    }
  }

  let busiestDayOfWeek = 0;
  let maxDowTotal = -1;
  dowTotals.forEach((val, idx) => {
    if (val > maxDowTotal) {
      maxDowTotal = val;
      busiestDayOfWeek = idx;
    }
  });

  let busiestHour = 0;
  let maxHourTotal = -1;
  hourTotals.forEach((val, idx) => {
    if (val > maxHourTotal) {
      maxHourTotal = val;
      busiestHour = idx;
    }
  });

  return {
    matrix,
    maxCount,
    totalVisits,
    busiestDayOfWeek,
    busiestHour,
  };
}

