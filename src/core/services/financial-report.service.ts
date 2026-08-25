import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";

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
}

function dayBounds(fromKey: string, toKey: string): { from: string; to: string } {
  return { from: `${fromKey} 00:00:00`, to: `${toKey} 23:59:59` };
}

export function getPeriodReport(
  db: Db,
  actor: ServiceActor,
  fromKey: string,
  toKey: string,
): PeriodReport {
  requirePermission(actor, "reports.view");
  const { from, to } = dayBounds(fromKey, toKey);

  const totals = db.first<{ revenue: number; pay_count: number }>(
    `SELECT COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS pay_count
     FROM payments p
     WHERE p.status IN ('partial', 'paid') AND p.paid_at BETWEEN ? AND ?
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
     WHERE p.status IN ('partial', 'paid') AND p.paid_at BETWEEN ? AND ?
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     GROUP BY p.method_code ORDER BY revenue DESC`,
    [from, to],
  );

  const byPlanRows = db.all<{ plan_id: string; plan_name: string | null; revenue: number; cnt: number }>(
    `SELECT s.plan_id, pl.name AS plan_name, COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM payments p
     JOIN member_subscriptions s ON s.id = p.subscription_id
     JOIN membership_plans pl ON pl.id = s.plan_id
     WHERE p.status IN ('partial', 'paid') AND p.paid_at BETWEEN ? AND ?
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
     WHERE status IN ('partial', 'paid') AND paid_at BETWEEN ? AND ?
     AND (subscription_id IS NULL OR subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
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
  const expensesByDay = new Map(dailyExpenses.map((r) => [r.day, Number(r.total)]));
  const daily: PeriodReport["daily"] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    daily.push({
      dateKey: cursor,
      revenueMinor: revenueByDay.get(cursor) ?? 0,
      expensesMinor: expensesByDay.get(cursor) ?? 0,
    });
    const d = new Date(`${cursor}T00:00:00`);
    d.setDate(d.getDate() + 1);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }

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
  };
}
