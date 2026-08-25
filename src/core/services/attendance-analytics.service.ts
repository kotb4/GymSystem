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
  range: { fromKey: string; toKey: string },
): AttendanceAnalytics {
  requirePermission(actor, "checkin.view_history");
  assertRange(range.fromKey, range.toKey);
  const { fromKey, toKey } = range;

  const visits = db.count(
    "SELECT COUNT(*) FROM attendance WHERE substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?",
    [fromKey, toKey],
  );
  const uniqueMembers = db.count(
    "SELECT COUNT(DISTINCT member_id) FROM attendance WHERE substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?",
    [fromKey, toKey],
  );

  const dayRows = db.all<{ day: string; total: number }>(
    "SELECT substr(checkin_at, 1, 10) AS day, COUNT(*) AS total\nFROM attendance WHERE substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?\nGROUP BY day ORDER BY day",
    [fromKey, toKey],
  );
  const byDay = new Map(dayRows.map((r) => [r.day, Number(r.total)]));
  const daily: Array<{ date: string; count: number }> = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    daily.push({ date: cursor, count: byDay.get(cursor) ?? 0 });
    cursor = addDaysKey(cursor, 1);
  }

  const hourRows = db.all<{ hour: number; total: number }>(
    "SELECT CAST(substr(checkin_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS total\nFROM attendance WHERE substr(checkin_at, 1, 10) >= ? AND substr(checkin_at, 1, 10) <= ?\nGROUP BY hour ORDER BY hour",
    [fromKey, toKey],
  );
  const peakHours = hourRows.map((row) => ({ hour: Number(row.hour), count: Number(row.total) }));

  const memberSql =
    "SELECT a.member_id,\n  m.member_code AS member_code,\n  m.full_name AS full_name,\n  COUNT(*) AS visits,\n  MAX(a.checkin_at) AS last_visit\nFROM attendance a JOIN members m ON m.id = a.member_id\nWHERE substr(a.checkin_at, 1, 10) >= ? AND substr(a.checkin_at, 1, 10) <= ? AND m.status != 'archived'\nGROUP BY a.member_id";
  const allMemberRows = db.all<{
    member_id: string;
    member_code: string;
    full_name: string;
    visits: number;
    last_visit: string;
  }>(memberSql, [fromKey, toKey]);
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
