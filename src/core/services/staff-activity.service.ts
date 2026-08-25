import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StaffActivityEntry {
  userId: string | null;
  userName: string;
  action: string;
  count: number;
  lastAt: string;
}

export interface StaffActivityReport {
  entries: StaffActivityEntry[];
  totalActions: number;
}

interface GroupRow extends Row {
  user_id: string | null;
  user_name: string;
  action: string;
  cnt: number;
  last_at: string;
}

export function getStaffActivity(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string },
): StaffActivityReport {
  requirePermission(actor, "audit.view");
  if (!DATE_RE.test(range.fromKey) || !DATE_RE.test(range.toKey)) {
    throw errValidation("errors.invalidDate");
  }
  if (range.fromKey > range.toKey) throw errValidation("errors.invalidRange");

  const rows = db.all<GroupRow>(
    "SELECT user_id, user_name, action, COUNT(*) AS cnt, MAX(created_at) AS last_at\nFROM audit_logs\nWHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?\nGROUP BY user_id, user_name, action\nORDER BY cnt DESC, last_at DESC",
    [range.fromKey, range.toKey],
  );

  const entries: StaffActivityEntry[] = rows.map((row) => ({
    userId: row.user_id,
    userName: row.user_name,
    action: row.action,
    count: Number(row.cnt),
    lastAt: row.last_at,
  }));

  return {
    entries,
    totalActions: entries.reduce((sum, entry) => sum + entry.count, 0),
  };
}
