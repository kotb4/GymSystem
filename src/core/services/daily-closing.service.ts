import { isValidDateKey, nowStamp } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { assertNonNegativeInteger } from "@/core/money";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";

export type CashBox = "gym" | "store";
export type DailyClosingStatus = "open" | "closed" | "reopened";

export const METHOD_CASH = "cash";
export const METHOD_CARD = "bank_card";
export const METHOD_TRANSFER = "transfer";
export const METHOD_OTHER = "other";

interface DailyClosingRow extends Row {
  id: string;
  business_date: string;
  box: CashBox;
  status: DailyClosingStatus;
  opening_balance_minor: number;
  expected_cash_minor: number;
  expected_card_minor: number;
  expected_transfer_minor: number;
  expected_other_minor: number;
  expected_total_minor: number;
  counted_cash_minor: number | null;
  difference_minor: number | null;
  reason: string | null;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  opened_by: string;
  opened_by_name: string;
  opened_at: string;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  reopen_reason: string | null;
  reopened_by: string | null;
  reopened_by_name: string | null;
  reopened_at: string | null;
  reopen_count: number;
  superseded_by: string | null;
}

export interface ExpectedBreakdown {
  cash: number;
  card: number;
  transfer: number;
  other: number;
  total: number;
}

export interface DailyClosingSnapshot {
  id: string;
  businessDate: string;
  box: CashBox;
  status: DailyClosingStatus;
  openingBalanceMinor: number;
  expected: ExpectedBreakdown;
  countedCashMinor: number | null;
  differenceMinor: number | null;
  reason: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  openedById: string;
  openedByName: string;
  openedAt: string;
  closedById: string | null;
  closedByName: string | null;
  closedAt: string | null;
  reopenReason: string | null;
  reopenedById: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenCount: number;
  supersededBy: string | null;
}

export interface DailyClosingDetail extends DailyClosingSnapshot {
  methodBreakdown: Array<{ methodCode: string; expectedMinor: number; actualMinor: number | null }>;
  payments: Array<{ id: string; paidAt: string; memberCode: string | null; memberName: string | null; methodCode: string; methodLabel: string; amountMinor: number }>;
  expenses: Array<{ id: string; expenseDate: string; categoryName: string; description: string; methodCode: string; methodLabel: string; amountMinor: number }>;
  refunds: Array<{ id: string; paidAt: string; paymentId: string; methodCode: string; methodLabel: string; amountMinor: number }>;
}

export interface TreasurySnapshot {
  businessDate: string;
  box: CashBox;
  status: DailyClosingStatus | "missing";
  expectedMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  differenceMinor: number | null;
  closingId: string | null;
}

export interface DailyClosingListQuery {
  page?: number;
  pageSize?: number;
  fromKey?: string;
  toKey?: string;
  box?: CashBox | "all";
  status?: DailyClosingStatus | "all";
  currentOnly?: boolean;
}

export interface CreateDailyClosingInput {
  businessDate: string;
  box: CashBox;
  openingBalanceMinor: number;
}

export interface RecordCountedInput {
  countedCashMinor: number;
  reason?: string | null;
}

function isValidBox(box: string): box is CashBox {
  return box === "gym" || box === "store";
}

function dayRange(dateKey: string): { from: string; to: string } {
  return {
    from: `${dateKey} 00:00:00`,
    to: `${dateKey} 23:59:59`,
  };
}

function computeExpectedForClosing(
  db: Db,
  businessDate: string,
  box: CashBox,
): ExpectedBreakdown {
  const { from, to } = dayRange(businessDate);
  const row = db.first<{ cash: number; card: number; transfer: number; other: number; total: number }>(
    `SELECT
      COALESCE(SUM(CASE WHEN method_code = ? THEN direction * amount_minor ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN method_code = ? THEN direction * amount_minor ELSE 0 END), 0) AS card,
      COALESCE(SUM(CASE WHEN method_code = ? THEN direction * amount_minor ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN method_code NOT IN (?, ?, ?) THEN direction * amount_minor ELSE 0 END), 0) AS other,
      COALESCE(SUM(direction * amount_minor), 0) AS total
     FROM financial_ledger
     WHERE occurred_at >= ? AND occurred_at <= ? AND box = ?`,
    [METHOD_CASH, METHOD_CARD, METHOD_TRANSFER, METHOD_CASH, METHOD_CARD, METHOD_TRANSFER, from, to, box],
  );
  return {
    cash: Number(row?.cash ?? 0),
    card: Number(row?.card ?? 0),
    transfer: Number(row?.transfer ?? 0),
    other: Number(row?.other ?? 0),
    total: Number(row?.total ?? 0),
  };
}

function mapRowToSnapshot(row: DailyClosingRow): DailyClosingSnapshot {
  return {
    id: String(row.id),
    businessDate: String(row.business_date),
    box: row.box as CashBox,
    status: row.status as DailyClosingStatus,
    openingBalanceMinor: Number(row.opening_balance_minor),
    expected: {
      cash: Number(row.expected_cash_minor),
      card: Number(row.expected_card_minor),
      transfer: Number(row.expected_transfer_minor),
      other: Number(row.expected_other_minor),
      total: Number(row.expected_total_minor),
    },
    countedCashMinor: row.counted_cash_minor == null ? null : Number(row.counted_cash_minor),
    differenceMinor: row.difference_minor == null ? null : Number(row.difference_minor),
    reason: row.reason == null ? null : String(row.reason),
    responsibleUserId: row.responsible_user_id == null ? null : String(row.responsible_user_id),
    responsibleUserName: row.responsible_user_name == null ? null : String(row.responsible_user_name),
    openedById: String(row.opened_by),
    openedByName: String(row.opened_by_name),
    openedAt: String(row.opened_at),
    closedById: row.closed_by == null ? null : String(row.closed_by),
    closedByName: row.closed_by_name == null ? null : String(row.closed_by_name),
    closedAt: row.closed_at == null ? null : String(row.closed_at),
    reopenReason: row.reopen_reason == null ? null : String(row.reopen_reason),
    reopenedById: row.reopened_by == null ? null : String(row.reopened_by),
    reopenedByName: row.reopened_by_name == null ? null : String(row.reopened_by_name),
    reopenedAt: row.reopened_at == null ? null : String(row.reopened_at),
    reopenCount: Number(row.reopen_count ?? 0),
    supersededBy: row.superseded_by == null ? null : String(row.superseded_by),
  };
}

function loadSnapshot(db: Db, id: string): DailyClosingRow {
  const row = db.first<DailyClosingRow>(
    "SELECT * FROM daily_closings WHERE id = ?",
    [id],
  );
  if (!row) throw errNotFound("errors.treasury.notFound");
  return row;
}

function actorFullName(actor: ServiceActor): string {
  return (actor as ServiceActor & { fullName?: string }).fullName ?? actor.username;
}

export function getOrCreateDailyClosing(
  db: Db,
  actor: ServiceActor,
  input: CreateDailyClosingInput,
): DailyClosingDetail {
  requirePermission(actor, "cash.daily_close");
  if (!isValidDateKey(input.businessDate)) {
    throw errValidation("errors.treasury.invalidBusinessDate");
  }
  if (!isValidBox(input.box)) {
    throw errValidation("errors.treasury.invalidBox");
  }
  assertNonNegativeInteger(Math.round(input.openingBalanceMinor), "errors.treasury.invalidOpeningBalance");

  const existing = db.first<DailyClosingRow>(
    "SELECT * FROM daily_closings WHERE business_date = ? AND box = ? AND superseded_by IS NULL",
    [input.businessDate, input.box],
  );

  if (existing) {
    if (existing.status === "open") {
      const expected = computeExpectedForClosing(db, input.businessDate, input.box);
      db.run(
        `UPDATE daily_closings SET
          opening_balance_minor = ?,
          expected_cash_minor = ?, expected_card_minor = ?, expected_transfer_minor = ?, expected_other_minor = ?,
          expected_total_minor = ?
         WHERE id = ? AND status = 'open'`,
        [
          Math.round(input.openingBalanceMinor),
          expected.cash, expected.card, expected.transfer, expected.other, expected.total,
          existing.id,
        ],
      );
    }
    return getDailyClosingById(db, actor, String(existing.id));
  }

  const expected = computeExpectedForClosing(db, input.businessDate, input.box);
  const id = crypto.randomUUID();
  const fullName = actorFullName(actor);
  db.transaction(() => {
    db.run(
      `INSERT INTO daily_closings (
        id, business_date, box, status, opening_balance_minor,
        expected_cash_minor, expected_card_minor, expected_transfer_minor, expected_other_minor, expected_total_minor,
        opened_by, opened_by_name, opened_at
      ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.businessDate,
        input.box,
        Math.round(input.openingBalanceMinor),
        expected.cash, expected.card, expected.transfer, expected.other, expected.total,
        actor.userId,
        fullName,
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "DAILY_CLOSING_OPENED", "daily_closing", id, {
      businessDate: input.businessDate,
      box: input.box,
      openingBalanceMinor: Math.round(input.openingBalanceMinor),
      expected,
    });
  });

  return getDailyClosingById(db, actor, id);
}

export function recordCountedCash(
  db: Db,
  actor: ServiceActor,
  closingId: string,
  input: RecordCountedInput,
): DailyClosingDetail {
  requirePermission(actor, "cash.daily_close");
  assertNonNegativeInteger(Math.round(input.countedCashMinor), "errors.treasury.invalidCounted");
  const row = loadSnapshot(db, closingId);
  if (row.status !== "open") {
    throw errConflict("errors.treasury.notEditable");
  }
  const expectedCash = Number(row.expected_cash_minor);
  const difference = Math.round(input.countedCashMinor) - expectedCash;
  let reason: string | null = null;
  if (difference !== 0) {
    reason = (input.reason ?? "").trim();
    if (reason.length < 3) {
      throw errValidation("errors.treasury.differenceReasonRequired");
    }
  }

  const stamp = nowStamp();
  const fullName = actorFullName(actor);
  db.transaction(() => {
    db.run(
      `UPDATE daily_closings SET
        counted_cash_minor = ?,
        difference_minor = ?,
        reason = ?,
        responsible_user_id = ?,
        responsible_user_name = ?,
        status = 'closed',
        closed_by = ?,
        closed_by_name = ?,
        closed_at = ?
       WHERE id = ? AND status = 'open'`,
      [
        Math.round(input.countedCashMinor),
        difference,
        reason,
        actor.userId,
        fullName,
        actor.userId,
        fullName,
        stamp,
        closingId,
      ],
    );

    for (const m of [
      { method: METHOD_CASH, expected: Number(row.expected_cash_minor), actual: Math.round(input.countedCashMinor) },
      { method: METHOD_CARD, expected: Number(row.expected_card_minor), actual: Number(row.expected_card_minor) },
      { method: METHOD_TRANSFER, expected: Number(row.expected_transfer_minor), actual: Number(row.expected_transfer_minor) },
      { method: METHOD_OTHER, expected: Number(row.expected_other_minor), actual: Number(row.expected_other_minor) },
    ]) {
      db.run(
        `INSERT INTO daily_closing_audit_entries (id, daily_closing_id, method_code, expected_minor, actual_minor)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(daily_closing_id, method_code) DO UPDATE SET
           expected_minor = excluded.expected_minor,
           actual_minor = excluded.actual_minor`,
        [crypto.randomUUID(), closingId, m.method, m.expected, m.actual],
      );
    }

    recordAudit(db, actor, "DAILY_CLOSING_COUNTED", "daily_closing", closingId, {
      businessDate: String(row.business_date),
      box: String(row.box),
      countedCashMinor: Math.round(input.countedCashMinor),
      expectedCashMinor: expectedCash,
      differenceMinor: difference,
      hasReason: reason != null,
      responsibleUserId: actor.userId,
    });
    if (difference !== 0) {
      recordAudit(db, actor, "DAILY_CLOSING_DISCREPANCY", "daily_closing", closingId, {
        businessDate: String(row.business_date),
        box: String(row.box),
        countedCashMinor: Math.round(input.countedCashMinor),
        expectedCashMinor: expectedCash,
        differenceMinor: difference,
        reason,
      });
    }
  });

  return getDailyClosingById(db, actor, closingId);
}

export function closeDailyClosing(
  db: Db,
  actor: ServiceActor,
  closingId: string,
  input: RecordCountedInput,
): DailyClosingDetail {
  return recordCountedCash(db, actor, closingId, input);
}

export function reopenDailyClosing(
  db: Db,
  actor: ServiceActor,
  closingId: string,
  reason: string,
): DailyClosingDetail {
  requirePermission(actor, "cash.daily_reopen");
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 5) {
    throw errValidation("errors.treasury.reopenReasonRequired");
  }
  const original = loadSnapshot(db, closingId);
  if (original.status !== "closed") {
    throw errConflict("errors.treasury.cannotReopen");
  }
  const stamp = nowStamp();
  const newId = crypto.randomUUID();
  const fullName = actorFullName(actor);
  const openingFromPrevious = Number(original.counted_cash_minor ?? 0);
  db.transaction(() => {
    db.run(
      `INSERT INTO daily_closings (
        id, business_date, box, status, opening_balance_minor,
        expected_cash_minor, expected_card_minor, expected_transfer_minor, expected_other_minor, expected_total_minor,
        opened_by, opened_by_name, opened_at
      ) VALUES (?, ?, ?, 'open', ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
      [newId, String(original.business_date), String(original.box), openingFromPrevious, actor.userId, fullName, stamp],
    );
    db.run(
      `UPDATE daily_closings SET
        status = 'reopened',
        reopen_reason = ?,
        reopened_by = ?,
        reopened_by_name = ?,
        reopened_at = ?,
        reopen_count = reopen_count + 1,
        superseded_by = ?
       WHERE id = ? AND status = 'closed'`,
      [trimmed, actor.userId, fullName, stamp, newId, closingId],
    );
    recordAudit(db, actor, "DAILY_CLOSING_REOPENED", "daily_closing", newId, {
      previousClosingId: closingId,
      businessDate: String(original.business_date),
      box: String(original.box),
      reason: trimmed,
      reopenCount: Number(original.reopen_count ?? 0) + 1,
    });
  });
  return getDailyClosingById(db, actor, newId);
}

export function getDailyClosingById(
  db: Db,
  actor: ServiceActor,
  id: string,
): DailyClosingDetail {
  requirePermission(actor, "cash.daily_close");
  const row = loadSnapshot(db, id);
  const snapshot = mapRowToSnapshot(row);

  const breakdown = db.all<{ method_code: string; expected_minor: number; actual_minor: number | null }>(
    "SELECT method_code, expected_minor, actual_minor FROM daily_closing_audit_entries WHERE daily_closing_id = ? ORDER BY method_code",
    [id],
  );

  const { from, to } = dayRange(String(row.business_date));
  const payments = db.all<{ id: string; paid_at: string; member_code: string | null; member_name: string | null; method_code: string; method_label: string; amount_minor: number }>(
    `SELECT p.id, p.paid_at, m.member_code, m.full_name AS member_name, p.method_code, pm.label_ar AS method_label, p.paid_amount_minor
       FROM payments p
       LEFT JOIN members m ON m.id = p.member_id
       JOIN payment_methods pm ON pm.code = p.method_code
      WHERE p.paid_at >= ? AND p.paid_at <= ? AND p.status IN ('partial', 'paid', 'refunded')`,
    [from, to],
  );
  const expenses = db.all<{ id: string; expense_date: string; category_name: string; description: string; method_code: string; method_label: string; amount_minor: number }>(
    `SELECT e.id, e.expense_date, ec.name_ar AS category_name, e.description, e.method_code, pm.label_ar AS method_label, e.amount_minor
       FROM expenses e
       JOIN expense_categories ec ON ec.id = e.category_id
       JOIN payment_methods pm ON pm.code = e.method_code
      WHERE e.expense_date = ? AND e.status = 'active'`,
    [String(row.business_date)],
  );
  const refunds = db.all<{ id: string; paid_at: string; payment_id: string; method_code: string; method_label: string; amount_minor: number }>(
    `SELECT pr.id, pr.created_at AS paid_at, pr.payment_id, pr.method_code, pm.label_ar AS method_label, pr.amount_minor
       FROM payment_refunds pr
       JOIN payment_methods pm ON pm.code = pr.method_code
      WHERE pr.created_at >= ? AND pr.created_at <= ?`,
    [from, to],
  );

  return {
    ...snapshot,
    methodBreakdown: breakdown.map((b) => ({
      methodCode: String(b.method_code),
      expectedMinor: Number(b.expected_minor),
      actualMinor: b.actual_minor == null ? null : Number(b.actual_minor),
    })),
    payments: payments.map((p) => ({
      id: String(p.id),
      paidAt: String(p.paid_at),
      memberCode: p.member_code,
      memberName: p.member_name,
      methodCode: String(p.method_code),
      methodLabel: String(p.method_label),
      amountMinor: Number(p.amount_minor),
    })),
    expenses: expenses.map((e) => ({
      id: String(e.id),
      expenseDate: String(e.expense_date),
      categoryName: String(e.category_name),
      description: String(e.description),
      methodCode: String(e.method_code),
      methodLabel: String(e.method_label),
      amountMinor: Number(e.amount_minor),
    })),
    refunds: refunds.map((r) => ({
      id: String(r.id),
      paidAt: String(r.paid_at),
      paymentId: String(r.payment_id),
      methodCode: String(r.method_code),
      methodLabel: String(r.method_label),
      amountMinor: Number(r.amount_minor),
    })),
  };
}

export function listDailyClosings(
  db: Db,
  actor: ServiceActor,
  query: DailyClosingListQuery = {},
): { items: DailyClosingSnapshot[]; total: number } {
  requirePermission(actor, "cash.daily_close");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.currentOnly !== false) where.push("superseded_by IS NULL");
  if (query.fromKey) {
    where.push("business_date >= ?");
    params.push(query.fromKey);
  }
  if (query.toKey) {
    where.push("business_date <= ?");
    params.push(query.toKey);
  }
  if (query.box && query.box !== "all") {
    where.push("box = ?");
    params.push(query.box);
  }
  if (query.status && query.status !== "all") {
    where.push("status = ?");
    params.push(query.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM daily_closings ${whereSql}`, params);
  const rows = db.all<DailyClosingRow>(
    `SELECT * FROM daily_closings ${whereSql} ORDER BY business_date DESC, box ASC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapRowToSnapshot), total };
}

export function getTreasurySnapshot(
  db: Db,
  actor: ServiceActor,
  businessDate: string,
  box: CashBox,
): TreasurySnapshot {
  requirePermission(actor, "cash.daily_close");
  if (!isValidDateKey(businessDate)) {
    throw errValidation("errors.treasury.invalidBusinessDate");
  }
  if (!isValidBox(box)) {
    throw errValidation("errors.treasury.invalidBox");
  }
  const row = db.first<DailyClosingRow>(
    "SELECT * FROM daily_closings WHERE business_date = ? AND box = ? AND superseded_by IS NULL",
    [businessDate, box],
  );
  if (!row) {
    return {
      businessDate,
      box,
      status: "missing",
      expectedMinor: 0,
      expectedCashMinor: 0,
      countedCashMinor: null,
      differenceMinor: null,
      closingId: null,
    };
  }
  return {
    businessDate: String(row.business_date),
    box: row.box as CashBox,
    status: row.status as DailyClosingStatus,
    expectedMinor: Number(row.expected_total_minor),
    expectedCashMinor: Number(row.expected_cash_minor),
    countedCashMinor: row.counted_cash_minor == null ? null : Number(row.counted_cash_minor),
    differenceMinor: row.difference_minor == null ? null : Number(row.difference_minor),
    closingId: String(row.id),
  };
}

export function listTreasurySnapshotsForDate(
  db: Db,
  actor: ServiceActor,
  businessDate: string,
): { gym: TreasurySnapshot; store: TreasurySnapshot } {
  return {
    gym: getTreasurySnapshot(db, actor, businessDate, "gym"),
    store: getTreasurySnapshot(db, actor, businessDate, "store"),
  };
}
