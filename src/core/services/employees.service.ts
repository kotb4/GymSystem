import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { assertNonNegativeInteger } from "@/core/money";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { insertLedgerEntry } from "./payments.service";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess } from "./department";

/**
 * Hard-deletes an employee and their payroll history (ADR-008). Paid salaries'
 * treasury movements (ledger rows keyed by the salary id) are removed with
 * them; the generated expense documents remain as historical paperwork since
 * they carry no structural link back to the salary row.
 */
export async function purgeEmployee(
  db: Db,
  actor: ServiceActor,
  employeeId: string,
): Promise<void> {
  requirePermission(actor, "employees.purge");
  const row = db.first<Row>("SELECT * FROM employees WHERE id = ?", [employeeId]);
  if (!row) throw errNotFound("errors.employeeNotFound");
  if (row.department) assertDepartmentAccess(actor, String(row.department));

  await db.transaction(() => {
    const salaryIds = db
      .all<{ id: string }>("SELECT id FROM salaries WHERE employee_id = ?", [employeeId])
      .map((s) => s.id);
    if (salaryIds.length > 0) {
      const placeholders = salaryIds.map(() => "?").join(",");
      db.run(`DELETE FROM financial_ledger WHERE ref_table = 'salaries' AND ref_id IN (${placeholders})`, salaryIds);
    }
    db.run("DELETE FROM salaries WHERE employee_id = ?", [employeeId]);
    db.run("DELETE FROM employees WHERE id = ?", [employeeId]);
    recordAudit(db, actor, "EMPLOYEE_PURGED", "employee", employeeId, {
      fullName: str(row.full_name),
      salariesRemoved: salaryIds.length,
    });
  });
}

type Num = string | number;
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export type SalaryType = "monthly" | "daily" | "per_class" | "custom";

export interface EmployeeInput {
  fullName: string;
  phone?: string | null;
  roleTitle?: string | null;
  department?: "general" | "men" | "women";
  specialization?: string | null;
  joinedDate?: string | null;
  salaryType?: SalaryType;
  salaryBaseMinor?: number | null;
  notes?: string | null;
  userId?: string | null;
}

export interface PublicEmployee {
  id: string;
  fullName: string;
  phone: string | null;
  roleTitle: string | null;
  department: "general" | "men" | "women";
  specialization: string | null;
  joinedDate: string | null;
  salaryType: SalaryType;
  salaryBaseMinor: number | null;
  monthlySalaryMinor: number | null;
  isActive: boolean;
  notes: string | null;
  userId: string | null;
  barcode: string | null;
  annualLeaveDays: number | null;
  sickLeaveDays: number | null;
  unpaidLeaveDays: number | null;
}

const EMP_SELECT = "SELECT * FROM employees";

function mapEmployee(r: Row): PublicEmployee {
  const base = r.salary_base_minor == null ? null : num(r.salary_base_minor);
  return {
    id: str(r.id),
    fullName: str(r.full_name),
    phone: r.phone == null ? null : str(r.phone),
    roleTitle: r.role_title == null ? null : str(r.role_title),
    department: (str(r.department) || "general") as PublicEmployee["department"],
    specialization: r.specialization == null ? null : str(r.specialization),
    joinedDate: r.joined_date == null ? null : str(r.joined_date),
    // legacy fallback: rows created before migration v6
    salaryType: (str(r.salary_type) || "monthly") as SalaryType,
    salaryBaseMinor: base ?? (r.monthly_salary_minor == null ? null : num(r.monthly_salary_minor)),
    monthlySalaryMinor: r.monthly_salary_minor == null ? null : num(r.monthly_salary_minor),
    isActive: num(r.is_active, 1) === 1,
    notes: r.notes == null ? null : str(r.notes),
    userId: r.user_id == null ? null : str(r.user_id),
    barcode: r.barcode == null || str(r.barcode) === "" ? null : str(r.barcode),
    annualLeaveDays: r.annual_leave_days == null ? null : num(r.annual_leave_days),
    sickLeaveDays: r.sick_leave_days == null ? null : num(r.sick_leave_days),
    unpaidLeaveDays: r.unpaid_leave_days == null ? null : num(r.unpaid_leave_days),
  };
}

export function listEmployees(
  db: Db,
  actor: ServiceActor,
  query: { search?: string; includeInactive?: boolean } = {},
): PublicEmployee[] {
  requirePermission(actor, "employees.view");
  const conditions: string[] = [];
  const params: Num[] = [];
  if (!query.includeInactive) conditions.push("is_active = 1");
  const search = query.search?.trim();
  if (search) {
    conditions.push("(full_name LIKE ? OR phone LIKE ? OR role_title LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.all<Row>(`${EMP_SELECT} ${where} ORDER BY full_name`).map(mapEmployee);
}

function getEmployeeRow(db: Db, employeeId: string): Row {
  const row = db.first<Row>("SELECT * FROM employees WHERE id = ?", [employeeId]);
  if (!row) throw errNotFound("errors.employeeNotFound");
  return row;
}

export async function createEmployee(db: Db, actor: ServiceActor, input: EmployeeInput): Promise<PublicEmployee> {
  requirePermission(actor, "employees.manage");
  const fullName = input.fullName.trim();
  if (fullName.length < 2) throw errValidation("errors.employeeNameShort");
  if (input.phone?.trim()) {
    const dup = db.first("SELECT id FROM employees WHERE phone = ?", [input.phone.trim()]);
    if (dup) throw errConflict("errors.employeePhoneTaken");
  }
  if (input.salaryBaseMinor != null) {
    assertNonNegativeInteger(Math.round(input.salaryBaseMinor), "errors.finance.invalidAmount");
  }
  const id = crypto.randomUUID();
  const userId = linkUserId(db, input.userId, id);
  await db.transaction(async () => {
    db.run(
      "INSERT INTO employees (id, full_name, phone, role_title, department, specialization, joined_date, salary_type, salary_base_minor, is_active, notes, user_id, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
      [
        id,
        fullName,
        input.phone?.trim() || null,
        input.roleTitle?.trim() || null,
        input.department ?? "general",
        input.specialization?.trim() || null,
        input.joinedDate || null,
        input.salaryType ?? "monthly",
        input.salaryBaseMinor != null ? Math.round(input.salaryBaseMinor) : null,
        input.notes?.trim() || null,
        userId,
        actor.userId,
        stamp(),
        stamp(),
      ],
    );
    recordAudit(db, actor, "EMPLOYEE_CREATED", "employee", id, { name: fullName });
  });
  return mapEmployee(getEmployeeRow(db, id));
}

/** Validate a requested user-link, returning the user id (or null to unlink). */
function linkUserId(db: Db, requested: string | null | undefined, employeeId: string): string | null {
  if (requested == null || requested === "") return null;
  const user = db.first<Row>("SELECT id, username FROM users WHERE id = ?", [requested]);
  if (!user) throw errValidation("errors.userNotFound");
  const dup = db.first("SELECT id FROM employees WHERE user_id = ? AND id != ?", [requested, employeeId]);
  if (dup) throw errConflict("errors.userAlreadyLinked");
  return requested;
}

export async function updateEmployee(
  db: Db,
  actor: ServiceActor,
  employeeId: string,
  patch: Partial<EmployeeInput> & { isActive?: boolean },
): Promise<PublicEmployee> {
  requirePermission(actor, "employees.manage");
  const row = getEmployeeRow(db, employeeId);
  if (patch.salaryBaseMinor != null) {
    assertNonNegativeInteger(Math.round(patch.salaryBaseMinor), "errors.finance.invalidAmount");
  }
  const userId = patch.userId !== undefined ? linkUserId(db, patch.userId, employeeId) : row.user_id == null ? null : str(row.user_id);
  await db.transaction(async () => {
    db.run(
      "UPDATE employees SET full_name = ?, phone = ?, role_title = ?, department = ?, specialization = ?, joined_date = ?, salary_type = ?, salary_base_minor = ?, is_active = ?, notes = ?, user_id = ?, updated_at = ? WHERE id = ?",
      [
        patch.fullName?.trim() ?? str(row.full_name),
        patch.phone !== undefined ? patch.phone?.trim() || null : row.phone,
        patch.roleTitle !== undefined ? patch.roleTitle?.trim() || null : row.role_title,
        patch.department !== undefined ? patch.department : row.department,
        patch.specialization !== undefined ? patch.specialization?.trim() || null : row.specialization,
        patch.joinedDate !== undefined ? patch.joinedDate || null : row.joined_date,
        patch.salaryType !== undefined ? patch.salaryType : str(row.salary_type) || "monthly",
        patch.salaryBaseMinor !== undefined
          ? patch.salaryBaseMinor == null
            ? null
            : Math.round(patch.salaryBaseMinor)
          : row.salary_base_minor,
        patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : num(row.is_active, 1),
        patch.notes !== undefined ? patch.notes?.trim() || null : row.notes,
        userId,
        stamp(),
        employeeId,
      ],
    );
    recordAudit(db, actor, "EMPLOYEE_UPDATED", "employee", employeeId, {});
  });
  return mapEmployee(getEmployeeRow(db, employeeId));
}

// ------------------------------ salaries ---------------------------------

export interface SalaryRecordInput {
  employeeId: string;
  periodMonth: string; // YYYY-MM
  bonusMinor?: number;
  deductionMinor?: number;
  methodCode?: string;
  notes?: string | null;
}

export interface PublicSalary {
  id: string;
  employeeId: string;
  employeeName: string;
  periodMonth: string;
  baseMinor: number;
  bonusMinor: number;
  deductionMinor: number;
  netMinor: number;
  methodCode: string;
  status: "pending" | "paid";
  paidAt: string | null;
  notes: string | null;
}

const SALARY_SELECT =
  "SELECT s.*, e.full_name AS employee_name FROM salaries s JOIN employees e ON e.id = s.employee_id";

function mapSalary(r: Row): PublicSalary {
  return {
    id: str(r.id),
    employeeId: str(r.employee_id),
    employeeName: str(r.employee_name),
    periodMonth: str(r.period_month),
    baseMinor: num(r.base_amount_minor),
    bonusMinor: num(r.bonus_minor),
    deductionMinor: num(r.deduction_minor),
    netMinor: num(r.net_amount_minor),
    methodCode: str(r.method_code),
    status: str(r.status) as PublicSalary["status"],
    paidAt: r.paid_at == null ? null : str(r.paid_at),
    notes: r.notes == null ? null : str(r.notes),
  };
}

export function listSalaries(
  db: Db,
  actor: ServiceActor,
  query: { employeeId?: string; periodMonth?: string; status?: "pending" | "paid" | "all"; limit?: number } = {},
): PublicSalary[] {
  requirePermission(actor, "salaries.view");
  const limit = Math.min(200, Math.max(1, query.limit ?? 60));
  const conditions: string[] = [];
  const params: Num[] = [];
  if (query.employeeId) {
    conditions.push("s.employee_id = ?");
    params.push(query.employeeId);
  }
  if (query.periodMonth) {
    conditions.push("s.period_month = ?");
    params.push(query.periodMonth);
  }
  if (query.status && query.status !== "all") {
    conditions.push("s.status = ?");
    params.push(query.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<Row>(`${SALARY_SELECT} ${where} ORDER BY s.period_month DESC, e.full_name LIMIT ?`, [
      ...params,
      limit,
    ])
    .map(mapSalary);
}

/** Register a salary obligation for a period. Unique per employee+month. */
export async function recordSalary(db: Db, actor: ServiceActor, input: SalaryRecordInput): Promise<PublicSalary> {
  requirePermission(actor, "salaries.manage");
  const emp = getEmployeeRow(db, input.employeeId);
  const period = input.periodMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(period)) throw errValidation("errors.invalidPeriod");

  const baseSource: number | null =
    emp.salary_base_minor != null ? Number(emp.salary_base_minor) : emp.monthly_salary_minor != null ? Number(emp.monthly_salary_minor) : null;
  const baseMinor = Math.round(baseSource ?? 0);
  if (baseMinor < 0) throw errValidation("errors.finance.invalidAmount");

  const bonus = Math.round(input.bonusMinor ?? 0);
  const deduction = Math.round(input.deductionMinor ?? 0);
  assertNonNegativeInteger(bonus, "errors.finance.invalidAmount");
  assertNonNegativeInteger(deduction, "errors.finance.invalidAmount");
  const net = baseMinor + bonus - deduction;
  if (net < 0) throw errValidation("errors.finance.invalidAmount");

  const dup = db.first("SELECT id FROM salaries WHERE employee_id = ? AND period_month = ?", [
    input.employeeId,
    period,
  ]);
  if (dup) throw errConflict("errors.salaryDuplicate");

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO salaries (id, employee_id, period_month, base_amount_minor, bonus_minor, deduction_minor, net_amount_minor, method_code, status, notes, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
      [
        id,
        input.employeeId,
        period,
        baseMinor,
        bonus,
        deduction,
        net,
        input.methodCode ?? "cash",
        input.notes?.trim() || null,
        actor.userId,
        stamp(),
        stamp(),
      ],
    );
    recordAudit(db, actor, "SALARY_RECORDED", "salary", id, {
      employee: str(emp.full_name),
      period,
      netMinor: net,
    });
  });

  return mapSalary(
    db.first<Row>(`${SALARY_SELECT} WHERE s.id = ?`, [id])!,
  );
}

/**
 * Pay a pending salary through the unified treasury: records a `salaries`
 * expense (own category, distinguishable) + ledger entry in one transaction.
 */
export async function paySalary(
  db: Db,
  actor: ServiceActor,
  salaryId: string,
): Promise<PublicSalary> {
  requirePermission(actor, "salaries.manage");
  const row = db.first<Row>(
    `${SALARY_SELECT} WHERE s.id = ?`,
    [salaryId],
  );
  if (!row) throw errNotFound("errors.salaryNotFound");
  if (str(row.status) === "paid") throw errConflict("errors.salaryAlreadyPaid");

  const ts = stamp();
  const catId = db.scalar("SELECT id FROM expense_categories WHERE id = 'cat-salaries'") as string | null;

  await db.transaction(async () => {
    db.run(
      "UPDATE salaries SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?",
      [ts, ts, salaryId],
    );

    // unified treasury entry: expense row when the salaries category exists
    let expenseCategoryId = catId;
    if (!expenseCategoryId) {
      expenseCategoryId = String(
        db.scalar("SELECT id FROM expense_categories WHERE name_ar = 'مرتبات'") ?? "",
      );
    }
    if (expenseCategoryId) {
      db.run(
        "INSERT INTO expenses (id, category_id, amount_minor, method_code, description, expense_date, status, created_by, updated_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?)",
        [
          crypto.randomUUID(),
          expenseCategoryId,
          num(row.net_amount_minor),
          str(row.method_code) || "cash",
          `راتب ${str(row.employee_name)} — ${str(row.period_month)}`,
          ts.slice(0, 10),
          actor.userId,
          ts,
          ts,
        ],
      );
    }

    insertLedgerEntry(db, {
      entryType: "expense",
      refTable: "salaries",
      refId: salaryId,
      memberId: null,
      methodCode: str(row.method_code) || "cash",
      direction: -1,
      amountMinor: num(row.net_amount_minor),
      occurredAt: ts,
      actor,
    });

    recordAudit(db, actor, "SALARY_MARKED_PAID", "salary", salaryId, {
      netMinor: num(row.net_amount_minor),
      employee: str(row.employee_name),
    });
  });

  return mapSalary(db.first<Row>(`${SALARY_SELECT} WHERE s.id = ?`, [salaryId])!);
}

function stamp(): string {
  return nowStamp();
}
