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

/** Count approved leave days of an employee of `type` consumed in `year`. */
function leaveUsedDays(db: Db, employeeId: string, type: LeaveType, year: string): number {
  if (type === "emergency") return 0;
  const rows = db.all<Row>(
    `SELECT start_date, end_date FROM employee_leaves
     WHERE employee_id = ? AND leave_type = ? AND status = 'approved'
       AND (start_date LIKE ? OR end_date LIKE ? OR (start_date <= ? AND end_date >= ?))`,
    [employeeId, type, `${year}-%`, `${year}-%`, `${year}-12-31`, `${year}-01-01`],
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

const DEFAULT_ANNUAL = 21;
const DEFAULT_SICK = 12;

/**
 * Leave entitlement (days) for a given type for the year. Annual/sick carry a
 * numeric quota; an employee-specific value overrides the global default.
 * `unpaid` gets a quota only when explicitly configured on the employee;
 * otherwise it (and `emergency`) are unlimited.
 */
function leaveEntitlement(db: Db, employee: Row, type: LeaveType): number {
  switch (type) {
    case "annual":
      return Math.max(0, Math.round(
        employee.annual_leave_days != null ? num(employee.annual_leave_days) : settingNum(db, "hr.annual_leave_days", DEFAULT_ANNUAL),
      ));
    case "sick":
      return Math.max(0, Math.round(employee.sick_leave_days != null ? num(employee.sick_leave_days) : DEFAULT_SICK));
    case "unpaid":
      return employee.unpaid_leave_days != null ? Math.max(0, Math.round(num(employee.unpaid_leave_days))) : Number.POSITIVE_INFINITY;
    case "emergency":
      return Number.POSITIVE_INFINITY;
  }
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
    if (!mine) throw errValidation("errors.hrNoEmployeeProfile");
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

/** Annual leave entitlement (days) of `employee` for `year` (per-employee > global default). */
export function annualLeaveEntitlement(db: Db, year: string): number {
  void year;
  return Math.max(0, Math.round(settingNum(db, "hr.annual_leave_days", DEFAULT_ANNUAL)));
}

export interface LeaveBalance {
  type: LeaveType;
  entitlement: number;
  used: number;
  remaining: number;
  limited: boolean;
}

export function getLeaveBalance(
  db: Db,
  actor: ServiceActor,
  input: { employeeId?: string | null; year?: string | null },
): LeaveBalance[] {
  requirePermission(actor, "hr.view");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const employee = resolveTargetEmployee(db, actor, input.employeeId ?? null, manage);
  assertEmployeeScopedAccess(actor, employee);
  const year = input.year?.trim() || todayKey().slice(0, 4);
  if (!/^\d{4}$/.test(year)) throw errValidation("errors.invalidPeriod");
  const types: LeaveType[] = ["annual", "sick", "unpaid", "emergency"];
  return types.map((type) => {
    const entitlement = leaveEntitlement(db, employee, type);
    const limited = Number.isFinite(entitlement);
    const used = leaveUsedDays(db, str(employee.id), type, year);
    const remaining = limited ? Math.max(0, entitlement - used) : Number.POSITIVE_INFINITY;
    return { type, entitlement: limited ? entitlement : 0, used, remaining, limited };
  });
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
  const days = diffDaysKeys(start, end) + 1;
  const entitlement = leaveEntitlement(db, employee, input.leaveType);
  if (Number.isFinite(entitlement)) {
    const used = leaveUsedDays(db, str(employee.id), input.leaveType, year);
    const remaining = Math.max(0, entitlement - used);
    if (days > remaining) {
      throw errConflict("errors.hrLeaveNoBalance", { remaining: String(remaining) });
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
    if (!mine) throw errValidation("errors.hrNoEmployeeProfile");
    conditions.push("l.employee_id = ?");
    params.push(str(mine.id));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.all<Row>(
    `SELECT l.*, e.full_name AS employee_name
     FROM employee_leaves l JOIN employees e ON e.id = l.employee_id
     ${where} ORDER BY l.created_at DESC`,
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

  // re-check per-type balance on approval
  if (input.approve) {
    const type = str(leave.leave_type) as LeaveType;
    const entitlement = leaveEntitlement(db, employee, type);
    if (Number.isFinite(entitlement)) {
      const year = str(leave.start_date).slice(0, 4);
      const days = diffDaysKeys(str(leave.start_date), str(leave.end_date)) + 1;
      if (days > Math.max(0, entitlement - leaveUsedDays(db, str(employee.id), type, year))) {
        throw errConflict("errors.hrLeaveNoBalance");
      }
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

/** Edit a still-pending leave request (owner/manager can edit any, others only their own). */
export async function updateLeave(
  db: Db,
  actor: ServiceActor,
  input: { leaveId: string; leaveType: LeaveType; startDate: string; endDate: string; reason?: string | null },
): Promise<PublicLeave> {
  requirePermission(actor, "hr.view");
  const leave = db.first<Row>(
    "SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?",
    [input.leaveId],
  );
  if (!leave) throw errNotFound("errors.hrLeaveNotFound");
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const isMine = str(leave.requested_by) === actor.userId;
  const employee = getEmployee(db, str(leave.employee_id));
  assertEmployeeScopedAccess(actor, employee);
  if (!manage && !isMine) throw errForbidden();
  if (str(leave.status) !== "pending") throw errConflict("errors.hrLeaveNotEditable");

  const start = assertDateKey(input.startDate);
  const end = assertDateKey(input.endDate);
  if (end < start) throw errValidation("errors.hrLeaveRangeInvalid");
  if (!["annual", "sick", "unpaid", "emergency"].includes(input.leaveType)) {
    throw errValidation("errors.hrLeaveTypeInvalid");
  }
  const year = start.slice(0, 4);
  const days = diffDaysKeys(start, end) + 1;
  const entitlement = leaveEntitlement(db, employee, input.leaveType);
  if (Number.isFinite(entitlement)) {
    const used = leaveUsedDays(db, str(employee.id), input.leaveType, year);
    const remaining = Math.max(0, entitlement - used);
    if (days > remaining) {
      throw errConflict("errors.hrLeaveNoBalance", { remaining: String(remaining) });
    }
  }

  await db.transaction(async () => {
    db.run(
      "UPDATE employee_leaves SET leave_type = ?, start_date = ?, end_date = ?, reason = ?, updated_at = ? WHERE id = ?",
      [input.leaveType, start, end, input.reason?.trim() || null, nowStamp(), input.leaveId],
    );
    recordAudit(db, actor, "EMPLOYEE_LEAVE_UPDATED", "employee_leave", input.leaveId, {
      employee: str(employee.full_name),
      leaveType: input.leaveType,
      start,
      end,
    });
  });
  const updated = db.first<Row>(
    "SELECT l.*, e.full_name AS employee_name FROM employee_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?",
    [input.leaveId],
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
    if (!mine) throw errValidation("errors.hrNoEmployeeProfile");
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

async function updateHrAmount(
  db: Db,
  actor: ServiceActor,
  table: "employee_deductions" | "employee_incentives",
  action: "EMPLOYEE_DEDUCTION_UPDATED" | "EMPLOYEE_INCENTIVE_UPDATED",
  input: { id: string; amountMinor: number; reason: string; dateKey?: string | null },
): Promise<PublicHrAmount> {
  requirePermission(actor, "hr.manage");
  const row = db.first<Row>(`SELECT * FROM ${table} WHERE id = ?`, [input.id]);
  if (!row) throw errNotFound("errors.hrAmountNotFound");
  const employee = getEmployee(db, str(row.employee_id));
  assertEmployeeScopedAccess(actor, employee);

  assertNonNegativeInteger(Math.round(input.amountMinor), "errors.finance.invalidAmount");
  const amount = Math.round(input.amountMinor);
  if (amount <= 0) throw errValidation("errors.finance.invalidAmount");
  const reason = input.reason.trim();
  if (reason.length < 2) throw errValidation("errors.hrReasonRequired");
  const dateKey = input.dateKey ? assertDateKey(input.dateKey) : todayKey();

  await db.transaction(async () => {
    db.run(`UPDATE ${table} SET amount_minor = ?, reason = ?, date_key = ? WHERE id = ?`, [
      amount,
      reason,
      dateKey,
      input.id,
    ]);
    recordAudit(db, actor, action, table, input.id, {
      employee: str(employee.full_name),
      amountMinor: amount,
      reason,
      dateKey,
    });
  });
  return {
    id: input.id,
    employeeId: str(row.employee_id),
    employeeName: str(employee.full_name),
    amountMinor: amount,
    reason,
    dateKey,
  };
}

export async function updateDeduction(
  db: Db,
  actor: ServiceActor,
  input: { id: string; amountMinor: number; reason: string; dateKey?: string | null },
): Promise<PublicHrAmount> {
  return updateHrAmount(db, actor, "employee_deductions", "EMPLOYEE_DEDUCTION_UPDATED", input);
}

export async function updateIncentive(
  db: Db,
  actor: ServiceActor,
  input: { id: string; amountMinor: number; reason: string; dateKey?: string | null },
): Promise<PublicHrAmount> {
  return updateHrAmount(db, actor, "employee_incentives", "EMPLOYEE_INCENTIVE_UPDATED", input);
}

async function deleteHrAmount(
  db: Db,
  actor: ServiceActor,
  table: "employee_deductions" | "employee_incentives",
  action: "EMPLOYEE_DEDUCTION_DELETED" | "EMPLOYEE_INCENTIVE_DELETED",
  id: string,
): Promise<void> {
  requirePermission(actor, "hr.manage");
  const row = db.first<Row>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw errNotFound("errors.hrAmountNotFound");
  const employee = getEmployee(db, str(row.employee_id));
  assertEmployeeScopedAccess(actor, employee);
  await db.transaction(async () => {
    db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    recordAudit(db, actor, action, table, id, { employee: str(employee.full_name) });
  });
}

export async function deleteDeduction(db: Db, actor: ServiceActor, id: string): Promise<void> {
  return deleteHrAmount(db, actor, "employee_deductions", "EMPLOYEE_DEDUCTION_DELETED", id);
}

export async function deleteIncentive(db: Db, actor: ServiceActor, id: string): Promise<void> {
  return deleteHrAmount(db, actor, "employee_incentives", "EMPLOYEE_INCENTIVE_DELETED", id);
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

  const amounts = salaryAmounts(db, employee, month);

  const attendedDays = num(
    db.scalar("SELECT COUNT(*) FROM employee_attendance WHERE employee_id = ? AND substr(date_key,1,7) = ? AND clock_out_at IS NOT NULL AND worked_minutes > 0", [input.employeeId, month]),
  );

  const alreadyRecorded = !!db.first(
    "SELECT id FROM salaries WHERE employee_id = ? AND period_month = ?",
    [input.employeeId, month],
  );

  return {
    employeeId: input.employeeId,
    employeeName: str(employee.full_name),
    periodMonth: month,
    baseMinor: amounts.baseMinor,
    incentivesMinor: amounts.incentivesMinor,
    deductionsMinor: amounts.deductionsMinor,
    unpaidLeaveDays: amounts.unpaidLeaveDays,
    unpaidLeaveImpactMinor: amounts.unpaidLeaveImpactMinor,
    attendedDays,
    netMinor: amounts.netMinor,
    alreadyRecorded,
  };
}

/** Derive the monthly amount components used for both the summary and payroll rows. */
function salaryAmounts(
  db: Db,
  employee: Row,
  month: string,
): {
  baseMinor: number;
  incentivesMinor: number;
  deductionsMinor: number;
  unpaidLeaveDays: number;
  unpaidLeaveImpactMinor: number;
  netMinor: number;
} {
  const employeeId = str(employee.id);
  const baseMinor = Math.round(num(employee.salary_base_minor ?? employee.monthly_salary_minor, 0));
  const incentivesMinor = num(
    db.scalar("SELECT COALESCE(SUM(amount_minor),0) FROM employee_incentives WHERE employee_id = ? AND substr(date_key,1,7) = ?", [employeeId, month]),
  );
  const deductionsMinor = num(
    db.scalar("SELECT COALESCE(SUM(amount_minor),0) FROM employee_deductions WHERE employee_id = ? AND substr(date_key,1,7) = ?", [employeeId, month]),
  );

  const unpaidRows = db.all<Row>(
    `SELECT start_date, end_date FROM employee_leaves
     WHERE employee_id = ? AND leave_type = 'unpaid' AND status = 'approved'
       AND (start_date LIKE ? OR end_date LIKE ? OR (start_date <= ? AND end_date >= ?))`,
    [employeeId, `${month}-%`, `${month}-%`, `${month}-31`, `${month}-01`],
  );
  const unpaidLeaveDays = unpaidRows.reduce((sum, r) => sum + leaveDaysInMonth(str(r.start_date), str(r.end_date), month), 0);

  const salaryType = str(employee.salary_type) || "monthly";
  const dailyRate = salaryType === "daily" ? baseMinor : Math.round(baseMinor / 30);
  const unpaidLeaveImpactMinor = unpaidLeaveDays * dailyRate;

  return {
    baseMinor,
    incentivesMinor,
    deductionsMinor,
    unpaidLeaveDays,
    unpaidLeaveImpactMinor,
    netMinor: Math.max(0, baseMinor + incentivesMinor - deductionsMinor - unpaidLeaveImpactMinor),
  };
}

/**
 * Auto-generate pending salary rows for every active employee that does not yet
 * have a row for `periodMonth`, deriving base + incentives − deductions − unpaid
 * leave impact (same math as the monthly summary). Idempotent; never overwrites
 * existing rows. Returns the number of rows created.
 */
export async function ensureSalariesForMonth(
  db: Db,
  actor: ServiceActor,
  input: { periodMonth: string },
): Promise<{ created: number; periodMonth: string }> {
  requirePermission(actor, "salaries.manage");
  const month = input.periodMonth.trim();
  if (!MONTH_RE.test(month)) throw errValidation("errors.invalidPeriod");

  const employees = db.all<Row>(
    `SELECT * FROM employees WHERE is_active = 1 AND id NOT IN (
       SELECT employee_id FROM salaries WHERE period_month = ?
     )`,
    [month],
  );

  let created = 0;
  await db.transaction(async () => {
    for (const emp of employees) {
      assertEmployeeScopedAccess(actor, emp);
      const amounts = salaryAmounts(db, emp, month);
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO salaries (id, employee_id, period_month, base_amount_minor, bonus_minor, deduction_minor, net_amount_minor, method_code, status, notes, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'pending', 'auto', ?, ?, ?)",
        [
          id,
          str(emp.id),
          month,
          amounts.baseMinor,
          amounts.incentivesMinor,
          amounts.deductionsMinor + amounts.unpaidLeaveImpactMinor,
          amounts.netMinor,
          actor.userId,
          nowStamp(),
          nowStamp(),
        ],
      );
      recordAudit(db, actor, "SALARY_GENERATED", "salary", id, {
        employee: str(emp.full_name),
        period: month,
        netMinor: amounts.netMinor,
      });
      created++;
    }
  });
  return { created, periodMonth: month };
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

// ---------------------------------------------------------------------------
// Employee barcodes & worker self check-in/out
// ---------------------------------------------------------------------------

const EMP_BARCODE_RE = /^[A-Za-z0-9-]{4,32}$/;
function normalizeBarcode(value: string): string {
  return value.trim().toUpperCase();
}

/** Assign (or clear) a unique barcode to an employee. Manager/owner only. */
export async function setEmployeeBarcode(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; barcode?: string | null },
): Promise<{ employeeId: string; barcode: string | null }> {
  requirePermission(actor, "employees.manage");
  const employee = getEmployee(db, input.employeeId);
  assertEmployeeScopedAccess(actor, employee);

  let barcode: string | null = null;
  if (input.barcode != null && input.barcode.trim() !== "") {
    barcode = normalizeBarcode(input.barcode);
    if (!EMP_BARCODE_RE.test(barcode)) throw errValidation("errors.invalidBarcode");
    const dup = db.first(
      "SELECT id FROM employees WHERE barcode = ? AND id != ?",
      [barcode, input.employeeId],
    );
    if (dup) throw errConflict("errors.barcodeTaken");
  }

  await db.transaction(async () => {
    db.run("UPDATE employees SET barcode = ?, updated_at = ? WHERE id = ?", [barcode, nowStamp(), input.employeeId]);
    recordAudit(db, actor, "EMPLOYEE_BARCODE_SET", "employee", input.employeeId, {
      employee: str(employee.full_name),
      barcode,
    });
  });
  return { employeeId: input.employeeId, barcode };
}

function findEmployeeByBarcode(db: Db, barcode: string): Row {
  const normalized = normalizeBarcode(barcode);
  if (!EMP_BARCODE_RE.test(normalized)) throw errValidation("errors.invalidBarcode");
  const employee = db.first<Row>("SELECT * FROM employees WHERE barcode = ? AND is_active = 1", [normalized]);
  if (!employee) throw errNotFound("errors.employeeBarcodeUnknown");
  return employee;
}

/** Worker self check-in by scanning their own barcode. */
export async function clockInByBarcode(
  db: Db,
  actor: ServiceActor,
  input: { barcode: string; at?: string | null; dateKey?: string | null; notes?: string | null },
): Promise<PublicAttendance> {
  requirePermission(actor, "hr.view");
  const employee = findEmployeeByBarcode(db, input.barcode);
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
      [id, str(employee.id), dateKey, at, isLateFor(db, at) ? 1 : 0, input.notes?.trim() || null, actor.userId, nowStamp(), nowStamp()],
    );
    recordAudit(db, actor, "EMPLOYEE_ATTENDANCE_IN", "employee_attendance", id, {
      employee: str(employee.full_name),
      dateKey,
      at,
    });
  });
  return mapAttendance(db.first<Row>("SELECT * FROM employee_attendance WHERE id = ?", [id])!, str(employee.full_name));
}

/** Worker self check-out by scanning their own barcode. */
export async function clockOutByBarcode(
  db: Db,
  actor: ServiceActor,
  input: { barcode: string; at?: string | null; dateKey?: string | null },
): Promise<PublicAttendance> {
  requirePermission(actor, "hr.view");
  const employee = findEmployeeByBarcode(db, input.barcode);
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
  return mapAttendance(db.first<Row>("SELECT * FROM employee_attendance WHERE id = ?", [str(existing.id)])!, str(employee.full_name));
}

// ---------------------------------------------------------------------------
// Per-employee leave entitlements
// ---------------------------------------------------------------------------

export interface LeaveEntitlementInput {
  annualDays?: number | null;
  sickDays?: number | null;
  unpaidDays?: number | null;
}

/**
 * Set per-employee annual/sick/unpaid leave day quotas. `unpaidDays=null` means
 * unlimited; `annualDays`/`sickDays` fall back to their global defaults when null.
 */
export async function setLeaveEntitlements(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; annualDays?: number | null; sickDays?: number | null; unpaidDays?: number | null },
): Promise<{ employeeId: string; annualDays: number | null; sickDays: number | null; unpaidDays: number | null }> {
  requirePermission(actor, "hr.manage");
  const employee = getEmployee(db, input.employeeId);
  assertEmployeeScopedAccess(actor, employee);
  const annual = input.annualDays == null ? null : Math.max(0, Math.round(input.annualDays));
  const sick = input.sickDays == null ? null : Math.max(0, Math.round(input.sickDays));
  const unpaid = input.unpaidDays == null ? null : Math.max(0, Math.round(input.unpaidDays));

  await db.transaction(async () => {
    db.run(
      "UPDATE employees SET annual_leave_days = ?, sick_leave_days = ?, unpaid_leave_days = ?, updated_at = ? WHERE id = ?",
      [annual, sick, unpaid, nowStamp(), input.employeeId],
    );
    recordAudit(db, actor, "EMPLOYEE_LEAVE_ENTITLEMENT_UPDATED", "employee", input.employeeId, {
      employee: str(employee.full_name),
      annualDays: annual,
      sickDays: sick,
      unpaidDays: unpaid,
    });
  });
  return { employeeId: input.employeeId, annualDays: annual, sickDays: sick, unpaidDays: unpaid };
}

// ---------------------------------------------------------------------------
// Employee monthly worked hours (per working day)
// ---------------------------------------------------------------------------

export interface EmployeeDailyWorked {
  dateKey: string;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number;
  isLate: boolean;
}

/** Per-day worked hours for one employee in a month. Manager/owner, or self. */
export function employeeMonthlyHours(
  db: Db,
  actor: ServiceActor,
  input: { employeeId: string; month?: string },
): { employeeId: string; employeeName: string; month: string; days: EmployeeDailyWorked[] } {
  requirePermission(actor, "hr.view");
  const employee = getEmployee(db, input.employeeId);
  const manage = roleHasPermission(actor.roleId, "hr.manage");
  const canViewOther =
    roleHasPermission(actor.roleId, "salaries.view") || roleHasPermission(actor.roleId, "hr.activity_view");
  if (!manage && !canViewOther) {
    const mine = db.first<Row>("SELECT id FROM employees WHERE user_id = ?", [actor.userId]);
    if (!mine || str(mine.id) !== input.employeeId) throw errForbidden();
  }
  assertEmployeeScopedAccess(actor, employee);

  const month = input.month?.trim() || todayKey().slice(0, 7);
  if (!MONTH_RE.test(month)) throw errValidation("errors.invalidPeriod");

  const days = db.all<Row>(
    `SELECT date_key, clock_in_at, clock_out_at, worked_minutes, is_late
     FROM employee_attendance WHERE employee_id = ? AND substr(date_key,1,7) = ?
     ORDER BY date_key`,
    [input.employeeId, month],
  ).map((r) => ({
    dateKey: str(r.date_key),
    clockInAt: str(r.clock_in_at),
    clockOutAt: r.clock_out_at == null ? null : str(r.clock_out_at),
    workedMinutes: num(r.worked_minutes),
    isLate: num(r.is_late) === 1,
  }));

  return { employeeId: input.employeeId, employeeName: str(employee.full_name), month, days };
}
