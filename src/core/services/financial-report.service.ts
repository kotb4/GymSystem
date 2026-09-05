import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";

export interface ReportDetailedPage<T> {
  items: T[];
  total: number;
}

export interface PeriodReportQuery {
  paymentsPage?: number;
  expensesPage?: number;
  refundsPage?: number;
  voidsPage?: number;
  pageSize?: number;
}

function clampPage(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 10_000);
}

function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.floor(value), 10), 200);
}

export interface PeriodReport {
  revenueMinor: number;
  refundsMinor: number;
  expensesMinor: number;
  netResultMinor: number;
  paymentCount: number;
  avgTicketMinor: number;
  byMethod: Array<{ code: string; label: string; revenueMinor: number; count: number }>;
  byPlan: Array<{ planId: string; planName: string; revenueMinor: number; count: number }>;
  expensesByCategory: Array<{ categoryId: string; nameAr: string; amountMinor: number; count: number }>;
  daily: Array<{ dateKey: string; revenueMinor: number; expensesMinor: number }>;
  detailedPayments: ReportDetailedPage<{
    id: string; paidAt: string; memberName: string; memberCode: string;
    planName: string; netMinor: number; paidMinor: number; remainingMinor: number;
    methodLabel: string; status: string; voidReason: string | null; refundReason: string | null;
  }>;
  detailedExpenses: ReportDetailedPage<{
    id: string; date: string; categoryName: string; amountMinor: number;
    description: string; methodLabel: string; voidReason: string | null;
  }>;
  detailedRefunds: ReportDetailedPage<{
    id: string; createdAt: string; memberName: string; amountMinor: number;
    reason: string; methodLabel: string; paymentId: string;
  }>;
  detailedVoids: ReportDetailedPage<{
    id: string; voidedAt: string; memberName: string; amountMinor: number;
    voidReason: string; methodLabel: string;
  }>;
}

function dayBounds(fromKey: string, toKey: string): { from: string; to: string } {
  return { from: `${fromKey} 00:00:00`, to: `${toKey} 23:59:59` };
}

export function getPeriodReport(
  db: Db,
  actor: ServiceActor,
  fromKey: string,
  toKey: string,
  query?: PeriodReportQuery,
): PeriodReport {
  requirePermission(actor, "reports.view");
  const { from, to } = dayBounds(fromKey, toKey);
  const pageSize = clampPageSize(query?.pageSize);
  const pageOf = (value: number | undefined): number => clampPage(value ?? 1);
  const offsetOf = (page: number): number => (page - 1) * pageSize;
  const paymentsPage = pageOf(query?.paymentsPage);
  const expensesPage = pageOf(query?.expensesPage);
  const refundsPage = pageOf(query?.refundsPage);
  const voidsPage = pageOf(query?.voidsPage);

  const totals = db.first<{ revenue: number; pay_count: number }>(
    `SELECT COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS pay_count
     FROM payments p
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))`,
    [from, to],
  );
  const refunds = db.first<{ total: number }>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payment_refunds WHERE created_at BETWEEN ? AND ?`,
    [from, to],
  );
  const expenses = db.first<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN e.status = 'active' THEN e.amount_minor ELSE 0 END), 0) AS total
     FROM expenses e WHERE e.expense_date BETWEEN ? AND ?`,
    [fromKey, toKey],
  );

  const revenueMinor = Number(totals?.revenue ?? 0);
  const paymentCount = Number(totals?.pay_count ?? 0);
  const refundsMinor = Number(refunds?.total ?? 0);
  const expensesMinor = Number(expenses?.total ?? 0);

  const byMethodRows = db.all<{
    method_code: string;
    label_ar: string;
    revenue: number;
    cnt: number;
  }>(
    `SELECT p.method_code, pm.label_ar AS label_ar, COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM payments p JOIN payment_methods pm ON pm.code = p.method_code
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     GROUP BY p.method_code ORDER BY revenue DESC`,
    [from, to],
  );

  const byPlanRows = db.all<{ plan_id: string; plan_name: string | null; revenue: number; cnt: number }>(
    `SELECT s.plan_id, pl.name AS plan_name, COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM payments p
     JOIN member_subscriptions s ON s.id = p.subscription_id
     JOIN membership_plans pl ON pl.id = s.plan_id
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?
     AND s.status != 'cancelled'
     GROUP BY s.plan_id ORDER BY revenue DESC`,
    [from, to],
  );

  const expenseCategoryRows = db.all<{
    category_id: string;
    name_ar: string;
    total: number;
    cnt: number;
  }>(
    `SELECT e.category_id, c.name_ar AS name_ar, COALESCE(SUM(e.amount_minor), 0) AS total, COUNT(*) AS cnt
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.status = 'active' AND e.expense_date BETWEEN ? AND ?
     GROUP BY e.category_id ORDER BY total DESC`,
    [fromKey, toKey],
  );

  const dailyRevenue = db.all<{ day: string; total: number }>(
    `SELECT substr(paid_at, 1, 10) AS day, COALESCE(SUM(paid_amount_minor), 0) AS total
     FROM payments
     WHERE status IN ('partial', 'paid', 'refunded') AND paid_at BETWEEN ? AND ?
     AND (subscription_id IS NULL OR subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     GROUP BY day`,
    [from, to],
  );
  const dailyRefunds = db.all<{ day: string; total: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(amount_minor), 0) AS total
     FROM payment_refunds WHERE created_at BETWEEN ? AND ?
     GROUP BY day`,
    [from, to],
  );
  const dailyExpenses = db.all<{ day: string; total: number }>(
    `SELECT expense_date AS day, COALESCE(SUM(amount_minor), 0) AS total
     FROM expenses
     WHERE status = 'active' AND expense_date BETWEEN ? AND ?
     GROUP BY day`,
    [fromKey, toKey],
  );

  const revenueByDay = new Map(dailyRevenue.map((r) => [r.day, Number(r.total)]));
  const refundsByDay = new Map(dailyRefunds.map((r) => [r.day, Number(r.total)]));
  const expensesByDay = new Map(dailyExpenses.map((r) => [r.day, Number(r.total)]));
  const daily: PeriodReport["daily"] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    daily.push({
      dateKey: cursor,
      revenueMinor: (revenueByDay.get(cursor) ?? 0) - (refundsByDay.get(cursor) ?? 0),
      expensesMinor: expensesByDay.get(cursor) ?? 0,
    });
    const d = new Date(`${cursor}T00:00:00`);
    d.setDate(d.getDate() + 1);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }

  const detailedPayments = db.all<{
    id: string; paid_at: string; full_name: string; member_code: string;
    plan_name: string | null; net_amount_minor: number; paid_amount_minor: number;
    remaining_amount_minor: number; method_label: string; status: string;
    void_reason: string | null; refund_reason: string | null;
  }>(
    `SELECT p.id, p.paid_at, m.full_name, m.member_code, pl.name AS plan_name,
      p.net_amount_minor, p.paid_amount_minor, p.remaining_amount_minor,
      pm.label_ar AS method_label, p.status, p.void_reason,
      (SELECT pr.reason FROM payment_refunds pr WHERE pr.payment_id = p.id ORDER BY pr.created_at DESC LIMIT 1) AS refund_reason
     FROM payments p
     JOIN members m ON m.id = p.member_id
     JOIN payment_methods pm ON pm.code = p.method_code
     LEFT JOIN member_subscriptions s ON s.id = p.subscription_id
     LEFT JOIN membership_plans pl ON pl.id = s.plan_id
     WHERE p.status IN ('partial', 'paid', 'refunded', 'voided') AND p.paid_at BETWEEN ? AND ?
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     ORDER BY p.paid_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, pageSize, offsetOf(paymentsPage)],
  );
  const detailedPaymentsTotal = Number(
    db.scalar(
      `SELECT COUNT(*) FROM payments p
       WHERE p.status IN ('partial', 'paid', 'refunded', 'voided') AND p.paid_at BETWEEN ? AND ?
       AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))`,
      [from, to],
    ) ?? 0,
  );

  const detailedExpenses = db.all<{
    id: string; expense_date: string; name_ar: string; amount_minor: number;
    description: string; method_label: string; void_reason: string | null;
  }>(
    `SELECT e.id, e.expense_date, c.name_ar, e.amount_minor, e.description,
      pm.label_ar AS method_label, e.void_reason
     FROM expenses e
     JOIN expense_categories c ON c.id = e.category_id
     JOIN payment_methods pm ON pm.code = e.method_code
     WHERE e.expense_date BETWEEN ? AND ?
     ORDER BY e.expense_date DESC
     LIMIT ? OFFSET ?`,
    [fromKey, toKey, pageSize, offsetOf(expensesPage)],
  );
  const detailedExpensesTotal = Number(
    db.scalar("SELECT COUNT(*) FROM expenses WHERE expense_date BETWEEN ? AND ?", [fromKey, toKey]) ?? 0,
  );

  const detailedRefunds = db.all<{
    id: string; created_at: string; full_name: string; amount_minor: number;
    reason: string; method_label: string; payment_id: string;
  }>(
    `SELECT pr.id, pr.created_at, m.full_name, pr.amount_minor, pr.reason,
      pm.label_ar AS method_label, pr.payment_id
     FROM payment_refunds pr
     JOIN payments p ON p.id = pr.payment_id
     JOIN members m ON m.id = p.member_id
     JOIN payment_methods pm ON pm.code = p.method_code
     WHERE pr.created_at BETWEEN ? AND ?
     ORDER BY pr.created_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, pageSize, offsetOf(refundsPage)],
  );
  const detailedRefundsTotal = Number(
    db.scalar("SELECT COUNT(*) FROM payment_refunds WHERE created_at BETWEEN ? AND ?", [from, to]) ?? 0,
  );

  const detailedVoids = db.all<{
    id: string; voided_at: string; full_name: string; paid_amount_minor: number;
    void_reason: string; method_label: string;
  }>(
    `SELECT p.id, p.voided_at, m.full_name, p.paid_amount_minor, p.void_reason,
      pm.label_ar AS method_label
     FROM payments p
     JOIN members m ON m.id = p.member_id
     JOIN payment_methods pm ON pm.code = p.method_code
     WHERE p.status = 'voided' AND p.voided_at BETWEEN ? AND ?
     ORDER BY p.voided_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, pageSize, offsetOf(voidsPage)],
  );
  const detailedVoidsTotal = Number(
    db.scalar("SELECT COUNT(*) FROM payments WHERE status = 'voided' AND voided_at BETWEEN ? AND ?", [from, to]) ?? 0,
  );

  return {
    revenueMinor,
    refundsMinor,
    expensesMinor,
    netResultMinor: revenueMinor - refundsMinor - expensesMinor,
    paymentCount,
    avgTicketMinor: paymentCount > 0 ? Math.round(revenueMinor / paymentCount) : 0,
    byMethod: byMethodRows.map((r) => ({
      code: r.method_code,
      label: r.label_ar,
      revenueMinor: Number(r.revenue),
      count: Number(r.cnt),
    })),
    byPlan: byPlanRows.map((r) => ({
      planId: r.plan_id,
      planName: r.plan_name ?? "—",
      revenueMinor: Number(r.revenue),
      count: Number(r.cnt),
    })),
    expensesByCategory: expenseCategoryRows.map((r) => ({
      categoryId: r.category_id,
      nameAr: r.name_ar,
      amountMinor: Number(r.total),
      count: Number(r.cnt),
    })),
    daily,
    detailedPayments: {
      items: detailedPayments.map((r) => ({
        id: r.id,
        paidAt: r.paid_at,
        memberName: r.full_name,
        memberCode: r.member_code,
        planName: r.plan_name ?? "دفعة عامة",
        netMinor: Number(r.net_amount_minor),
        paidMinor: Number(r.paid_amount_minor),
        remainingMinor: Number(r.remaining_amount_minor),
        methodLabel: r.method_label,
        status: r.status,
        voidReason: r.void_reason,
        refundReason: r.refund_reason,
      })),
      total: detailedPaymentsTotal,
    },
    detailedExpenses: {
      items: detailedExpenses.map((r) => ({
        id: r.id,
        date: r.expense_date,
        categoryName: r.name_ar,
        amountMinor: Number(r.amount_minor),
        description: r.description,
        methodLabel: r.method_label,
        voidReason: r.void_reason,
      })),
      total: detailedExpensesTotal,
    },
    detailedRefunds: {
      items: detailedRefunds.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        memberName: r.full_name,
        amountMinor: Number(r.amount_minor),
        reason: r.reason,
        methodLabel: r.method_label,
        paymentId: r.payment_id,
      })),
      total: detailedRefundsTotal,
    },
    detailedVoids: {
      items: detailedVoids.map((r) => ({
        id: r.id,
        voidedAt: r.voided_at,
        memberName: r.full_name,
        amountMinor: Number(r.paid_amount_minor),
        voidReason: r.void_reason,
        methodLabel: r.method_label,
      })),
      total: detailedVoidsTotal,
    },
  };
}
