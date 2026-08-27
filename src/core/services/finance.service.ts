import { nowStamp } from "@/core/dates";
import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import { assertDepartmentAccess, memberDepartmentById } from "./department";

/** Outstanding balances for one member across gym subscriptions + store debts. */
export interface MemberOutstanding {
  subscriptionsMinor: number;
  storeMinor: number;
  totalMinor: number;
}

export function getMemberOutstanding(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): MemberOutstanding {
  requirePermission(actor, "members.view");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));

  const subs = Number(
    db.scalar(
      `WITH paid AS (
        SELECT subscription_id, SUM(paid_amount_minor) AS p, SUM(discount_amount_minor) AS d
        FROM payments
        WHERE status IN ('partial', 'paid')
        GROUP BY subscription_id
      )
      SELECT COALESCE(SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(paid.p, 0) - COALESCE(paid.d, 0), 0)), 0)
      FROM member_subscriptions s
      LEFT JOIN paid ON paid.subscription_id = s.id
      WHERE s.member_id = ? AND s.status = 'active'`,
      [memberId],
    ) ?? 0,
  );

  const store = Number(
    db.scalar(
      "SELECT COALESCE(SUM(original_minor - paid_minor), 0) FROM store_debts WHERE member_id = ? AND status = 'open'",
      [memberId],
    ) ?? 0,
  );

  return { subscriptionsMinor: subs, storeMinor: store, totalMinor: subs + store };
}

export interface MethodBreakdownRow {
  methodCode: string;
  methodLabel: string;
  inflowMinor: number;
  outflowMinor: number;
}

export interface FinanceOverview {
  todayInMinor: number;
  todayOutMinor: number;
  todayRefundsMinor: number;
  todayNetMinor: number;
  todayPaymentsCount: number;
  monthInMinor: number;
  monthOutMinor: number;
  monthRefundsMinor: number;
  monthNetMinor: number;
  monthPaymentsCount: number;
  byMethodToday: MethodBreakdownRow[];
}

function rangeCondition(fromStamp: string, toStamp: string): { where: string; params: string[] } {
  return {
    where: "occurred_at > ? AND occurred_at <= ?",
    params: [fromStamp, toStamp],
  };
}

function dayStartStamp(dateKey: string): string {
  return `${dateKey} 00:00:00`;
}

function sumBetween(
  db: Db,
  fromStamp: string,
  toStamp: string,
): { inMinor: number; outMinor: number; refunds: number; payments: number } {
  const row = db.first<{ inflow: number; outflow: number; refunds: number; pay_count: number }>(
    `SELECT
      COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_type NOT IN ('refund', 'reversal_payment') THEN l.amount_minor ELSE 0 END), 0) AS inflow,
      COALESCE(SUM(CASE WHEN l.direction = -1 AND l.entry_type NOT IN ('refund', 'reversal_expense') THEN l.amount_minor ELSE 0 END), 0) AS outflow,
      COALESCE(SUM(CASE WHEN l.entry_type = 'refund' THEN l.amount_minor ELSE 0 END), 0) AS refunds,
      COALESCE(SUM(CASE WHEN l.entry_type = 'payment' THEN 1 ELSE 0 END), 0) AS pay_count
    FROM financial_ledger l
    LEFT JOIN payments _lp ON l.ref_table = 'payments' AND l.ref_id = _lp.id
    LEFT JOIN member_subscriptions _ls ON _lp.subscription_id = _ls.id AND _ls.status = 'cancelled'
    LEFT JOIN payment_refunds _lr ON l.ref_table = 'payment_refunds' AND l.ref_id = _lr.id
    LEFT JOIN payments _lpr ON _lr.payment_id = _lpr.id
    LEFT JOIN member_subscriptions _lsr ON _lpr.subscription_id = _lsr.id AND _lsr.status = 'cancelled'
    WHERE ${rangeCondition(fromStamp, toStamp).where} AND _ls.id IS NULL AND _lsr.id IS NULL`,
    [fromStamp, toStamp],
  );
  return {
    inMinor: Number(row?.inflow ?? 0),
    outMinor: Number(row?.outflow ?? 0),
    refunds: Number(row?.refunds ?? 0),
    payments: Number(row?.pay_count ?? 0),
  };
}

function methodBreakdown(db: Db, fromStamp: string, toStamp: string): MethodBreakdownRow[] {
  const rows = db.all<{
    method_code: string;
    label_ar: string | null;
    inflow: number;
    outflow: number;
  }>(
    `SELECT l.method_code, pm.label_ar AS label_ar,
      COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_type NOT IN ('refund', 'reversal_payment') THEN l.amount_minor ELSE 0 END), 0) AS inflow,
      COALESCE(SUM(CASE WHEN l.direction = -1 AND l.entry_type NOT IN ('refund', 'reversal_expense') THEN l.amount_minor ELSE 0 END), 0) AS outflow
    FROM financial_ledger l
    LEFT JOIN payment_methods pm ON pm.code = l.method_code
    LEFT JOIN payments _lp ON l.ref_table = 'payments' AND l.ref_id = _lp.id
    LEFT JOIN member_subscriptions _ls ON _lp.subscription_id = _ls.id AND _ls.status = 'cancelled'
    LEFT JOIN payment_refunds _lr ON l.ref_table = 'payment_refunds' AND l.ref_id = _lr.id
    LEFT JOIN payments _lpr ON _lr.payment_id = _lpr.id
    LEFT JOIN member_subscriptions _lsr ON _lpr.subscription_id = _lsr.id AND _lsr.status = 'cancelled'
    WHERE ${rangeCondition(fromStamp, toStamp).where} AND _ls.id IS NULL AND _lsr.id IS NULL
    GROUP BY l.method_code
    ORDER BY inflow DESC, outflow DESC`,
    [fromStamp, toStamp],
  );
  return rows.map((r) => ({
    methodCode: r.method_code,
    methodLabel: r.label_ar ?? r.method_code,
    inflowMinor: Number(r.inflow),
    outflowMinor: Number(r.outflow),
  }));
}

export function getFinanceOverview(
  db: Db,
  actor: ServiceActor,
  todayKeyStr: string,
  monthStartKey: string,
): FinanceOverview {
  requirePermission(actor, "payments.view");
  const endStamp = nowStamp();
  const today = sumBetween(db, dayStartStamp(todayKeyStr), endStamp);
  const month = sumBetween(db, dayStartStamp(monthStartKey), endStamp);
  return {
    todayInMinor: today.inMinor,
    todayOutMinor: today.outMinor,
    todayRefundsMinor: today.refunds,
    todayNetMinor: today.inMinor - today.refunds - today.outMinor,
    todayPaymentsCount: today.payments,
    monthInMinor: month.inMinor,
    monthOutMinor: month.outMinor,
    monthRefundsMinor: month.refunds,
    monthNetMinor: month.inMinor - month.refunds - month.outMinor,
    monthPaymentsCount: month.payments,
    byMethodToday: methodBreakdown(db, dayStartStamp(todayKeyStr), endStamp),
  };
}

export interface LedgerEntry {
  id: number;
  entryType: string;
  refTable: string;
  refId: string;
  memberId: string | null;
  methodCode: string;
  direction: 1 | -1;
  amountMinor: number;
  occurredAt: string;
}

export function listLedgerEntries(
  db: Db,
  actor: ServiceActor,
  query: { page?: number; pageSize?: number; fromKey?: string; toKey?: string },
): { items: LedgerEntry[]; total: number } {
  requirePermission(actor, "reports.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const conditions: string[] = [];
  const params: string[] = [];
  if (query.fromKey) {
    conditions.push("occurred_at >= ?");
    params.push(dayStartStamp(query.fromKey));
  }
  if (query.toKey) {
    conditions.push("occurred_at < ?");
    params.push(nextDayStart(query.toKey));
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM financial_ledger ${where}`, params);
  const rows = db.all<{
    id: number;
    entry_type: string;
    ref_table: string;
    ref_id: string;
    member_id: string | null;
    method_code: string;
    direction: number;
    amount_minor: number;
    occurred_at: string;
    box: string;
  }>(
    `SELECT * FROM financial_ledger ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      entryType: r.entry_type,
      refTable: r.ref_table,
      refId: r.ref_id,
      memberId: r.member_id,
      methodCode: r.method_code,
      direction: Number(r.direction) === -1 ? -1 : 1,
      amountMinor: Number(r.amount_minor),
      box: r.box === "store" ? "store" : "gym",
      occurredAt: r.occurred_at,
    })),
    total,
  };
}

function nextDayStart(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw errValidation("errors.invalidDate");
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")} 00:00:00`;
}
