import { addDaysKey, isValidDateKey, nowStamp, todayKey } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row, SqlValue } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { insertLedgerEntry } from "./payments.service";
import { getLocalBranchId } from "@/core/branch";

const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TrainerScheduleSlot {
  dayOfWeek: number; // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
  dayNameAr: string;
  startTime: string; // e.g. "16:00"
  endTime: string;   // e.g. "20:00"
  isActive: boolean;
}

export interface TrainerRow extends Row {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  rank_title: string | null;
  joined_date: string;
  is_active: number;
  notes: string | null;
  default_session_fee_minor: number;
  working_schedule: string | null;
  employee_id: string | null;
  employee_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicTrainer {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  rankTitle: string | null;
  joinedDate: string;
  isActive: boolean;
  notes: string | null;
  defaultSessionFeeMinor: number;
  workingSchedule?: TrainerScheduleSlot[] | null;
  employeeId?: string | null;
  employeeName?: string | null;
  assignedAcademies?: string[];
}

function toTrainer(row: TrainerRow & { assigned_academies?: string }): PublicTrainer {
  let workingSchedule: TrainerScheduleSlot[] | null = null;
  if (row.working_schedule) {
    try {
      const parsed = JSON.parse(row.working_schedule);
      if (Array.isArray(parsed)) {
        workingSchedule = parsed;
      }
    } catch {
      workingSchedule = null;
    }
  }

  const assignedAcademies = row.assigned_academies
    ? String(row.assigned_academies)
        .split("، ")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    specialization: row.specialization,
    rankTitle: row.rank_title ?? null,
    joinedDate: row.joined_date,
    isActive: row.is_active === 1,
    notes: row.notes,
    defaultSessionFeeMinor: Number(row.default_session_fee_minor ?? 0),
    workingSchedule,
    employeeId: row.employee_id ?? null,
    employeeName: row.employee_name ?? null,
    assignedAcademies,
  };
}

export function getTrainerById(db: Db, trainerId: string): (TrainerRow & { assigned_academies?: string }) | null {
  return db.first<TrainerRow & { assigned_academies?: string }>(
    `SELECT t.*, e.full_name AS employee_name,
       (SELECT GROUP_CONCAT(COALESCE(p.name, c.name), '، ') 
        FROM classes c 
        LEFT JOIN membership_plans p ON p.id = c.plan_id 
        WHERE c.trainer_id = t.id AND c.is_active = 1
       ) AS assigned_academies
     FROM trainers t
     LEFT JOIN employees e ON t.employee_id = e.id
     WHERE t.id = ?`,
    [trainerId]
  );
}

function assertOptionalPhone(phone: string | null | undefined): string | null {
  const value = phone?.trim() ?? "";
  if (value === "") return null;
  if (!PHONE_RE.test(value)) throw errValidation("errors.phoneInvalid");
  return value;
}

function assertOptionalEmail(email: string | null | undefined): string | null {
  const value = email?.trim() ?? "";
  if (value === "") return null;
  if (!EMAIL_RE.test(value)) throw errValidation("errors.emailInvalid");
  return value;
}

function assertPhoneFree(db: Db, phone: string | null, excludeTrainerId?: string): void {
  if (!phone) return;
  const existing = excludeTrainerId
    ? db.first<{ id: string }>("SELECT id FROM trainers WHERE phone = ? AND id != ?", [
        phone,
        excludeTrainerId,
      ])
    : db.first<{ id: string }>("SELECT id FROM trainers WHERE phone = ?", [phone]);
  if (existing) throw errConflict("errors.trainerPhoneTaken");
}

export interface TrainerInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  specialization?: string | null;
  rankTitle?: string | null;
  joinedDate?: string;
  notes?: string | null;
  defaultSessionFeeMinor?: number;
  workingSchedule?: TrainerScheduleSlot[] | null;
}

function assertTrainerInput(input: TrainerInput): {
  fullName: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  rankTitle: string | null;
  joinedDate: string;
  notes: string | null;
  defaultSessionFeeMinor: number;
  workingSchedule: string | null;
} {
  const fullName = input.fullName.trim();
  if (fullName.length < 3) throw errValidation("errors.fullNameRequired");
  const today = todayKey();
  const joinedDate = input.joinedDate?.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedDate)) throw errValidation("errors.invalidDate");
  if (joinedDate > addDaysKey(today, 365)) throw errValidation("errors.dateInFuture");
  const defaultSessionFeeMinor = Math.max(0, Math.floor(Number(input.defaultSessionFeeMinor ?? 0)));

  let workingSchedule: string | null = null;
  if (input.workingSchedule && Array.isArray(input.workingSchedule)) {
    workingSchedule = JSON.stringify(input.workingSchedule);
  }

  return {
    fullName,
    phone: assertOptionalPhone(input.phone),
    email: assertOptionalEmail(input.email),
    specialization: input.specialization?.trim().slice(0, 120) || null,
    rankTitle: input.rankTitle?.trim().slice(0, 120) || null,
    joinedDate,
    notes: input.notes?.trim().slice(0, 500) || null,
    defaultSessionFeeMinor,
    workingSchedule,
  };
}

export async function createTrainer(
  db: Db,
  actor: ServiceActor,
  input: TrainerInput,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const data = assertTrainerInput(input);
  assertPhoneFree(db, data.phone);

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO trainers (id, full_name, phone, email, specialization, rank_title, joined_date, is_active, notes, default_session_fee_minor, working_schedule, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
      [
        id,
        data.fullName,
        data.phone,
        data.email,
        data.specialization,
        data.rankTitle,
        data.joinedDate,
        data.notes,
        data.defaultSessionFeeMinor,
        data.workingSchedule,
        actor.userId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "TRAINER_CREATED", "trainer", id, { name: data.fullName });
  });
  return toTrainer(getTrainerById(db, id)!);
}

export async function updateTrainer(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
  input: TrainerInput,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  const data = assertTrainerInput(input);
  assertPhoneFree(db, data.phone, trainerId);

  await db.transaction(async () => {
    db.run(
      "UPDATE trainers SET full_name = ?, phone = ?, email = ?, specialization = ?, rank_title = ?, joined_date = ?, notes = ?, default_session_fee_minor = ?, working_schedule = ?, updated_at = ? WHERE id = ?",
      [
        data.fullName,
        data.phone,
        data.email,
        data.specialization,
        data.rankTitle,
        data.joinedDate,
        data.notes,
        data.defaultSessionFeeMinor,
        data.workingSchedule,
        nowStamp(),
        trainerId,
      ],
    );
    recordAudit(db, actor, "TRAINER_UPDATED", "trainer", trainerId, { name: data.fullName });
  });
  return toTrainer(getTrainerById(db, trainerId)!);
}

export async function setTrainerActive(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
  active: boolean,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  const target = active ? 1 : 0;
  if (trainer.is_active === target) return toTrainer(trainer);

  if (!active) {
    const activePlans = db.count(
      "SELECT COUNT(*) FROM training_plans WHERE trainer_id = ? AND status = 'active'",
      [trainerId],
    );
    if (activePlans > 0) throw errConflict("errors.trainerHasActivePlans", { count: activePlans });
  }

  await db.transaction(async () => {
    db.run("UPDATE trainers SET is_active = ?, updated_at = ? WHERE id = ?", [
      target,
      nowStamp(),
      trainerId,
    ]);
    recordAudit(db, actor, active ? "TRAINER_ACTIVATED" : "TRAINER_DEACTIVATED", "trainer", trainerId, {
      name: trainer.full_name,
    });
  });
  return toTrainer(getTrainerById(db, trainerId)!);
}

export async function deleteTrainer(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
): Promise<void> {
  requirePermission(actor, "trainers.purge");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  const trainerName = trainer.full_name;

  await db.transaction(async () => {
    // 1. Unlink or clean assessments referencing this trainer
    db.run("UPDATE body_assessments SET trainer_id = NULL WHERE trainer_id = ?", [trainerId]);
    db.run("UPDATE fitness_test_results SET trainer_id = NULL WHERE trainer_id = ?", [trainerId]);

    // 2. Unlink classes assigned to this trainer
    db.run("UPDATE classes SET trainer_id = NULL WHERE trainer_id = ?", [trainerId]);

    // 3. Unlink employees referencing this trainer
    db.run("UPDATE employees SET trainer_id = NULL WHERE trainer_id = ?", [trainerId]);

    // 4. Delete training plans for this trainer
    db.run("DELETE FROM training_plans WHERE trainer_id = ?", [trainerId]);

    // 5. Delete trainer
    db.run("DELETE FROM trainers WHERE id = ?", [trainerId]);

    recordAudit(db, actor, "TRAINER_PURGED", "trainer", trainerId, { name: trainerName });
  });
}

export interface TrainerListQuery {
  search?: string;
  activeOnly?: boolean;
}

interface TrainerWithStats extends TrainerRow {
  active_plans: number;
}

export function listTrainers(
  db: Db,
  actor: ServiceActor,
  query: TrainerListQuery = {},
): Array<PublicTrainer & { activePlans: number }> {
  requirePermission(actor, "trainers.view");
  const conditions: string[] = [];
  const params: Array<string> = [];
  if (query.activeOnly) conditions.push("t.is_active = 1");
  const search = query.search?.trim();
  if (search) {
    conditions.push("(t.full_name LIKE ? OR t.phone LIKE ? OR t.specialization LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.all<TrainerWithStats & { assigned_academies?: string }>(
    `SELECT t.*, e.full_name AS employee_name,
      (SELECT COUNT(*) FROM training_plans tp WHERE tp.trainer_id = t.id AND tp.status = 'active') AS active_plans,
      (SELECT GROUP_CONCAT(COALESCE(p.name, c.name), '، ') 
       FROM classes c 
       LEFT JOIN membership_plans p ON p.id = c.plan_id 
       WHERE c.trainer_id = t.id AND c.is_active = 1
      ) AS assigned_academies
     FROM trainers t
     LEFT JOIN employees e ON t.employee_id = e.id
     ${where}
     ORDER BY t.is_active DESC, t.full_name COLLATE NOCASE`,
    params,
  );
  return rows.map((row) => ({ ...toTrainer(row), activePlans: Number(row.active_plans) }));
}

export async function linkTrainerToEmployee(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
  employeeId: string | null,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  if (employeeId) {
    const emp = db.first("SELECT id FROM employees WHERE id = ?", [employeeId]);
    if (!emp) throw errNotFound("errors.employeeNotFound");
  }
  db.run("UPDATE trainers SET employee_id = ?, updated_at = ? WHERE id = ?", [
    employeeId,
    nowStamp(),
    trainerId,
  ]);
  recordAudit(db, actor, "TRAINER_UPDATED", "trainer", trainerId, {
    action: "LINK_EMPLOYEE",
    employeeId,
  });
  return toTrainer(getTrainerById(db, trainerId)!);
}

export async function createEmployeeForTrainer(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
  customInput?: {
    salaryType?: "monthly" | "daily" | "per_class" | "custom";
    salaryBaseMinor?: number;
    department?: "general" | "men" | "women";
    commissionPct?: number;
  },
): Promise<{ trainer: PublicTrainer; employeeId: string }> {
  requirePermission(actor, "trainers.manage");
  requirePermission(actor, "employees.manage");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");

  const existingEmp = trainer.phone
    ? db.first<{ id: string }>("SELECT id FROM employees WHERE phone = ?", [trainer.phone])
    : null;

  let empId: string;
  if (existingEmp) {
    empId = existingEmp.id;
  } else {
    const { createEmployee } = await import("./employees.service");
    const emp = await createEmployee(db, actor, {
      fullName: trainer.full_name,
      phone: trainer.phone,
      roleTitle: trainer.rank_title || "مدرب صالة",
      department: customInput?.department ?? "general",
      specialization: trainer.specialization,
      joinedDate: trainer.joined_date,
      salaryType: customInput?.salaryType ?? "monthly",
      salaryBaseMinor: customInput?.salaryBaseMinor ?? 0,
      commissionPct: customInput?.commissionPct ?? 0,
      notes: trainer.notes,
    });
    empId = emp.id;
  }

  db.run("UPDATE trainers SET employee_id = ?, updated_at = ? WHERE id = ?", [
    empId,
    nowStamp(),
    trainerId,
  ]);

  recordAudit(db, actor, "TRAINER_UPDATED", "trainer", trainerId, {
    action: "CREATE_AND_LINK_EMPLOYEE",
    employeeId: empId,
  });

  return {
    trainer: toTrainer(getTrainerById(db, trainerId)!),
    employeeId: empId,
  };
}

// --------------------------- Direct Trainer Payouts ---------------------------

export type TrainerPayoutType =
  | "monthly_salary"
  | "academy_fee"
  | "pt_commission"
  | "bonus"
  | "advance"
  | "other";

export interface TrainerPayoutInput {
  trainerId: string;
  amountMinor: number;
  payoutDate?: string;
  payoutType?: TrainerPayoutType;
  methodCode?: string;
  notes?: string | null;
}

export interface TrainerPayout {
  id: string;
  trainerId: string;
  trainerName: string;
  amountMinor: number;
  payoutDate: string;
  payoutType: TrainerPayoutType;
  methodCode: string;
  notes: string | null;
  expenseId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export async function recordTrainerPayout(
  db: Db,
  actor: ServiceActor,
  input: TrainerPayoutInput,
): Promise<TrainerPayout> {
  requirePermission(actor, "trainers.manage");
  const trainer = getTrainerById(db, input.trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");

  const amountMinor = Math.round(Number(input.amountMinor));
  if (amountMinor <= 0) throw errValidation("errors.finance.amountMustBePositive");

  const today = todayKey();
  const payoutDate = input.payoutDate?.trim() || today;
  if (!isValidDateKey(payoutDate)) throw errValidation("errors.invalidDate");
  if (payoutDate > today) throw errValidation("errors.finance.futureDate");

  const methodCode = input.methodCode?.trim() || "cash";
  const method = db.first<Row>("SELECT code, is_active FROM payment_methods WHERE code = ?", [methodCode]);
  if (!method) throw errValidation("errors.finance.methodNotFound");
  if (Number(method.is_active) !== 1) throw errValidation("errors.finance.methodInactive");

  const payoutType: TrainerPayoutType = input.payoutType || "academy_fee";
  const payoutTypeLabels: Record<TrainerPayoutType, string> = {
    monthly_salary: "مرتب شهري",
    academy_fee: "أتعاب أكاديمية / حصص",
    pt_commission: "نسبة تدريب خاص PT",
    bonus: "مكافأة",
    advance: "سلفة نقدية",
    other: "دفعة نقدية",
  };
  const typeLabel = payoutTypeLabels[payoutType] ?? "دفعة نقدية";

  const notes = input.notes?.trim() || null;
  const desc = `مرتب مدرب: ${trainer.full_name} (${typeLabel})${notes ? ` — ${notes}` : ""}`;
  const id = crypto.randomUUID();
  const expenseId = crypto.randomUUID();
  const stamp = nowStamp();
  const branchId = getLocalBranchId(db);

  const catRow = db.first<Row>(
    "SELECT id FROM expense_categories WHERE id = 'cat-salaries' OR name_ar = 'مرتبات' OR id = 'cat-trainers' ORDER BY (id = 'cat-salaries') DESC LIMIT 1",
  );
  const categoryId = catRow?.id ? String(catRow.id) : "cat-salaries";

  await db.transaction(async () => {
    // 1. Create expense in expenses table
    db.run(
      `INSERT INTO expenses (id, category_id, amount_minor, method_code, description, expense_date, reference_no, status, created_by, created_at, updated_at, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?)`,
      [
        expenseId,
        categoryId,
        amountMinor,
        methodCode,
        desc,
        payoutDate,
        actor.userId,
        stamp,
        stamp,
        branchId,
      ],
    );

    // 2. Insert into financial ledger
    insertLedgerEntry(db, {
      entryType: "expense",
      refTable: "expenses",
      refId: expenseId,
      memberId: null,
      methodCode,
      direction: -1,
      amountMinor,
      occurredAt: `${payoutDate} ${stamp.slice(11)}`,
      actor,
    });

    // 3. Create trainer_payouts row
    db.run(
      `INSERT INTO trainer_payouts (id, trainer_id, amount_minor, payout_date, payout_type, method_code, notes, expense_id, created_by, created_at, updated_at, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        trainer.id,
        amountMinor,
        payoutDate,
        payoutType,
        methodCode,
        notes,
        expenseId,
        actor.userId,
        stamp,
        stamp,
        branchId,
      ],
    );

    recordAudit(db, actor, "TRAINER_SESSION_PAID", "trainer", trainer.id, {
      payoutId: id,
      amountMinor,
      payoutType,
      expenseId,
    });
  });

  return {
    id,
    trainerId: trainer.id,
    trainerName: trainer.full_name,
    amountMinor,
    payoutDate,
    payoutType,
    methodCode,
    notes,
    expenseId,
    createdBy: actor.userId,
    createdAt: stamp,
  };
}

export function listTrainerPayouts(
  db: Db,
  actor: ServiceActor,
  trainerId?: string,
): TrainerPayout[] {
  requirePermission(actor, "trainers.view");
  const where = trainerId ? "WHERE tp.trainer_id = ?" : "";
  const params = trainerId ? [trainerId] : [];
  return db
    .all<Row>(
      `SELECT tp.*, t.full_name AS trainer_name
       FROM trainer_payouts tp
       JOIN trainers t ON t.id = tp.trainer_id
       ${where}
       ORDER BY tp.payout_date DESC, tp.created_at DESC`,
      params,
    )
    .map((r) => ({
      id: String(r.id),
      trainerId: String(r.trainer_id),
      trainerName: String(r.trainer_name),
      amountMinor: Number(r.amount_minor),
      payoutDate: String(r.payout_date),
      payoutType: String(r.payout_type) as TrainerPayoutType,
      methodCode: String(r.method_code),
      notes: r.notes ? String(r.notes) : null,
      expenseId: r.expense_id ? String(r.expense_id) : null,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: String(r.created_at),
    }));
}

export async function deleteTrainerPayout(
  db: Db,
  actor: ServiceActor,
  payoutId: string,
): Promise<void> {
  requirePermission(actor, "trainers.manage");
  const row = db.first<Row>("SELECT * FROM trainer_payouts WHERE id = ?", [payoutId]);
  if (!row) throw errNotFound("errors.notFound");

  await db.transaction(async () => {
    db.run("DELETE FROM trainer_payouts WHERE id = ?", [payoutId]);
    if (row.expense_id) {
      db.run("DELETE FROM financial_ledger WHERE ref_table = 'expenses' AND ref_id = ?", [row.expense_id]);
      db.run("DELETE FROM expenses WHERE id = ?", [row.expense_id]);
    }
    recordAudit(db, actor, "EXPENSE_VOIDED", "trainer_payout", payoutId, {
      trainerId: row.trainer_id,
      amountMinor: row.amount_minor,
    });
  });
}

export interface TrainerFinancialSummary {
  trainerId: string;
  trainerName: string;
  totalPtDuesMinor: number;
  totalClassDuesMinor: number;
  totalPaidMinor: number;
  balanceDueMinor: number;
  ptSessionsCompleted: number;
  classesCompleted: number;
  payoutsCount: number;
}

export function getTrainerFinancialSummary(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
): TrainerFinancialSummary {
  requirePermission(actor, "trainers.view");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");

  // 1. Total paid from trainer_payouts
  const paidRow = db.first<Row>(
    "SELECT COALESCE(SUM(amount_minor), 0) AS total_paid, COUNT(*) AS cnt FROM trainer_payouts WHERE trainer_id = ?",
    [trainerId],
  );
  const totalPaidMinor = Number(paidRow?.total_paid ?? 0);
  const payoutsCount = Number(paidRow?.cnt ?? 0);

  // 2. PT sessions completed for this trainer
  const ptRows = db.all<Row>(
    `SELECT s.id, pt.price_minor, pt.total_sessions, pkg.coach_commission_percent
     FROM private_training_sessions s
     JOIN private_trainings pt ON s.private_training_id = pt.id
     LEFT JOIN private_training_packages pkg ON pt.package_id = pkg.id
     WHERE s.trainer_id = ?`,
    [trainerId],
  );
  let totalPtDuesMinor = 0;
  for (const r of ptRows) {
    const totalSessions = Math.max(1, Number(r.total_sessions || 1));
    const priceMinor = Number(r.price_minor || 0);
    const pricePerSession = Math.round(priceMinor / totalSessions);
    const commPct = Number(r.coach_commission_percent || 0);
    if (commPct > 0) {
      totalPtDuesMinor += Math.round((pricePerSession * commPct) / 100);
    } else {
      totalPtDuesMinor += Number(trainer.default_session_fee_minor || 0);
    }
  }

  // 3. Completed classes for this trainer
  const classRows = db.all<Row>(
    `SELECT cs.id, c.name
     FROM class_sessions cs
     JOIN classes c ON cs.class_id = c.id
     WHERE c.trainer_id = ? AND cs.status = 'done'`,
    [trainerId],
  );
  const classesCompleted = classRows.length;
  let classRateMinor = Number(trainer.default_session_fee_minor || 0);
  if (trainer.employee_id) {
    const emp = db.first<Row>("SELECT salary_type, salary_base_minor FROM employees WHERE id = ?", [trainer.employee_id]);
    if (emp && emp.salary_type === "per_class") {
      classRateMinor = Number(emp.salary_base_minor || 0);
    }
  }
  const totalClassDuesMinor = classesCompleted * classRateMinor;

  const totalDuesMinor = totalPtDuesMinor + totalClassDuesMinor;
  const balanceDueMinor = Math.max(0, totalDuesMinor - totalPaidMinor);

  return {
    trainerId,
    trainerName: trainer.full_name,
    totalPtDuesMinor,
    totalClassDuesMinor,
    totalPaidMinor,
    balanceDueMinor,
    ptSessionsCompleted: ptRows.length,
    classesCompleted,
    payoutsCount,
  };
}

export interface TrainerStatementItem {
  id: string;
  date: string;
  type: "pt_session" | "class_session" | "salary_base" | "payout";
  title: string;
  subtitle?: string | null;
  creditMinor: number;
  debitMinor: number;
  balanceMinor: number;
  notes?: string | null;
  receiptNo?: string | null;
}

export interface TrainerDetailedStatement {
  trainer: PublicTrainer;
  period: { fromDate?: string | null; toDate?: string | null };
  items: TrainerStatementItem[];
  totals: {
    totalPtEarningsMinor: number;
    totalClassEarningsMinor: number;
    totalSalaryEarningsMinor: number;
    totalGrossEarningsMinor: number;
    totalPayoutsMinor: number;
    netBalanceDueMinor: number;
    ptSessionsCount: number;
    classSessionsCount: number;
    payoutsCount: number;
  };
}

export function getTrainerDetailedStatement(
  db: Db,
  actor: ServiceActor,
  params: {
    trainerId: string;
    fromDate?: string;
    toDate?: string;
  },
): TrainerDetailedStatement {
  requirePermission(actor, "trainers.view");
  const trainerRow = getTrainerById(db, params.trainerId);
  if (!trainerRow) throw errNotFound("errors.trainerNotFound");
  const trainer = toTrainer(trainerRow);

  const rawItems: Array<{
    id: string;
    date: string;
    type: "pt_session" | "class_session" | "salary_base" | "payout";
    title: string;
    subtitle?: string | null;
    creditMinor: number;
    debitMinor: number;
    notes?: string | null;
    receiptNo?: string | null;
  }> = [];

  // 1. PT sessions
  const ptConditions = ["s.trainer_id = ?"];
  const ptParams: SqlValue[] = [params.trainerId];
  if (params.fromDate) {
    ptConditions.push("s.session_date >= ?");
    ptParams.push(params.fromDate);
  }
  if (params.toDate) {
    ptConditions.push("s.session_date <= ?");
    ptParams.push(params.toDate);
  }

  const ptSessions = db.all<Row>(
    `SELECT s.id, s.session_date, s.session_time, m.full_name AS member_name,
            pt.price_minor, pt.total_sessions, pkg.name AS package_name, pkg.coach_commission_percent
     FROM private_training_sessions s
     JOIN private_trainings pt ON s.private_training_id = pt.id
     JOIN members m ON pt.member_id = m.id
     LEFT JOIN private_training_packages pkg ON pt.package_id = pkg.id
     WHERE ${ptConditions.join(" AND ")}
     ORDER BY s.session_date ASC`,
    ptParams,
  );

  let totalPtEarningsMinor = 0;
  for (const s of ptSessions) {
    const totalSessions = Math.max(1, Number(s.total_sessions || 1));
    const priceMinor = Number(s.price_minor || 0);
    const pricePerSession = Math.round(priceMinor / totalSessions);
    const commPct = Number(s.coach_commission_percent || 0);
    let fee = 0;
    if (commPct > 0) {
      fee = Math.round((pricePerSession * commPct) / 100);
    } else {
      fee = Number(trainer.defaultSessionFeeMinor || 0);
    }
    totalPtEarningsMinor += fee;
    rawItems.push({
      id: String(s.id),
      date: String(s.session_date),
      type: "pt_session",
      title: `حصة تدريب خاص PT: ${s.member_name}`,
      subtitle: `باقة ${s.package_name || "تدريب خاص"}${s.session_time ? ` (${s.session_time})` : ""}`,
      creditMinor: fee,
      debitMinor: 0,
      notes: commPct > 0 ? `عمولة بنسبة ${commPct}%` : "أجر مقطوع للحصة",
    });
  }

  // 2. Class sessions
  const clsConditions = ["c.trainer_id = ?", "cs.status = 'done'"];
  const clsParams: SqlValue[] = [params.trainerId];
  if (params.fromDate) {
    clsConditions.push("cs.session_date >= ?");
    clsParams.push(params.fromDate);
  }
  if (params.toDate) {
    clsConditions.push("cs.session_date <= ?");
    clsParams.push(params.toDate);
  }

  const classSessions = db.all<Row>(
    `SELECT cs.id, cs.session_date, cs.start_time, cs.trainer_fee_minor,
            c.name AS class_name,
            (SELECT COUNT(*) FROM class_bookings b WHERE b.session_id = cs.id AND b.status = 'attended') AS attended_count
     FROM class_sessions cs
     JOIN classes c ON cs.class_id = c.id
     WHERE ${clsConditions.join(" AND ")}
     ORDER BY cs.session_date ASC`,
    clsParams,
  );

  let totalClassEarningsMinor = 0;
  for (const cs of classSessions) {
    let fee = Number(cs.trainer_fee_minor || 0);
    if (fee <= 0) {
      fee = Number(trainer.defaultSessionFeeMinor || 0);
    }
    totalClassEarningsMinor += fee;
    const attended = Number(cs.attended_count || 0);
    rawItems.push({
      id: String(cs.id),
      date: String(cs.session_date),
      type: "class_session",
      title: `حصة أكاديمية / جماعية: ${cs.class_name}`,
      subtitle: `حضور ${attended} مشترك - موعد: ${cs.start_time || ""}`,
      creditMinor: fee,
      debitMinor: 0,
      notes: "أتعاب تدريب الحصة",
    });
  }

  // 3. Payouts (Debits)
  const payConditions = ["trainer_id = ?"];
  const payParams: SqlValue[] = [params.trainerId];
  if (params.fromDate) {
    payConditions.push("payout_date >= ?");
    payParams.push(params.fromDate);
  }
  if (params.toDate) {
    payConditions.push("payout_date <= ?");
    payParams.push(params.toDate);
  }

  const payouts = db.all<Row>(
    `SELECT * FROM trainer_payouts
     WHERE ${payConditions.join(" AND ")}
     ORDER BY payout_date ASC`,
    payParams,
  );

  let totalPayoutsMinor = 0;
  for (const p of payouts) {
    const amt = Number(p.amount_minor || 0);
    totalPayoutsMinor += amt;
    rawItems.push({
      id: String(p.id),
      date: String(p.payout_date),
      type: "payout",
      title: `صرف مستحقات / دفعة نقدية (${p.payout_type || "سداد"})`,
      subtitle: `طريقة الدفع: ${p.method_code || "كاش"}`,
      creditMinor: 0,
      debitMinor: amt,
      notes: p.notes == null ? null : String(p.notes),
      receiptNo: p.receipt_no == null ? null : String(p.receipt_no),
    });
  }

  // Sort all chronologically
  rawItems.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Compute running balance
  let runningBalance = 0;
  const items: TrainerStatementItem[] = rawItems.map((item) => {
    runningBalance += item.creditMinor - item.debitMinor;
    return {
      ...item,
      balanceMinor: runningBalance,
    };
  });

  const totalGrossEarningsMinor = totalPtEarningsMinor + totalClassEarningsMinor;
  const netBalanceDueMinor = Math.max(0, totalGrossEarningsMinor - totalPayoutsMinor);

  return {
    trainer,
    period: {
      fromDate: params.fromDate || null,
      toDate: params.toDate || null,
    },
    items,
    totals: {
      totalPtEarningsMinor,
      totalClassEarningsMinor,
      totalSalaryEarningsMinor: 0,
      totalGrossEarningsMinor,
      totalPayoutsMinor,
      netBalanceDueMinor,
      ptSessionsCount: ptSessions.length,
      classSessionsCount: classSessions.length,
      payoutsCount: payouts.length,
    },
  };
}


