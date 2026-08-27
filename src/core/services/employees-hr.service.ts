import { errConflict, errForbidden, errNotFound, errValidation } from "@/core/errors";
import { assertNonNegativeInteger } from "@/core/money";
import { requirePermission, roleHasPermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp, todayKey, isValidDateKey, diffDaysKeys } from "@/core/dates";
import { recordAudit } from "./audit.service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}

/** Resolve a settings string value with a fallback. */
function settingStr(db: Db, key: string, fallback = ""): string {
  const v = db.scalar("SELECT value FROM settings WHERE key = ?", [key]);
  return v == null ? fallback : String(v);
}
function settingNum(db: Db, key: string, fallback: number): number {
  const v = db.scalar("SELECT value FROM settings WHERE key = ?", [key]);
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getEmployee(db: Db, employeeId: string): Row {
  const row = db.first<Row>("SELECT * FROM employees WHERE id = ?", [employeeId]);
  if (!row) throw errNotFound("errors.employeeNotFound");
  return row;
}

/** Which employee(s) may the actor operate on? Resolves to an employee row or throws. */
function resolveTargetEmployee(
  db: Db,
  actor: ServiceActor,
  employeeId: string | null,
  allowManage: boolean,
): Row {
  if (employeeId) {
    const row = getEmployee(db, employeeId);
    if (!allowManage) {
      const mine = db.first<{ id: string }>("SELECT id FROM employees WHERE user_id = ?", [actor.userId]);
      if (!mine || str(mine.id) !== employeeId) throw errForbidden();
    }
    return row;
  }
  const mine = db.first<Row>("SELECT * FROM employees WHERE user_id = ?", [actor.userId]);
  if (!mine) throw errValidation("errors.hrNoEmployeeProfile");
  return mine;
}

/**
 * Department data isolation for employees. Employees have their own department;
 * a men/women-scoped actor may only see/manage employees of that department or
 * 'general'. Owner and anyone with `members.view_all_departments` bypass.
 */
function employeeDeptClause(actor: ServiceActor): { sql: string; params: Array<string | number> } {
  if (
    actor.roleId === "owner" ||
    roleHasPermission(actor.roleId, "members.view_all_departments")
  ) {
    return { sql: "", params: [] };
  }
  const dept = (actor.department ?? "general") as string;
  if (dept === "general") return { sql: "", params: [] };
  return { sql: " AND e.department IN (?, 'general')", params: [dept] };
}

/** Ensure the actor may act on a particular employee row (department gate). */
function assertEmployeeScopedAccess(actor: ServiceActor, employee: Row): void {
  if (
    actor.roleId === "owner" ||
    roleHasPermission(actor.roleId, "members.view_all_departments") ||
    (actor.department ?? "general") === "general"
  ) {
    return;
  }
  const dept = str(employee.department) || "general";
  if (dept !== actor.department && dept !== "general") throw errForbidden();
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LeaveType = "annual" | "sick" | "unpaid" | "emergency";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface PublicAttendance {
  id: string;
  employeeId: string;
  employeeName: string;
  dateKey: string;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number;
  isLate: boolean;
  notes: string | null;
}

export interface PublicLeave {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  requestedByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
}

export interface PublicHrAmount {
  id: string;
  employeeId: string;
  employeeName: string;
  amountMinor: number;
  reason: string;
  dateKey: string;
}

export interface MonthlySalarySummary {
  employeeId: string;
  employeeName: string;
  periodMonth: string;
  baseMinor: number;
  incentivesMinor: number;
  deductionsMinor: number;
  unpaidLeaveDays: number;
  unpaidLeaveImpactMinor: number;
  attendedDays: number;
  netMinor: number;
  alreadyRecorded: boolean;
}

export interface DailyActivityTotals {
  attendanceIn: number;
  attendanceOut: number;
  subscriptionsSold: number;
  subscriptionsTotalMinor: number;
  storeSales: number;
  storeSalesTotalMinor: number;
  paymentsReceived: number;
  paymentsTotalMinor: number;
  expensesRecorded: number;
  expensesTotalMinor: number;
  auditedActions: number;
}

export interface DailyActivityEntry {
  time: string;
  category: "attendance" | "subscription" | "sale" | "payment" | "expense" | "audit";
  label: string;
  reference: string | null;
  amountMinor: number;
}

export interface DailyActivityReport {
  employeeId: string;
  employeeName: string;
  dateKey: string;
  totals: DailyActivityTotals;
  entries: DailyActivityEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAttendance(r: Row, employeeName?: string): PublicAttendance {
  return {
    id: str(r.id),
    employeeId: str(r.employee_id),
    employeeName: str(r.employee_name ?? employeeName ?? ""),
    dateKey: str(r.date_key),
    clockInAt: str(r.clock_in_at),
    clockOutAt: r.clock_out_at == null ? null : str(r.clock_out_at),
    workedMinutes: num(r.worked_minutes),
    isLate: num(r.is_late) === 1,
    notes: r.notes == null ? null : str(r.notes),
  };
}

function publicLeave(r: Row, requestedName: string, approvedName: string | null): PublicLeave {
  const start = str(r.start_date);
  const end = str(r.end_date);
  return {
    id: str(r.id),
    employeeId: str(r.employee_id),
    employeeName: str(r.employee_name ?? ""),
    leaveType: str(r.leave_type) as LeaveType,
    startDate: start,
    endDate: end,
    days: diffDaysKeys(start, end) + 1,
    reason: r.reason == null ? null : str(r.reason),
    status: str(r.status) as LeaveStatus,
    requestedByName: requestedName,
    approvedByName: approvedName,
    approvedAt: r.approved_at == null ? null : str(r.approved_at),
    decisionNote: r.decision_note == null ? null : str(r.decision_note),
  };
}

/** Count approved annual-leave days of an employee consumed in `year`. */
function annualLeaveUsedDays(db: Db, employeeId: string, year: string): number {
  const rows = db.all<Row>(
    `SELECT start_date, end_date FROM employee_leaves
     WHERE employee_id = ? AND leave_type = 'annual' AND status = 'approved'
       AND (start_date LIKE ? OR end_date LIKE ? OR (start_date <= ? AND end_date >= ?))`,
    [employeeId, `${year}-%`, `${year}-%`, `${year}-12-31`, `${year}-01-01`],
  );
  let total = 0;
  for (const row of rows) {
    const start = str(row.start_date);
    const end = str(row.end_date);
    const os = start < `${year}-01-01` ? `${year}-01-01` : start;
    const oe = end > `${year}-12-31` ? `${year}-12-31` : end;
    if (os <= oe) total += diffDaysKeys(os, oe) + 1;
  }
  return total;
}

/** Total leave days (overlapping the given month) of an approved leave. */
function leaveDaysInMonth(startDate: string, endDate: string, month: string): number {
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const os = startDate < monthStart ? monthStart : startDate;
  const oe = endDate > monthEnd ? monthEnd : endDate;
  if (os > oe) return 0;
  return diffDaysKeys(os, oe) + 1;
}

function assertDateKey(value: string): string {
  const v = value.trim();
  if (!DATE_RE.test(v) || !isValidDateKey(v)) throw errValidation("errors.invalidDate");
  return v;
}

// ---------------------------------------------------------------------------
// Attendance (clock in / clock out)
// ---------------------------------------------------------------------------

function shiftStart(db: Db): string {
  return settingStr(db, "hr.shift_start", "").trim();
}

function isLateFor(db: Db, clockInAt: string): boolean {
  const shift = shiftStart(db);
  if (!shift) return false;
  const t = clockInAt.slice(11, 16);
  return t > shift;
}

function minutesBetween(later: string, earlier: string): number {
  const d = (new Date(later.replace(" ", "T")).getTime() - new Date(earlier.replace(" ", "T")).getTime()) / 60000;
  return Math.max(0, Math.floor(d));
}

/** Clock an employee in for the current (or explicit `dateKey`) day. */
export async function clockIn(
  db: Db,
  actor: ServiceActor,
  input: { employeeId?: string | null; at?: string | null; dateKey?: string | null; notes?: string | null },
): Promise<PublicAttendance> {
  requirePermission(actor, "hr.view");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const employee = resolveTargetEmployee(db, actor, input.employeeId ?? null, manage);
  assertEmployeeScopedAccess(actor, employee);

  const dateKey = input.dateKey ? assertDateKey(input.dateKey) : todayKey();
  const at = input.at?.trim() || nowStamp();

  const existing = db.first<Row>(
    "SELECT * FROM employee_attendance WHERE employee_id = ? AND date_key = ?",
    [str(employee.id), dateKey],
  );
  if (existing) throw errConflict("errors.hrAlreadyClockedIn");

  if (dateKey > todayKey()) throw errValidation("errors.hrDateFuture");

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO employee_attendance (id, employee_id, date_key, clock_in_at, clock_out_at, worked_minutes, is_late, notes, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)",
      [
        id,
        str(employee.id),
        dateKey,
        at,
        isLateFor(db, at) ? 1 : 0,
        input.notes?.trim() || null,
        actor.userId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "EMPLOYEE_ATTENDANCE_IN", "employee_attendance", id, {
      employee: str(employee.full_name),
      dateKey,
      at,
    });
  });
  return mapAttendance(db.first<Row>("SELECT * FROM employee_attendance WHERE id = ?", [id])!, str(employee.full_name));
}

/** Clock an employee out, computing worked time and late flag (if no clock-in yet today, rejects). */
export async function clockOut(
  db: Db,
  actor: ServiceActor,
  input: { employeeId?: string | null; at?: string | null; dateKey?: string | null },
): Promise<PublicAttendance> {
  requirePermission(actor, "hr.view");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const employee = resolveTargetEmployee(db, actor, input.employeeId ?? null, manage);
  assertEmployeeScopedAccess(actor, employee);

  const dateKey = input.dateKey ? assertDateKey(input.dateKey) : todayKey();
  const at = input.at?.trim() || nowStamp();

  const existing = db.first<Row>(
    "SELECT * FROM employee_attendance WHERE employee_id = ? AND date_key = ?",
    [str(employee.id), dateKey],
  );
  if (!existing) throw errNotFound("errors.hrNotClockedIn");
  if (existing.clock_out_at) throw errConflict("errors.hrAlreadyClockedOut");

  await db.transaction(async () => {
    db.run(
      "UPDATE employee_attendance SET clock_out_at = ?, worked_minutes = ?, updated_at = ? WHERE id = ?",
      [at, minutesBetween(at, str(existing.clock_in_at)), nowStamp(), str(existing.id)],
    );
    recordAudit(db, actor, "EMPLOYEE_ATTENDANCE_OUT", "employee_attendance", str(existing.id), {
      employee: str(employee.full_name),
      dateKey,
      at,
    });
  });
  return mapAttendance(
    db.first<Row>("SELECT * FROM employee_attendance WHERE id = ?", [str(existing.id)])!,
    str(employee.full_name),
  );
}

/** Manager records or edits an attendance row manually (e.g. forgot clock-out). */
export async function upsertAttendance(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; dateKey: string; clockInAt: string; clockOutAt?: string | null; notes?: string | null },
): Promise<PublicAttendance> {
  requirePermission(actor, "hr.manage");
  const employee = getEmployee(db, input.employeeId);
  assertEmployeeScopedAccess(actor, employee);

  const dateKey = assertDateKey(input.dateKey);
  const clockInAt = input.clockInAt.trim();
  if (!clockInAt) throw errValidation("errors.hrTimeInvalid");
  const clockOutAt = input.clockOutAt?.trim() || null;
  const worked = clockOutAt ? minutesBetween(clockOutAt, clockInAt) : 0;

  const existing = db.first<Row>(
    "SELECT * FROM employee_attendance WHERE employee_id = ? AND date_key = ?",
    [input.employeeId, dateKey],
  );
  const id = existing ? str(existing.id) : crypto.randomUUID();

  await db.transaction(async () => {
    const ts = nowStamp();
    if (existing) {
      db.run(
        "UPDATE employee_attendance SET clock_in_at = ?, clock_out_at = ?, worked_minutes = ?, is_late = ?, notes = ?, updated_at = ? WHERE id = ?",
        [clockInAt, clockOutAt, worked, isLateFor(db, clockInAt) ? 1 : 0, input.notes?.trim() || null, ts, id],
      );
    } else {
      db.run(
        "INSERT INTO employee_attendance (id, employee_id, date_key, clock_in_at, clock_out_at, worked_minutes, is_late, notes, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          input.employeeId,
          dateKey,
          clockInAt,
          clockOutAt,
          worked,
          isLateFor(db, clockInAt) ? 1 : 0,
          input.notes?.trim() || null,
          actor.userId,
          ts,
          ts,
        ],
      );
    }
    recordAudit(db, actor, "EMPLOYEE_ATTENDANCE_EDITED", "employee_attendance", id, {
      employee: str(employee.full_name),
      dateKey,
    });
  });
  return mapAttendance(db.first<Row>("SELECT * FROM employee_attendance WHERE id = ?", [id])!, str(employee.full_name));
}

/** List attendance for a month; scoped to self unless `hr.manage`. */
export function listAttendance(
  db: Db,
  actor: ServiceActor,
  query: { month?: string; employeeId?: string | null } = {},
): PublicAttendance[] {
  requirePermission(actor, "hr.view");
  const month = query.month?.trim() || todayKey().slice(0, 7);
  if (!MONTH_RE.test(month)) throw errValidation("errors.invalidPeriod");

  const conditions: string[] = ["substr(a.date_key, 1, 7) = ?"];
  const params: Array<string | number> = [month];

  if (roleHasPermission(actor.roleId, "hr.manage")) {
    if (query.employeeId) {
      const employee = getEmployee(db, query.employeeId);
      conditions.push("a.employee_id = ?");
      params.push(str(employee.id));
    } else {
      const dept = employeeDeptClause(actor);
      if (dept.sql) {
        conditions.push(`a.employee_id IN (SELECT id FROM employees e WHERE 1=1 ${dept.sql})`);
        params.push(...dept.params);
      }
    }
  } else {
    const mine = db.first<Row>("SELECT id FROM employees WHERE user_id = ?", [actor.userId]);
    if (!mine) return [];
    conditions.push("a.employee_id = ?");
    params.push(str(mine.id));
  }

  return db
    .all<Row>(
      `SELECT a.*, e.full_name AS employee_name
       FROM employee_attendance a JOIN employees e ON e.id = a.employee_id
       WHERE ${conditions.join(" AND ")} ORDER BY a.date_key DESC, a.clock_in_at DESC`,
      params,
    )
    .map((r) => mapAttendance(r));
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

/** Annual leave entitlement (days) for `year`, from settings or default 21. */
export function annualLeaveEntitlement(db: Db, year: string): number {
  void year;
  return Math.max(0, Math.round(settingNum(db, "hr.annual_leave_days", 21)));
}

export function getLeaveBalance(
  db: Db,
  actor: ServiceActor,
  input: { employeeId?: string | null; year?: string | null },
): { entitlement: number; used: number; remaining: number } {
  requirePermission(actor, "hr.view");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const employee = resolveTargetEmployee(db, actor, input.employeeId ?? null, manage);
  assertEmployeeScopedAccess(actor, employee);
  const year = input.year?.trim() || todayKey().slice(0, 4);
  if (!/^\d{4}$/.test(year)) throw errValidation("errors.invalidPeriod");
  const entitlement = annualLeaveEntitlement(db, year);
  const used = annualLeaveUsedDays(db, str(employee.id), year);
  return { entitlement, used, remaining: Math.max(0, entitlement - used) };
}

export async function requestLeave(
  db: Db,
  actor: ServiceActor,
  input: { employeeId?: string | null; leaveType: LeaveType; startDate: string; endDate: string; reason?: string | null },
): Promise<PublicLeave> {
  requirePermission(actor, "hr.view");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const employee = resolveTargetEmployee(db, actor, input.employeeId ?? null, manage);
  assertEmployeeScopedAccess(actor, employee);

  const start = assertDateKey(input.startDate);
  const end = assertDateKey(input.endDate);
  if (end < start) throw errValidation("errors.hrLeaveRangeInvalid");
  if (!["annual", "sick", "unpaid", "emergency"].includes(input.leaveType)) {
    throw errValidation("errors.hrLeaveTypeInvalid");
  }

  const year = start.slice(0, 4);
  if (input.leaveType === "annual") {
    const days = diffDaysKeys(start, end) + 1;
    const balance = getLeaveBalance(db, actor, { employeeId: str(employee.id), year });
    if (days > balance.remaining) {
      throw errConflict("errors.hrLeaveNoBalance", { remaining: String(balance.remaining) });
    }
  }

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO employee_leaves (id, employee_id, leave_type, start_date, end_date, reason, status, requested_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
      [
        id,
        str(employee.id),
        input.leaveType,
        start,
        end,
        input.reason?.trim() || null,
        actor.userId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "EMPLOYEE_LEAVE_REQUESTED", "employee_leave", id, {
      employee: str(employee.full_name),
      leaveType: input.leaveType,
      start,
      end,
    });
  });
  return publicLeave(
    db.first<Row>("SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?", [id])!,
    actor.username,
    null,
  );
}

function withRequestedName(db: Db, leave: Row, actor: ServiceActor): PublicLeave {
  const requested = db.first<{ username: string }>("SELECT username FROM users WHERE id = ?", [leave.requested_by]);
  const approved = leave.approved_by == null
    ? null
    : db.first<{ username: string }>("SELECT username FROM users WHERE id = ?", [leave.approved_by])?.username ?? null;
  return publicLeave(leave, str(requested?.username ?? actor.username), approved);
}

export function listLeaves(
  db: Db,
  actor: ServiceActor,
  query: { status?: LeaveStatus | "all"; employeeId?: string | null; month?: string | null } = {},
): PublicLeave[] {
  requirePermission(actor, "hr.view");
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status && query.status !== "all") {
    conditions.push("l.status = ?");
    params.push(query.status);
  }
  if (query.month) {
    const month = query.month.trim();
    if (!MONTH_RE.test(month)) throw errValidation("errors.invalidPeriod");
    conditions.push("(l.start_date LIKE ? OR l.end_date LIKE ? OR (l.start_date <= ? AND l.end_date >= ?))");
    params.push(`${month}-%`, `${month}-%`, `${month}-31`, `${month}-01`);
  }

  if (roleHasPermission(actor.roleId, "hr.manage")) {
    if (query.employeeId) {
      const employee = getEmployee(db, query.employeeId);
      conditions.push("l.employee_id = ?");
      params.push(str(employee.id));
    } else {
      const dept = employeeDeptClause(actor);
      if (dept.sql) {
        conditions.push(`l.employee_id IN (SELECT id FROM employees e WHERE 1=1 ${dept.sql})`);
        params.push(...dept.params);
      }
    }
  } else {
    const mine = db.first<Row>("SELECT id FROM employees WHERE user_id = ?", [actor.userId]);
    if (!mine) return [];
    conditions.push("l.employee_id = ?");
    params.push(str(mine.id));
  }

  const rows = db.all<Row>(
    `SELECT l.*, e.full_name AS employee_name
     FROM employee_leaves l JOIN employees e ON e.id = l.employee_id
     WHERE ${conditions.join(" AND ")} ORDER BY l.created_at DESC`,
    params,
  );
  return rows.map((r) => withRequestedName(db, r, actor));
}

/** Approve or reject a pending leave request (manager only). */
export async function decideLeave(
  db: Db,
  actor: ServiceActor,
  input: { leaveId: string; approve: boolean; decisionNote?: string | null },
): Promise<PublicLeave> {
  requirePermission(actor, "hr.approve_leaves");
  const leave = db.first<Row>(
    "SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?",
    [input.leaveId],
  );
  if (!leave) throw errNotFound("errors.hrLeaveNotFound");
  if (str(leave.status) !== "pending") throw errConflict("errors.hrLeaveAlreadyDecided");
  const employee = getEmployee(db, str(leave.employee_id));
  assertEmployeeScopedAccess(actor, employee);

  // re-check annual balance on approval
  if (input.approve && str(leave.leave_type) === "annual") {
    const year = str(leave.start_date).slice(0, 4);
    const days = diffDaysKeys(str(leave.start_date), str(leave.end_date)) + 1;
    if (days > annualLeaveEntitlement(db, year) - annualLeaveUsedDays(db, str(employee.id), year)) {
      throw errConflict("errors.hrLeaveNoBalance");
    }
  }

  await db.transaction(async () => {
    db.run(
      "UPDATE employee_leaves SET status = ?, approved_by = ?, approved_at = ?, decision_note = ?, updated_at = ? WHERE id = ?",
      [
        input.approve ? "approved" : "rejected",
        actor.userId,
        input.approve ? nowStamp() : null,
        input.decisionNote?.trim() || null,
        nowStamp(),
        input.leaveId,
      ],
    );
    recordAudit(db, actor, input.approve ? "EMPLOYEE_LEAVE_APPROVED" : "EMPLOYEE_LEAVE_REJECTED", "employee_leave", input.leaveId, {
      employee: str(employee.full_name),
      leaveType: str(leave.leave_type),
    });
  });
  const updated = db.first<Row>(
    "SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?",
    [input.leaveId],
  )!;
  return withRequestedName(db, updated, actor);
}

/** Cancel own pending leave (or a manager can cancel any). */
export async function cancelLeave(db: Db, actor: ServiceActor, leaveId: string): Promise<PublicLeave> {
  requirePermission(actor, "hr.view");
  const leave = db.first<Row>(
    "SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?",
    [leaveId],
  );
  if (!leave) throw errNotFound("errors.hrLeaveNotFound");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const isMine = str(leave.requested_by) === actor.userId;
  const employee = getEmployee(db, str(leave.employee_id));
  assertEmployeeScopedAccess(actor, employee);
  if (!manage && !isMine) throw errForbidden();
  if (str(leave.status) !== "pending") throw errConflict("errors.hrLeaveAlreadyDecided");

  await db.transaction(async () => {
    db.run("UPDATE employee_leaves SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowStamp(), leaveId]);
    recordAudit(db, actor, "EMPLOYEE_LEAVE_CANCELLED", "employee_leave", leaveId, {
      employee: str(employee.full_name),
    });
  });
  const updated = db.first<Row>(
    "SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?",
    [leaveId],
  )!;
  return withRequestedName(db, updated, actor);
}

// ---------------------------------------------------------------------------
// Deductions & incentives
// ---------------------------------------------------------------------------

function listHrAmounts(
  db: Db,
  actor: ServiceActor,
  table: "employee_deductions" | "employee_incentives",
  query: { month?: string; employeeId?: string | null } = {},
): PublicHrAmount[] {
  requirePermission(actor, "hr.view");
  const month = query.month?.trim() || todayKey().slice(0, 7);
  if (!MONTH_RE.test(month)) throw errValidation("errors.invalidPeriod");
  const conditions: string[] = ["substr(d.date_key, 1, 7) = ?"];
  const params: Array<string | number> = [month];
  if (roleHasPermission(actor.roleId, "hr.manage")) {
    if (query.employeeId) {
      const employee = getEmployee(db, query.employeeId);
      conditions.push("d.employee_id = ?");
      params.push(str(employee.id));
    } else {
      const dept = employeeDeptClause(actor);
      if (dept.sql) {
        conditions.push(`d.employee_id IN (SELECT id FROM employees e WHERE 1=1 ${dept.sql})`);
        params.push(...dept.params);
      }
    }
  } else {
    const mine = db.first<Row>("SELECT id FROM employees WHERE user_id = ?", [actor.userId]);
    if (!mine) return [];
    conditions.push("d.employee_id = ?");
    params.push(str(mine.id));
  }
  return db
    .all<Row>(
      `SELECT d.*, e.full_name AS employee_name
       FROM ${table} d JOIN employees e ON e.id = d.employee_id
       WHERE ${conditions.join(" AND ")} ORDER BY d.date_key DESC`,
      params,
    )
    .map((r) => ({
      id: str(r.id),
      employeeId: str(r.employee_id),
      employeeName: str(r.employee_name),
      amountMinor: num(r.amount_minor),
      reason: str(r.reason),
      dateKey: str(r.date_key),
    }));
}

export function listDeductions(db: Db, actor: ServiceActor, query?: { month?: string; employeeId?: string | null }): PublicHrAmount[] {
  return listHrAmounts(db, actor, "employee_deductions", query);
}

export function listIncentives(db: Db, actor: ServiceActor, query?: { month?: string; employeeId?: string | null }): PublicHrAmount[] {
  return listHrAmounts(db, actor, "employee_incentives", query);
}

async function addHrAmount(
  db: Db,
  actor: ServiceActor,
  table: "employee_deductions" | "employee_incentives",
  action: "EMPLOYEE_DEDUCTION_ADDED" | "EMPLOYEE_INCENTIVE_ADDED",
  input: { employeeId: string; amountMinor: number; reason: string; dateKey?: string | null },
): Promise<PublicHrAmount> {
  requirePermission(actor, "hr.manage");
  const employee = getEmployee(db, input.employeeId);
  assertEmployeeScopedAccess(actor, employee);
  assertNonNegativeInteger(Math.round(input.amountMinor), "errors.finance.invalidAmount");
  const amount = Math.round(input.amountMinor);
  if (amount <= 0) throw errValidation("errors.finance.invalidAmount");
  const reason = input.reason.trim();
  if (reason.length < 2) throw errValidation("errors.hrReasonRequired");
  const dateKey = input.dateKey ? assertDateKey(input.dateKey) : todayKey();

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      `INSERT INTO ${table} (id, employee_id, amount_minor, reason, date_key, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.employeeId, amount, reason, dateKey, actor.userId, nowStamp()],
    );
    recordAudit(db, actor, action, table, id, {
      employee: str(employee.full_name),
      amountMinor: amount,
      reason,
      dateKey,
    });
  });
  return {
    id,
    employeeId: input.employeeId,
    employeeName: str(employee.full_name),
    amountMinor: amount,
    reason,
    dateKey,
  };
}

export async function addDeduction(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; amountMinor: number; reason: string; dateKey?: string | null },
): Promise<PublicHrAmount> {
  return addHrAmount(db, actor, "employee_deductions", "EMPLOYEE_DEDUCTION_ADDED", input);
}

export async function addIncentive(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; amountMinor: number; reason: string; dateKey?: string | null },
): Promise<PublicHrAmount> {
  return addHrAmount(db, actor, "employee_incentives", "EMPLOYEE_INCENTIVE_ADDED", input);
}

// ---------------------------------------------------------------------------
// Monthly salary summary
// ---------------------------------------------------------------------------

export function monthlySalarySummary(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; periodMonth: string },
): MonthlySalarySummary {
  requirePermission(actor, "hr.view");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const canViewOther =
    roleHasPermission(actor.roleId, "salaries.view") || roleHasPermission(actor.roleId, "hr.activity_view");
  const employee = getEmployee(db, input.employeeId);
  if (!manage && !canViewOther) {
    const mine = db.first<Row>("SELECT id FROM employees WHERE user_id = ?", [actor.userId]);
    if (!mine || str(mine.id) !== input.employeeId) throw errForbidden();
  }
  assertEmployeeScopedAccess(actor, employee);

  const month = input.periodMonth.trim();
  if (!MONTH_RE.test(month)) throw errValidation("errors.invalidPeriod");

  const baseMinor = Math.round(num(employee.salary_base_minor ?? employee.monthly_salary_minor, 0));
  const incentivesMinor = num(
    db.scalar("SELECT COALESCE(SUM(amount_minor),0) FROM employee_incentives WHERE employee_id = ? AND substr(date_key,1,7) = ?", [input.employeeId, month]),
  );
  const deductionsMinor = num(
    db.scalar("SELECT COALESCE(SUM(amount_minor),0) FROM employee_deductions WHERE employee_id = ? AND substr(date_key,1,7) = ?", [input.employeeId, month]),
  );

  // unpaid-leave influence
  const unpaidRows = db.all<Row>(
    `SELECT start_date, end_date FROM employee_leaves
     WHERE employee_id = ? AND leave_type = 'unpaid' AND status = 'approved'
       AND (start_date LIKE ? OR end_date LIKE ? OR (start_date <= ? AND end_date >= ?))`,
    [input.employeeId, `${month}-%`, `${month}-%`, `${month}-31`, `${month}-01`],
  );
  const unpaidLeaveDays = unpaidRows.reduce((sum, r) => sum + leaveDaysInMonth(str(r.start_date), str(r.end_date), month), 0);

  const salaryType = str(employee.salary_type) || "monthly";
  const dailyRate = salaryType === "daily" ? baseMinor : Math.round(baseMinor / 30);
  const unpaidLeaveImpactMinor = unpaidLeaveDays * dailyRate;

  const attendedDays = num(
    db.scalar("SELECT COUNT(*) FROM employee_attendance WHERE employee_id = ? AND substr(date_key,1,7) = ? AND clock_out_at IS NOT NULL AND worked_minutes > 0", [input.employeeId, month]),
  );

  const alreadyRecorded = !!db.first(
    "SELECT id FROM salaries WHERE employee_id = ? AND period_month = ?",
    [input.employeeId, month],
  );

  const netMinor = Math.max(0, baseMinor + incentivesMinor - deductionsMinor - unpaidLeaveImpactMinor);

  return {
    employeeId: input.employeeId,
    employeeName: str(employee.full_name),
    periodMonth: month,
    baseMinor,
    incentivesMinor,
    deductionsMinor,
    unpaidLeaveDays,
    unpaidLeaveImpactMinor,
    attendedDays,
    netMinor,
    alreadyRecorded,
  };
}

// ---------------------------------------------------------------------------
// Per-employee daily activity detail (owner/manager only)
// ---------------------------------------------------------------------------

interface ActivityRow extends Row {
  total_minor: number;
  cnt: number;
}

function sumByDay(db: Db, sql: string, params: Array<string | number>): { cnt: number; amountMinor: number } {
  const row = db.first<ActivityRow>(sql, params);
  return { cnt: num(row?.cnt), amountMinor: num(row?.total_minor) };
}

export function employeeDailyActivity(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; dateKey: string },
): DailyActivityReport {
  requirePermission(actor, "hr.activity_view");
  const employee = getEmployee(db, input.employeeId);
  assertEmployeeScopedAccess(actor, employee);
  const dateKey = assertDateKey(input.dateKey);

  const employeeRow = getEmployee(db, input.employeeId);
  const userId = employeeRow.user_id == null ? null : str(employeeRow.user_id);

  const totals: DailyActivityTotals = {
    attendanceIn: 0,
    attendanceOut: 0,
    subscriptionsSold: 0,
    subscriptionsTotalMinor: 0,
    storeSales: 0,
    storeSalesTotalMinor: 0,
    paymentsReceived: 0,
    paymentsTotalMinor: 0,
    expensesRecorded: 0,
    expensesTotalMinor: 0,
    auditedActions: 0,
  };
  const entries: DailyActivityEntry[] = [];

  // attendance
  const att = db.all<Row>(
    "SELECT * FROM employee_attendance WHERE employee_id = ? AND date_key = ?",
    [input.employeeId, dateKey],
  );
  for (const a of att) {
    totals.attendanceIn++;
    entries.push({
      time: str(a.clock_in_at).slice(11, 19),
      category: "attendance",
      label: "clockIn",
      reference: null,
      amountMinor: 0,
    });
    if (a.clock_out_at) {
      totals.attendanceOut++;
      entries.push({
        time: str(a.clock_out_at).slice(11, 19),
        category: "attendance",
        label: "clockOut",
        reference: null,
        amountMinor: 0,
      });
    }
  }

  if (userId) {
    const subs = sumByDay(
      db,
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(price * 100), 0) AS total_minor FROM member_subscriptions WHERE created_by = ? AND substr(created_at, 1, 10) = ?",
      [userId, dateKey],
    );
    totals.subscriptionsSold = subs.cnt;
    totals.subscriptionsTotalMinor = subs.amountMinor;
    const subRows = db.all<Row>(
      "SELECT created_at, price, id FROM member_subscriptions WHERE created_by = ? AND substr(created_at, 1, 10) = ?",
      [userId, dateKey],
    );
    for (const s of subRows) {
      entries.push({
        time: str(s.created_at).slice(11, 19),
        category: "subscription",
        label: "subscription",
        reference: str(s.id),
        amountMinor: Math.round(num(s.price) * 100),
      });
    }

    const sales = sumByDay(
      db,
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_minor), 0) AS total_minor FROM store_sales WHERE seller_id = ? AND substr(sold_at, 1, 10) = ? AND status = 'completed'",
      [userId, dateKey],
    );
    totals.storeSales = sales.cnt;
    totals.storeSalesTotalMinor = sales.amountMinor;
    const saleRows = db.all<Row>(
      "SELECT sold_at, total_minor, sale_no FROM store_sales WHERE seller_id = ? AND substr(sold_at, 1, 10) = ? AND status = 'completed'",
      [userId, dateKey],
    );
    for (const s of saleRows) {
      entries.push({
        time: str(s.sold_at).slice(11, 19),
        category: "sale",
        label: "sale",
        reference: str(s.sale_no),
        amountMinor: num(s.total_minor),
      });
    }

    const pays = sumByDay(
      db,
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(paid_amount_minor), 0) AS total_minor FROM payments WHERE created_by = ? AND substr(paid_at, 1, 10) = ? AND status != 'voided'",
      [userId, dateKey],
    );
    totals.paymentsReceived = pays.cnt;
    totals.paymentsTotalMinor = pays.amountMinor;
    const payRows = db.all<Row>(
      "SELECT paid_at, paid_amount_minor, id, reference_no FROM payments WHERE created_by = ? AND substr(paid_at, 1, 10) = ? AND status != 'voided' ORDER BY paid_at",
      [userId, dateKey],
    );
    for (const p of payRows) {
      entries.push({
        time: str(p.paid_at).slice(11, 19),
        category: "payment",
        label: "payment",
        reference: str(p.reference_no ?? p.id),
        amountMinor: num(p.paid_amount_minor),
      });
    }

    const exps = sumByDay(
      db,
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_minor), 0) AS total_minor FROM expenses WHERE created_by = ? AND substr(created_at, 1, 10) = ? AND status = 'active'",
      [userId, dateKey],
    );
    totals.expensesRecorded = exps.cnt;
    totals.expensesTotalMinor = exps.amountMinor;
    const expRows = db.all<Row>(
      "SELECT created_at, amount_minor, id FROM expenses WHERE created_by = ? AND substr(created_at, 1, 10) = ? AND status = 'active' ORDER BY created_at",
      [userId, dateKey],
    );
    for (const x of expRows) {
      entries.push({
        time: str(x.created_at).slice(11, 19),
        category: "expense",
        label: "expense",
        reference: str(x.id),
        amountMinor: num(x.amount_minor),
      });
    }
  }

  // audit timeline
  const auditRows = db.all<Row>(
    "SELECT created_at, action, entity_type, entity_id FROM audit_logs WHERE user_id = ? AND substr(created_at, 1, 10) = ? ORDER BY created_at",
    [userId, dateKey],
  );
  for (const a of auditRows) {
    if (["EMPLOYEE_ATTENDANCE_IN", "EMPLOYEE_ATTENDANCE_OUT"].includes(str(a.action))) continue;
    entries.push({
      time: str(a.created_at).slice(11, 19),
      category: "audit",
      label: str(a.action),
      reference: str(a.entity_id),
      amountMinor: 0,
    });
  }
  totals.auditedActions = auditRows.length;

  entries.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  return {
    employeeId: input.employeeId,
    employeeName: str(employeeRow.full_name),
    dateKey,
    totals,
    entries,
  };
}
