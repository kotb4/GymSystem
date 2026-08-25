import { isValidDateKey, nowStamp, todayKey } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { insertLedgerEntry } from "./payments.service";

export type ExpenseStatus = "active" | "voided";

export interface ExpenseRow extends Row {
  id: string;
  category_id: string;
  amount_minor: number;
  method_code: string;
  description: string;
  expense_date: string;
  reference_no: string | null;
  status: ExpenseStatus;
  created_by: string;
}

export interface Expense {
  id: string;
  categoryId: string;
  categoryNameAr: string;
  amountMinor: number;
  methodCode: string;
  methodLabel: string;
  description: string;
  expenseDate: string;
  referenceNo: string | null;
  status: ExpenseStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface ExpenseCategory {
  id: string;
  nameAr: string;
  isActive: boolean;
  usageCount: number;
}

const EXPENSE_SELECT = `SELECT e.*, c.name_ar AS category_name, pm.label_ar AS method_label, u.full_name AS creator_name\nFROM expenses e\nJOIN expense_categories c ON c.id = e.category_id\nJOIN payment_methods pm ON pm.code = e.method_code\nJOIN users u ON u.id = e.created_by`;

function mapExpense(row: ExpenseRow & Record<string, unknown>): Expense {
  return {
    ...row,
    categoryId: row.category_id,
    categoryNameAr: String(row.category_name ?? ""),
    amountMinor: Number(row.amount_minor),
    methodCode: row.method_code,
    methodLabel: String(row.method_label ?? row.method_code),
    description: row.description,
    expenseDate: row.expense_date,
    referenceNo: row.reference_no,
    status: row.status as ExpenseStatus,
    createdBy: row.created_by,
    createdByName: String(row.creator_name ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

export interface CreateExpenseInput {
  categoryId: string;
  amountMinor: number;
  methodCode: string;
  description: string;
  expenseDate?: string;
  referenceNo?: string | null;
}

function validateExpenseInput(db: Db, input: CreateExpenseInput): { dateKey: string } {
  const amountMinor = Math.round(input.amountMinor);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw errValidation("errors.finance.expenseAmountRequired");
  }
  const category = db.first<{ id: string; is_active: number }>(
    "SELECT id, is_active FROM expense_categories WHERE id = ?",
    [input.categoryId],
  );
  if (!category) throw errNotFound("errors.finance.categoryNotFound");
  if (Number(category.is_active) !== 1) throw errValidation("errors.finance.categoryInactive");

  const method = db.first<{ code: string; is_active: number }>(
    "SELECT code, is_active FROM payment_methods WHERE code = ?",
    [input.methodCode],
  );
  if (!method) throw errNotFound("errors.finance.methodNotFound");
  if (Number(method.is_active) !== 1) throw errValidation("errors.finance.methodInactive");

  const trimmedDescription = input.description.trim();
  if (trimmedDescription.length < 3) throw errValidation("errors.finance.descriptionRequired");

  const dateKey = input.expenseDate?.trim() || todayKey();
  if (!isValidDateKey(dateKey)) throw errValidation("errors.invalidDate");
  if (dateKey > todayKey()) throw errValidation("errors.finance.futureDate");
  return { dateKey };
}

export async function createExpense(
  db: Db,
  actor: ServiceActor,
  input: CreateExpenseInput,
): Promise<Expense> {
  requirePermission(actor, "expenses.create");
  const { dateKey } = validateExpenseInput(db, input);

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO expenses (id, category_id, amount_minor, method_code, description, expense_date, reference_no, status, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
      [
        id,
        input.categoryId,
        Math.round(input.amountMinor),
        input.methodCode,
        input.description.trim(),
        dateKey,
        input.referenceNo?.trim() || null,
        actor.userId,
        stamp,
        stamp,
      ],
    );
    insertLedgerEntry(db, {
      entryType: "expense",
      refTable: "expenses",
      refId: id,
      memberId: null,
      methodCode: input.methodCode,
      direction: -1,
      amountMinor: Math.round(input.amountMinor),
      occurredAt: `${dateKey} ${stamp.slice(11)}`,
      actor,
    });
    recordAudit(db, actor, "EXPENSE_CREATED", "expense", id, {
      category: input.categoryId,
      amountMinor: Math.round(input.amountMinor),
      method: input.methodCode,
    });
  });
  return getExpenseById(db, actor, id);
}

export async function updateExpense(
  db: Db,
  actor: ServiceActor,
  expenseId: string,
  patch: CreateExpenseInput,
): Promise<Expense> {
  requirePermission(actor, "expenses.edit");
  const existing = db.first<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", [expenseId]);
  if (!existing) throw errNotFound("errors.finance.expenseNotFound");
  if (existing.status === "voided") throw errConflict("errors.finance.expenseVoided");

  const merged: CreateExpenseInput = {
    categoryId: patch.categoryId,
    amountMinor: patch.amountMinor,
    methodCode: patch.methodCode,
    description: patch.description,
    expenseDate: patch.expenseDate ?? existing.expense_date,
    referenceNo: patch.referenceNo === undefined ? existing.reference_no : patch.referenceNo,
  };
  const { dateKey } = validateExpenseInput(db, merged);
  const newAmount = Math.round(merged.amountMinor);
  const stamp = nowStamp();

  await db.transaction(async () => {
    db.run(
      "UPDATE expenses SET category_id = ?, amount_minor = ?, method_code = ?, description = ?, expense_date = ?, reference_no = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      [
        merged.categoryId,
        newAmount,
        merged.methodCode,
        merged.description.trim(),
        dateKey,
        merged.referenceNo?.trim() || null,
        actor.userId,
        stamp,
        expenseId,
      ],
    );
    if (newAmount !== Number(existing.amount_minor)) {
      adjustLedgerEntry(db, "expenses", actor, newAmount - Number(existing.amount_minor));
    }
    recordAudit(db, actor, "EXPENSE_UPDATED", "expense", expenseId, {
      beforeAmountMinor: Number(existing.amount_minor),
      afterAmountMinor: newAmount,
    });
  });
  return getExpenseById(db, actor, expenseId);
}

function adjustLedgerEntry(
  db: Db,
  refTable: string,
  actor: ServiceActor,
  deltaMinor: number,
): void {
  if (deltaMinor === 0) return;
  insertLedgerEntry(db, {
    entryType: deltaMinor > 0 ? "expense" : "reversal_expense",
    refTable,
    refId: crypto.randomUUID(),
    memberId: null,
    methodCode: "",
    direction: deltaMinor > 0 ? -1 : 1,
    amountMinor: Math.abs(deltaMinor),
    occurredAt: nowStamp(),
    actor,
  });
}

export async function voidExpense(
  db: Db,
  actor: ServiceActor,
  expenseId: string,
  reason: string,
): Promise<Expense> {
  requirePermission(actor, "expenses.edit");
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) throw errValidation("errors.finance.voidReasonRequired");
  const existing = db.first<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", [expenseId]);
  if (!existing) throw errNotFound("errors.finance.expenseNotFound");
  if (existing.status === "voided") throw errConflict("errors.finance.alreadyVoided");

  const stamp = nowStamp();
  await db.transaction(async () => {
    db.run(
      "UPDATE expenses SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      [trimmedReason, actor.userId, stamp, actor.userId, stamp, expenseId],
    );
    insertLedgerEntry(db, {
      entryType: "reversal_expense",
      refTable: "expenses",
      refId: expenseId,
      memberId: null,
      methodCode: existing.method_code,
      direction: 1,
      amountMinor: Number(existing.amount_minor),
      occurredAt: stamp,
      actor,
    });
    recordAudit(db, actor, "EXPENSE_VOIDED", "expense", expenseId, {
      reason: trimmedReason,
      amountMinor: Number(existing.amount_minor),
    });
  });
  return getExpenseById(db, actor, expenseId);
}

export function getExpenseById(db: Db, actor: ServiceActor, expenseId: string): Expense {
  requirePermission(actor, "expenses.view");
  const row = db.first<ExpenseRow & Record<string, unknown>>(`${EXPENSE_SELECT}\nWHERE e.id = ?`, [
    expenseId,
  ]);
  if (!row) throw errNotFound("errors.finance.expenseNotFound");
  return mapExpense(row);
}

export interface ExpenseListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  fromKey?: string;
  toKey?: string;
  categoryId?: string;
  methodCode?: string;
  createdBy?: string;
  status?: ExpenseStatus | "all";
  minAmountMinor?: number;
  maxAmountMinor?: number;
}

export function listExpenses(
  db: Db,
  actor: ServiceActor,
  query: ExpenseListQuery = {},
): { items: Expense[]; total: number } {
  requirePermission(actor, "expenses.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));

  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (query.search?.trim()) {
    conditions.push("(e.description LIKE ? OR e.reference_no LIKE ?)");
    const like = `%${query.search.trim()}%`;
    params.push(like, like);
  }
  if (query.fromKey) {
    conditions.push("e.expense_date >= ?");
    params.push(query.fromKey);
  }
  if (query.toKey) {
    conditions.push("e.expense_date <= ?");
    params.push(query.toKey);
  }
  if (query.categoryId && query.categoryId !== "all") {
    conditions.push("e.category_id = ?");
    params.push(query.categoryId);
  }
  if (query.methodCode && query.methodCode !== "all") {
    conditions.push("e.method_code = ?");
    params.push(query.methodCode);
  }
  if (query.createdBy && query.createdBy !== "all") {
    conditions.push("e.created_by = ?");
    params.push(query.createdBy);
  }
  if (query.status && query.status !== "all") {
    conditions.push("e.status = ?");
    params.push(query.status);
  }
  if (query.minAmountMinor !== undefined) {
    conditions.push("e.amount_minor >= ?");
    params.push(Math.round(query.minAmountMinor));
  }
  if (query.maxAmountMinor !== undefined) {
    conditions.push("e.amount_minor <= ?");
    params.push(Math.round(query.maxAmountMinor));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM expenses e ${where}`, params);
  const rows = db.all<ExpenseRow & Record<string, unknown>>(
    `${EXPENSE_SELECT}\n${where}\nORDER BY e.expense_date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapExpense), total };
}

export function listCategories(db: Db, includeInactive = true): ExpenseCategory[] {
  const where = includeInactive ? "" : "WHERE c.is_active = 1";
  const rows = db.all<{
    id: string;
    name_ar: string;
    is_active: number;
    usage_count: number;
  }>(
    `SELECT c.*, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS usage_count\nFROM expense_categories c ${where} ORDER BY c.name_ar`,
  );
  return rows.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    isActive: Number(r.is_active) === 1,
    usageCount: Number(r.usage_count),
  }));
}

export function createCategory(db: Db, actor: ServiceActor, nameAr: string): ExpenseCategory {
  requirePermission(actor, "expenses.edit");
  const trimmed = nameAr.trim();
  if (trimmed.length < 2) throw errValidation("errors.finance.categoryNameRequired");
  const existing = db.first<{ id: string }>(
    "SELECT id FROM expense_categories WHERE name_ar = ?",
    [trimmed],
  );
  if (existing) throw errConflict("errors.finance.categoryExists");
  const id = crypto.randomUUID();
  db.run("INSERT INTO expense_categories (id, name_ar, is_active, created_at)\nVALUES (?, ?, 1, ?)", [
    id,
    trimmed,
    nowStamp(),
  ]);
  recordAudit(db, actor, "EXPENSE_CATEGORY_CREATED", "expense_category", id, { name: trimmed });
  return { id, nameAr: trimmed, isActive: true, usageCount: 0 };
}

export function setCategoryActive(
  db: Db,
  actor: ServiceActor,
  categoryId: string,
  isActive: boolean,
): void {
  requirePermission(actor, "expenses.edit");
  const category = db.first<{ id: string; is_active: number; name_ar: string }>(
    "SELECT id, is_active, name_ar FROM expense_categories WHERE id = ?",
    [categoryId],
  );
  if (!category) throw errNotFound("errors.finance.categoryNotFound");
  const wasActive = Number(category.is_active) === 1;
  if (wasActive === isActive) return;
  if (wasActive) {
    const used = db.count("SELECT COUNT(*) FROM expenses WHERE category_id = ? AND status = 'active'", [
      categoryId,
    ]);
    if (used > 0) {
      throw errConflict("errors.finance.categoryInUse", { count: used });
    }
  }
  db.run("UPDATE expense_categories SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, categoryId]);
  recordAudit(db, actor, "EXPENSE_CATEGORY_TOGGLED", "expense_category", categoryId, {
    to: isActive ? "active" : "inactive",
  });
}
