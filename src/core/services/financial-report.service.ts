import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import { listRegisteredBranches } from "./sync.service";

export interface ReportDetailedPage<T> {
  items: T[];
  total: number;
}

export interface BranchFinancialSummary {
  branchId: string;
  branchName: string;
  revenueMinor: number;
  refundsMinor: number;
  expensesMinor: number;
  netResultMinor: number;
  paymentCount: number;
}

export interface RevenueStreamSummary {
  key: "subscriptions" | "store" | "store_debts" | "quick_sessions" | "private_training";
  labelAr: string;
  revenueMinor: number;
  paymentCount: number;
  percentage: number;
}

export interface IncomeStatement {
  // 1. Operating Revenue
  subscriptionsRevenueMinor: number;
  storeSalesRevenueMinor: number;
  storeDebtRepaymentsMinor: number;
  quickSessionsRevenueMinor: number;
  privateTrainingRevenueMinor: number;
  totalRevenueMinor: number;

  // 2. Cost of Sales & Refunds
  cogsMinor: number;
  refundsMinor: number;
  returnsMinor: number;

  // 3. Gross Operating Profit
  grossProfitMinor: number;
  grossMarginPercent: number;

  // 4. Operating Expenses
  salariesExpensesMinor: number;
  rentUtilitiesExpensesMinor: number;
  maintenanceExpensesMinor: number;
  suppliesExpensesMinor: number;
  marketingExpensesMinor: number;
  otherExpensesMinor: number;
  totalExpensesMinor: number;

  // 5. Net Operating Profit
  netProfitMinor: number;
  netMarginPercent: number;
}

export interface ReceivablesSummary {
  totalReceivablesMinor: number;
  subscriptionsDebtMinor: number;
  storeDebtMinor: number;
  privateTrainingDebtMinor: number;
  aging: {
    under30DaysMinor: number;
    from30To60DaysMinor: number;
    over60DaysMinor: number;
  };
  topDebtors: Array<{
    memberId: string;
    memberName: string;
    memberCode: string;
    phone: string | null;
    subscriptionsDebtMinor: number;
    storeDebtMinor: number;
    ptDebtMinor: number;
    totalDebtMinor: number;
  }>;
}

export interface LiquiditySummary {
  gymCashMinor: number;
  storeCashMinor: number;
  walletsMinor: number;
  bankMinor: number;
  ownerWithdrawalsMinor: number;
  netLiquidityMinor: number;
}

export interface PeriodReportQuery {
  paymentsPage?: number;
  expensesPage?: number;
  refundsPage?: number;
  voidsPage?: number;
  pageSize?: number;
  branchId?: string;
  userId?: string;
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
  subscriptionsRevenueMinor: number;
  storeRevenueMinor: number;
  storeDebtRepaymentsMinor: number;
  quickSessionsRevenueMinor: number;
  privateTrainingsRevenueMinor: number;
  cogsMinor: number;
  refundsMinor: number;
  expensesMinor: number;
  netResultMinor: number;
  paymentCount: number;
  avgTicketMinor: number;
  streamsSummary: RevenueStreamSummary[];
  incomeStatement: IncomeStatement;
  receivables: ReceivablesSummary;
  liquidity: LiquiditySummary;
  byMethod: Array<{ code: string; label: string; revenueMinor: number; count: number }>;
  byPlan: Array<{ planId: string; planName: string; revenueMinor: number; count: number }>;
  expensesByCategory: Array<{ categoryId: string; nameAr: string; amountMinor: number; count: number }>;
  daily: Array<{ dateKey: string; revenueMinor: number; expensesMinor: number }>;
  byBranch: BranchFinancialSummary[];
  detailedPayments: ReportDetailedPage<{
    id: string; paidAt: string; memberName: string; memberCode: string;
    planName: string; netMinor: number; paidMinor: number; remainingMinor: number;
    methodLabel: string; status: string; voidReason: string | null; refundReason: string | null;
    createdByName: string; branchId: string; referenceNo: string | null; receiptNo: string | null;
  }>;
  detailedExpenses: ReportDetailedPage<{
    id: string; date: string; categoryName: string; amountMinor: number;
    description: string; methodLabel: string; voidReason: string | null;
    createdByName: string; branchId: string;
  }>;
  detailedRefunds: ReportDetailedPage<{
    id: string; createdAt: string; memberName: string; amountMinor: number;
    reason: string; methodLabel: string; paymentId: string;
    createdByName: string; branchId: string; refundNo: string | null;
  }>;
  detailedVoids: ReportDetailedPage<{
    id: string; voidedAt: string; memberName: string; amountMinor: number;
    voidReason: string; methodLabel: string;
    voidedByName: string; branchId: string;
  }>;
  cashSummary: PeriodCashSummary;
  detailedCashSessions: DetailedCashSessionItem[];
}

export interface PeriodCashSummary {
  totalShortageMinor: number;
  totalSurplusMinor: number;
  totalOwnerWithdrawalsMinor: number;
  closedSessionsCount: number;
}

export interface DetailedCashSessionItem {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string | null;
  openingBalanceMinor: number;
  expectedClosingMinor: number | null;
  countedClosingMinor: number | null;
  differenceMinor: number | null;
  closeNote: string | null;
  status: string;
  box: string;
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

  const targetBranch = query?.branchId && query.branchId !== "all" ? query.branchId : undefined;
  const payBranchClause = targetBranch ? " AND COALESCE(p.branch_id, 'main') = ?" : "";
  const expBranchClause = targetBranch ? " AND COALESCE(e.branch_id, 'main') = ?" : "";
  const storeBranchClause = targetBranch ? " AND COALESCE(s.branch_id, 'main') = ?" : "";
  const payBranchParams = targetBranch ? [targetBranch] : [];
  const expBranchParams = targetBranch ? [targetBranch] : [];
  const storeBranchParams = targetBranch ? [targetBranch] : [];

  const targetUser = query?.userId && query.userId !== "all" ? query.userId : undefined;
  const payUserClause = targetUser ? " AND p.created_by = ?" : "";
  const expUserClause = targetUser ? " AND e.created_by = ?" : "";
  const refUserClause = targetUser ? " AND pr.created_by = ?" : "";
  const srUserClause = targetUser ? " AND sr.created_by = ?" : "";
  const voidUserClause = targetUser ? " AND p.voided_by = ?" : "";
  const storeUserClause = targetUser ? " AND s.seller_id = ?" : "";
  const sdpUserClause = targetUser ? " AND sdp.created_by = ?" : "";
  const qsUserClause = targetUser ? " AND qs.created_by = ?" : "";
  const ptUserClause = targetUser ? " AND pt.created_by = ?" : "";

  const payUserParams = targetUser ? [targetUser] : [];
  const expUserParams = targetUser ? [targetUser] : [];
  const refUserParams = targetUser ? [targetUser] : [];
  const srUserParams = targetUser ? [targetUser] : [];
  const voidUserParams = targetUser ? [targetUser] : [];
  const storeUserParams = targetUser ? [targetUser] : [];
  const sdpUserParams = targetUser ? [targetUser] : [];
  const qsUserParams = targetUser ? [targetUser] : [];
  const ptUserParams = targetUser ? [targetUser] : [];

  // 1. Subscriptions & Direct Payments
  const subTotals = db.first<{ revenue: number; pay_count: number }>(
    `SELECT COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS pay_count
     FROM payments p
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?${payBranchClause}${payUserClause}
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))`,
    [from, to, ...payBranchParams, ...payUserParams],
  );
  const subscriptionsRevenueMinor = Number(subTotals?.revenue ?? 0);
  const subscriptionsPayCount = Number(subTotals?.pay_count ?? 0);

  // 2. Store Sales (Non-credit completed sales)
  const storeTotals = db.first<{ revenue: number; cost: number; sales_count: number }>(
    `SELECT COALESCE(SUM(s.total_minor), 0) AS revenue,
            COALESCE(SUM(s.cost_total_minor), 0) AS cost,
            COUNT(*) AS sales_count
     FROM store_sales s
     WHERE s.status = 'completed' AND s.is_credit = 0
     AND s.sold_at BETWEEN ? AND ?${storeBranchClause}${storeUserClause}`,
    [from, to, ...storeBranchParams, ...storeUserParams],
  );
  const storeRevenueMinor = Number(storeTotals?.revenue ?? 0);
  const cogsMinor = Number(storeTotals?.cost ?? 0);
  const storeSalesCount = Number(storeTotals?.sales_count ?? 0);

  // Store Returns
  const storeReturnsRow = db.first<{ total: number; cnt: number }>(
    `SELECT COALESCE(SUM(sr.amount_minor), 0) AS total, COUNT(*) AS cnt
     FROM store_returns sr
     JOIN store_sales s ON s.id = sr.sale_id
     WHERE sr.created_at BETWEEN ? AND ?${storeBranchClause}${srUserClause}`,
    [from, to, ...storeBranchParams, ...srUserParams],
  );
  const storeReturnsMinor = Number(storeReturnsRow?.total ?? 0);

  // 3. Store Debt Repayments
  const storeDebtTotals = db.first<{ revenue: number; pay_count: number }>(
    `SELECT COALESCE(SUM(sdp.amount_minor), 0) AS revenue, COUNT(*) AS pay_count
     FROM store_debt_payments sdp
     JOIN store_debts d ON d.id = sdp.debt_id
     JOIN store_sales s ON s.id = d.sale_id
     WHERE sdp.created_at BETWEEN ? AND ?${storeBranchClause}${sdpUserClause}`,
    [from, to, ...storeBranchParams, ...sdpUserParams],
  );
  const storeDebtRepaymentsMinor = Number(storeDebtTotals?.revenue ?? 0);
  const storeDebtRepaymentsCount = Number(storeDebtTotals?.pay_count ?? 0);

  // 4. Quick Sessions (Day passes / walk-ins)
  const quickSessionsTotals = db.first<{ revenue: number; pay_count: number }>(
    `SELECT COALESCE(SUM(qs.paid_amount_minor), 0) AS revenue, COUNT(*) AS pay_count
     FROM quick_sessions qs
     WHERE qs.session_date BETWEEN ? AND ?${qsUserClause}`,
    [fromKey, toKey, ...qsUserParams],
  );
  const quickSessionsRevenueMinor = Number(quickSessionsTotals?.revenue ?? 0);
  const quickSessionsCount = Number(quickSessionsTotals?.pay_count ?? 0);

  // 5. Private Training Packages (PT)
  const ptTotals = db.first<{ revenue: number; pay_count: number }>(
    `SELECT COALESCE(SUM(pt.paid_amount_minor), 0) AS revenue, COUNT(*) AS pay_count
     FROM private_trainings pt
     WHERE pt.status != 'cancelled' AND pt.paid_amount_minor > 0
     AND pt.created_at BETWEEN ? AND ?${ptUserClause}`,
    [from, to, ...ptUserParams],
  );
  const privateTrainingsRevenueMinor = Number(ptTotals?.revenue ?? 0);
  const privateTrainingsCount = Number(ptTotals?.pay_count ?? 0);

  // Total Consolidated Gross Revenue & Count
  const totalGrossRevenueMinor =
    subscriptionsRevenueMinor +
    storeRevenueMinor +
    storeDebtRepaymentsMinor +
    quickSessionsRevenueMinor +
    privateTrainingsRevenueMinor;

  const paymentCount =
    subscriptionsPayCount +
    storeSalesCount +
    storeDebtRepaymentsCount +
    quickSessionsCount +
    privateTrainingsCount;

  const revenueMinor = totalGrossRevenueMinor;

  // Refunds & Expenses
  const refunds = db.first<{ total: number }>(
    `SELECT COALESCE(SUM(pr.amount_minor), 0) AS total
     FROM payment_refunds pr
     JOIN payments p ON p.id = pr.payment_id
     WHERE pr.created_at BETWEEN ? AND ?${payBranchClause}${refUserClause}`,
    [from, to, ...payBranchParams, ...refUserParams],
  );
  const refundsMinor = Number(refunds?.total ?? 0);

  const expenses = db.first<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN e.status = 'active' THEN e.amount_minor ELSE 0 END), 0) AS total
     FROM expenses e WHERE e.expense_date BETWEEN ? AND ?${expBranchClause}${expUserClause}`,
    [fromKey, toKey, ...expBranchParams, ...expUserParams],
  );
  const expensesMinor = Number(expenses?.total ?? 0);

  // Revenue Streams Summary
  const streamsSummary: RevenueStreamSummary[] = [
    {
      key: "subscriptions",
      labelAr: "اشتراكات وتجديدات الجيم",
      revenueMinor: subscriptionsRevenueMinor,
      paymentCount: subscriptionsPayCount,
      percentage: revenueMinor > 0 ? Math.round((subscriptionsRevenueMinor / revenueMinor) * 100) : 0,
    },
    {
      key: "store",
      labelAr: "مبيعات المتجر والكافيتيريا",
      revenueMinor: storeRevenueMinor,
      paymentCount: storeSalesCount,
      percentage: revenueMinor > 0 ? Math.round((storeRevenueMinor / revenueMinor) * 100) : 0,
    },
    {
      key: "store_debts",
      labelAr: "سداد مديونيات المتجر",
      revenueMinor: storeDebtRepaymentsMinor,
      paymentCount: storeDebtRepaymentsCount,
      percentage: revenueMinor > 0 ? Math.round((storeDebtRepaymentsMinor / revenueMinor) * 100) : 0,
    },
    {
      key: "quick_sessions",
      labelAr: "تذاكر الدخول اليومي والحصص السريعة",
      revenueMinor: quickSessionsRevenueMinor,
      paymentCount: quickSessionsCount,
      percentage: revenueMinor > 0 ? Math.round((quickSessionsRevenueMinor / revenueMinor) * 100) : 0,
    },
    {
      key: "private_training",
      labelAr: "باقات التدريب الخاص (PT)",
      revenueMinor: privateTrainingsRevenueMinor,
      paymentCount: privateTrainingsCount,
      percentage: revenueMinor > 0 ? Math.round((privateTrainingsRevenueMinor / revenueMinor) * 100) : 0,
    },
  ];

  // Consolidated Payment Methods breakdown
  const methodTotals = new Map<string, { label: string; revenueMinor: number; count: number }>();
  function addMethod(code: string, label: string | null | undefined, rev: number, cnt: number) {
    if (!code) return;
    const curr = methodTotals.get(code) || { label: label || code, revenueMinor: 0, count: 0 };
    curr.revenueMinor += rev;
    curr.count += cnt;
    if (label) curr.label = label;
    methodTotals.set(code, curr);
  }

  // Payments methods
  const payMethodRows = db.all<{ method_code: string; label_ar: string; revenue: number; cnt: number }>(
    `SELECT p.method_code, pm.label_ar AS label_ar, COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM payments p JOIN payment_methods pm ON pm.code = p.method_code
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?${payBranchClause}${payUserClause}
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     GROUP BY p.method_code`,
    [from, to, ...payBranchParams, ...payUserParams],
  );
  for (const r of payMethodRows) addMethod(r.method_code, r.label_ar, Number(r.revenue), Number(r.cnt));

  // Store Sales methods
  const storeMethodRows = db.all<{ method_code: string; label_ar: string; revenue: number; cnt: number }>(
    `SELECT s.method_code, pm.label_ar AS label_ar, COALESCE(SUM(s.total_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM store_sales s JOIN payment_methods pm ON pm.code = s.method_code
     WHERE s.status = 'completed' AND s.is_credit = 0 AND s.sold_at BETWEEN ? AND ?${storeBranchClause}${storeUserClause}
     GROUP BY s.method_code`,
    [from, to, ...storeBranchParams, ...storeUserParams],
  );
  for (const r of storeMethodRows) addMethod(r.method_code, r.label_ar, Number(r.revenue), Number(r.cnt));

  // Store Debt Repayments methods
  const sdpMethodRows = db.all<{ method_code: string; label_ar: string; revenue: number; cnt: number }>(
    `SELECT sdp.method_code, pm.label_ar AS label_ar, COALESCE(SUM(sdp.amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM store_debt_payments sdp
     JOIN payment_methods pm ON pm.code = sdp.method_code
     JOIN store_debts d ON d.id = sdp.debt_id
     JOIN store_sales s ON s.id = d.sale_id
     WHERE sdp.created_at BETWEEN ? AND ?${storeBranchClause}${sdpUserClause}
     GROUP BY sdp.method_code`,
    [from, to, ...storeBranchParams, ...sdpUserParams],
  );
  for (const r of sdpMethodRows) addMethod(r.method_code, r.label_ar, Number(r.revenue), Number(r.cnt));

  // Quick Sessions methods
  const qsMethodRows = db.all<{ method_code: string; label_ar: string; revenue: number; cnt: number }>(
    `SELECT qs.method_code, pm.label_ar AS label_ar, COALESCE(SUM(qs.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM quick_sessions qs JOIN payment_methods pm ON pm.code = qs.method_code
     WHERE qs.session_date BETWEEN ? AND ?${qsUserClause}
     GROUP BY qs.method_code`,
    [fromKey, toKey, ...qsUserParams],
  );
  for (const r of qsMethodRows) addMethod(r.method_code, r.label_ar, Number(r.revenue), Number(r.cnt));

  // Private Training methods
  const ptMethodRows = db.all<{ method_code: string; label_ar: string; revenue: number; cnt: number }>(
    `SELECT pt.method_code, pm.label_ar AS label_ar, COALESCE(SUM(pt.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM private_trainings pt JOIN payment_methods pm ON pm.code = pt.method_code
     WHERE pt.status != 'cancelled' AND pt.paid_amount_minor > 0 AND pt.created_at BETWEEN ? AND ?${ptUserClause}
     GROUP BY pt.method_code`,
    [from, to, ...ptUserParams],
  );
  for (const r of ptMethodRows) addMethod(r.method_code, r.label_ar, Number(r.revenue), Number(r.cnt));

  const byMethod = Array.from(methodTotals.entries())
    .map(([code, m]) => ({
      code,
      label: m.label,
      revenueMinor: m.revenueMinor,
      count: m.count,
    }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);

  // Membership Plans breakdown
  const byPlanRows = db.all<{ plan_id: string; plan_name: string | null; revenue: number; cnt: number }>(
    `SELECT s.plan_id, pl.name AS plan_name, COALESCE(SUM(p.paid_amount_minor), 0) AS revenue, COUNT(*) AS cnt
     FROM payments p
     JOIN member_subscriptions s ON s.id = p.subscription_id
     JOIN membership_plans pl ON pl.id = s.plan_id
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?${payBranchClause}${payUserClause}
     AND s.status != 'cancelled'
     GROUP BY s.plan_id ORDER BY revenue DESC`,
    [from, to, ...payBranchParams, ...payUserParams],
  );

  // Expenses by Category
  const expenseCategoryRows = db.all<{
    category_id: string;
    name_ar: string;
    total: number;
    cnt: number;
  }>(
    `SELECT e.category_id, c.name_ar AS name_ar, COALESCE(SUM(e.amount_minor), 0) AS total, COUNT(*) AS cnt
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.status = 'active' AND e.expense_date BETWEEN ? AND ?${expBranchClause}${expUserClause}
     GROUP BY e.category_id ORDER BY total DESC`,
    [fromKey, toKey, ...expBranchParams, ...expUserParams],
  );

  // Categorize Expenses for Income Statement
  let salariesExpensesMinor = 0;
  let rentUtilitiesExpensesMinor = 0;
  let maintenanceExpensesMinor = 0;
  let suppliesExpensesMinor = 0;
  let marketingExpensesMinor = 0;
  let otherExpensesMinor = 0;

  for (const row of expenseCategoryRows) {
    const catId = row.category_id.toLowerCase();
    const catName = row.name_ar;
    const amt = Number(row.total);
    if (catId.includes("salary") || catName.includes("راتب") || catName.includes("مرتب") || catName.includes("رواتب")) {
      salariesExpensesMinor += amt;
    } else if (catId.includes("rent") || catId.includes("electric") || catId.includes("water") || catName.includes("إيجار") || catName.includes("كهرباء") || catName.includes("مياه") || catName.includes("مرافق")) {
      rentUtilitiesExpensesMinor += amt;
    } else if (catId.includes("maint") || catName.includes("صيانة")) {
      maintenanceExpensesMinor += amt;
    } else if (catId.includes("suppl") || catId.includes("buffet") || catName.includes("بوفيه") || catName.includes("مشروبات") || catName.includes("استهلاك")) {
      suppliesExpensesMinor += amt;
    } else if (catId.includes("market") || catName.includes("تسويق") || catName.includes("إعلان")) {
      marketingExpensesMinor += amt;
    } else {
      otherExpensesMinor += amt;
    }
  }

  const grossProfitMinor = totalGrossRevenueMinor - cogsMinor - refundsMinor - storeReturnsMinor;
  const grossMarginPercent = totalGrossRevenueMinor > 0 ? Math.round((grossProfitMinor / totalGrossRevenueMinor) * 100) : 0;
  const netProfitMinor = grossProfitMinor - expensesMinor;
  const netMarginPercent = totalGrossRevenueMinor > 0 ? Math.round((netProfitMinor / totalGrossRevenueMinor) * 100) : 0;

  const incomeStatement: IncomeStatement = {
    subscriptionsRevenueMinor,
    storeSalesRevenueMinor: storeRevenueMinor,
    storeDebtRepaymentsMinor,
    quickSessionsRevenueMinor,
    privateTrainingRevenueMinor: privateTrainingsRevenueMinor,
    totalRevenueMinor: totalGrossRevenueMinor,
    cogsMinor,
    refundsMinor,
    returnsMinor: storeReturnsMinor,
    grossProfitMinor,
    grossMarginPercent,
    salariesExpensesMinor,
    rentUtilitiesExpensesMinor,
    maintenanceExpensesMinor,
    suppliesExpensesMinor,
    marketingExpensesMinor,
    otherExpensesMinor,
    totalExpensesMinor: expensesMinor,
    netProfitMinor,
    netMarginPercent,
  };

  // Consolidated Daily Series
  const revenueByDay = new Map<string, number>();
  const refundsByDay = new Map<string, number>();
  const expensesByDay = new Map<string, number>();

  function addDailyRevenue(day: string, amount: number) {
    if (!day || amount === 0) return;
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + amount);
  }

  // Daily Payments
  const dailyPay = db.all<{ day: string; total: number }>(
    `SELECT substr(p.paid_at, 1, 10) AS day, COALESCE(SUM(p.paid_amount_minor), 0) AS total
     FROM payments p
     WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?${payBranchClause}${payUserClause}
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     GROUP BY day`,
    [from, to, ...payBranchParams, ...payUserParams],
  );
  for (const r of dailyPay) addDailyRevenue(r.day, Number(r.total));

  // Daily Store Sales
  const dailyStore = db.all<{ day: string; total: number }>(
    `SELECT substr(s.sold_at, 1, 10) AS day, COALESCE(SUM(s.total_minor), 0) AS total
     FROM store_sales s
     WHERE s.status = 'completed' AND s.is_credit = 0 AND s.sold_at BETWEEN ? AND ?${storeBranchClause}${storeUserClause}
     GROUP BY day`,
    [from, to, ...storeBranchParams, ...storeUserParams],
  );
  for (const r of dailyStore) addDailyRevenue(r.day, Number(r.total));

  // Daily Store Debt Repayments
  const dailySdp = db.all<{ day: string; total: number }>(
    `SELECT substr(sdp.created_at, 1, 10) AS day, COALESCE(SUM(sdp.amount_minor), 0) AS total
     FROM store_debt_payments sdp
     JOIN store_debts d ON d.id = sdp.debt_id
     JOIN store_sales s ON s.id = d.sale_id
     WHERE sdp.created_at BETWEEN ? AND ?${storeBranchClause}${sdpUserClause}
     GROUP BY day`,
    [from, to, ...storeBranchParams, ...sdpUserParams],
  );
  for (const r of dailySdp) addDailyRevenue(r.day, Number(r.total));

  // Daily Quick Sessions
  const dailyQs = db.all<{ day: string; total: number }>(
    `SELECT qs.session_date AS day, COALESCE(SUM(qs.paid_amount_minor), 0) AS total
     FROM quick_sessions qs
     WHERE qs.session_date BETWEEN ? AND ?${qsUserClause}
     GROUP BY day`,
    [fromKey, toKey, ...qsUserParams],
  );
  for (const r of dailyQs) addDailyRevenue(r.day, Number(r.total));

  // Daily Private Training
  const dailyPt = db.all<{ day: string; total: number }>(
    `SELECT substr(pt.created_at, 1, 10) AS day, COALESCE(SUM(pt.paid_amount_minor), 0) AS total
     FROM private_trainings pt
     WHERE pt.status != 'cancelled' AND pt.paid_amount_minor > 0 AND pt.created_at BETWEEN ? AND ?${ptUserClause}
     GROUP BY day`,
    [from, to, ...ptUserParams],
  );
  for (const r of dailyPt) addDailyRevenue(r.day, Number(r.total));

  // Daily Refunds
  const dailyRefunds = db.all<{ day: string; total: number }>(
    `SELECT substr(pr.created_at, 1, 10) AS day, COALESCE(SUM(pr.amount_minor), 0) AS total
     FROM payment_refunds pr
     JOIN payments p ON p.id = pr.payment_id
     WHERE pr.created_at BETWEEN ? AND ?${payBranchClause}${refUserClause}
     GROUP BY day`,
    [from, to, ...payBranchParams, ...refUserParams],
  );
  for (const r of dailyRefunds) refundsByDay.set(r.day, (refundsByDay.get(r.day) ?? 0) + Number(r.total));

  // Daily Store Returns
  const dailyReturns = db.all<{ day: string; total: number }>(
    `SELECT substr(sr.created_at, 1, 10) AS day, COALESCE(SUM(sr.amount_minor), 0) AS total
     FROM store_returns sr
     JOIN store_sales s ON s.id = sr.sale_id
     WHERE sr.created_at BETWEEN ? AND ?${storeBranchClause}${srUserClause}
     GROUP BY day`,
    [from, to, ...storeBranchParams, ...srUserParams],
  );
  for (const r of dailyReturns) refundsByDay.set(r.day, (refundsByDay.get(r.day) ?? 0) + Number(r.total));

  // Daily Expenses
  const dailyExpenses = db.all<{ day: string; total: number }>(
    `SELECT e.expense_date AS day, COALESCE(SUM(e.amount_minor), 0) AS total
     FROM expenses e
     WHERE e.status = 'active' AND e.expense_date BETWEEN ? AND ?${expBranchClause}${expUserClause}
     GROUP BY day`,
    [fromKey, toKey, ...expBranchParams, ...expUserParams],
  );
  for (const r of dailyExpenses) expensesByDay.set(r.day, Number(r.total));

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

  // Receivables & Outstanding Aging
  const activeSubsDebts = db.all<{
    member_id: string; full_name: string; member_code: string; phone: string | null;
    price: number; paid: number | null; disc: number | null; created_at: string;
  }>(
    `WITH paid AS (
      SELECT subscription_id, SUM(paid_amount_minor) AS p, SUM(discount_amount_minor) AS d
      FROM payments
      WHERE status IN ('partial', 'paid')
      GROUP BY subscription_id
    )
    SELECT s.member_id, m.full_name, m.member_code, m.phone, s.price,
           paid.p AS paid, paid.d AS disc, s.created_at
    FROM member_subscriptions s
    JOIN members m ON m.id = s.member_id
    LEFT JOIN paid ON paid.subscription_id = s.id
    WHERE s.status = 'active'`,
  );

  let subscriptionsDebtMinor = 0;
  let agingUnder30Minor = 0;
  let aging30To60Minor = 0;
  let agingOver60Minor = 0;

  const debtorMap = new Map<
    string,
    {
      memberId: string;
      memberName: string;
      memberCode: string;
      phone: string | null;
      subsDebt: number;
      storeDebt: number;
      ptDebt: number;
    }
  >();

  function getOrInitDebtor(id: string, name: string, code: string, phone: string | null) {
    let d = debtorMap.get(id);
    if (!d) {
      d = { memberId: id, memberName: name, memberCode: code, phone, subsDebt: 0, storeDebt: 0, ptDebt: 0 };
      debtorMap.set(id, d);
    }
    return d;
  }

  const nowMs = Date.now();
  function classifyAging(createdStr: string, amount: number) {
    const ageDays = Math.max(0, Math.floor((nowMs - new Date(createdStr).getTime()) / (1000 * 60 * 60 * 24)));
    if (ageDays < 30) agingUnder30Minor += amount;
    else if (ageDays < 60) aging30To60Minor += amount;
    else agingOver60Minor += amount;
  }

  for (const s of activeSubsDebts) {
    const priceMinor = Math.round(Number(s.price) * 100);
    const paidMinor = Number(s.paid ?? 0);
    const discMinor = Number(s.disc ?? 0);
    const rem = Math.max(0, priceMinor - paidMinor - discMinor);
    if (rem > 0) {
      subscriptionsDebtMinor += rem;
      classifyAging(s.created_at, rem);
      const debtor = getOrInitDebtor(s.member_id, s.full_name, s.member_code, s.phone);
      debtor.subsDebt += rem;
    }
  }

  const storeDebtsRows = db.all<{
    member_id: string; full_name: string; member_code: string; phone: string | null;
    remaining_minor: number; created_at: string;
  }>(
    `SELECT d.member_id, m.full_name, m.member_code, m.phone,
            (d.original_minor - d.paid_minor) AS remaining_minor, d.created_at
     FROM store_debts d
     JOIN members m ON m.id = d.member_id
     WHERE d.status = 'open' AND (d.original_minor - d.paid_minor) > 0`,
  );

  let storeDebtMinor = 0;
  for (const sd of storeDebtsRows) {
    const rem = Number(sd.remaining_minor);
    storeDebtMinor += rem;
    classifyAging(sd.created_at, rem);
    const debtor = getOrInitDebtor(sd.member_id, sd.full_name, sd.member_code, sd.phone);
    debtor.storeDebt += rem;
  }

  const ptDebtsRows = db.all<{
    member_id: string; full_name: string; member_code: string; phone: string | null;
    remaining_amount_minor: number; created_at: string;
  }>(
    `SELECT pt.member_id, m.full_name, m.member_code, m.phone,
            pt.remaining_amount_minor, pt.created_at
     FROM private_trainings pt
     JOIN members m ON m.id = pt.member_id
     WHERE pt.status = 'active' AND pt.remaining_amount_minor > 0`,
  );

  let privateTrainingDebtMinor = 0;
  for (const pt of ptDebtsRows) {
    const rem = Number(pt.remaining_amount_minor);
    privateTrainingDebtMinor += rem;
    classifyAging(pt.created_at, rem);
    const debtor = getOrInitDebtor(pt.member_id, pt.full_name, pt.member_code, pt.phone);
    debtor.ptDebt += rem;
  }

  const totalReceivablesMinor = subscriptionsDebtMinor + storeDebtMinor + privateTrainingDebtMinor;
  const topDebtors = Array.from(debtorMap.values())
    .map((d) => ({
      memberId: d.memberId,
      memberName: d.memberName,
      memberCode: d.memberCode,
      phone: d.phone,
      subscriptionsDebtMinor: d.subsDebt,
      storeDebtMinor: d.storeDebt,
      ptDebtMinor: d.ptDebt,
      totalDebtMinor: d.subsDebt + d.storeDebt + d.ptDebt,
    }))
    .sort((a, b) => b.totalDebtMinor - a.totalDebtMinor)
    .slice(0, 10);

  const receivables: ReceivablesSummary = {
    totalReceivablesMinor,
    subscriptionsDebtMinor,
    storeDebtMinor,
    privateTrainingDebtMinor,
    aging: {
      under30DaysMinor: agingUnder30Minor,
      from30To60DaysMinor: aging30To60Minor,
      over60DaysMinor: agingOver60Minor,
    },
    topDebtors,
  };

  // Liquidity by Channel
  const ledgerRows = db.all<{
    box: string; method_code: string; direction: number; amount_minor: number;
  }>(
    `SELECT l.box, l.method_code, l.direction, l.amount_minor
     FROM financial_ledger l
     WHERE substr(l.occurred_at, 1, 10) BETWEEN ? AND ?`,
    [fromKey, toKey],
  );

  let gymCashMinor = 0;
  let storeCashMinor = 0;
  let walletsMinor = 0;
  let bankMinor = 0;

  for (const row of ledgerRows) {
    const dir = row.direction;
    const amt = Number(row.amount_minor) * dir;
    const m = row.method_code.toLowerCase();
    const b = row.box || "gym";

    if (m === "cash") {
      if (b === "store") storeCashMinor += amt;
      else gymCashMinor += amt;
    } else if (m.includes("wallet") || m.includes("instapay") || m.includes("vodafone")) {
      walletsMinor += amt;
    } else if (m.includes("bank") || m.includes("card") || m.includes("visa")) {
      bankMinor += amt;
    } else {
      gymCashMinor += amt;
    }
  }

  // Detailed paginated queries
  const detailedPayments = db.all<{
    id: string; paid_at: string; full_name: string; member_code: string;
    plan_name: string | null; net_amount_minor: number; paid_amount_minor: number;
    remaining_amount_minor: number; method_label: string; status: string;
    void_reason: string | null; refund_reason: string | null;
    creator_name: string; branch_id: string | null; reference_no: string | null; receipt_no: string | null;
  }>(
    `SELECT p.id, p.paid_at, m.full_name, m.member_code, pl.name AS plan_name,
      p.net_amount_minor, p.paid_amount_minor, p.remaining_amount_minor,
      pm.label_ar AS method_label, p.status, p.void_reason,
      u.full_name AS creator_name, p.branch_id, p.reference_no, p.receipt_no,
      (SELECT pr.reason FROM payment_refunds pr WHERE pr.payment_id = p.id ORDER BY pr.created_at DESC LIMIT 1) AS refund_reason
     FROM payments p
     JOIN members m ON m.id = p.member_id
     JOIN payment_methods pm ON pm.code = p.method_code
     JOIN users u ON u.id = p.created_by
     LEFT JOIN member_subscriptions s ON s.id = p.subscription_id
     LEFT JOIN membership_plans pl ON pl.id = s.plan_id
     WHERE p.status IN ('partial', 'paid', 'refunded', 'voided') AND p.paid_at BETWEEN ? AND ?${payBranchClause}${payUserClause}
     AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))
     ORDER BY p.paid_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, ...payBranchParams, ...payUserParams, pageSize, offsetOf(paymentsPage)],
  );
  const detailedPaymentsTotal = Number(
    db.scalar(
      `SELECT COUNT(*) FROM payments p
       WHERE p.status IN ('partial', 'paid', 'refunded', 'voided') AND p.paid_at BETWEEN ? AND ?${payBranchClause}${payUserClause}
       AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))`,
      [from, to, ...payBranchParams, ...payUserParams],
    ) ?? 0,
  );

  const detailedExpenses = db.all<{
    id: string; expense_date: string; name_ar: string; amount_minor: number;
    description: string; method_label: string; void_reason: string | null;
    creator_name: string; branch_id: string | null;
  }>(
    `SELECT e.id, e.expense_date, c.name_ar, e.amount_minor, e.description,
      pm.label_ar AS method_label, e.void_reason,
      u.full_name AS creator_name, e.branch_id
     FROM expenses e
     JOIN expense_categories c ON c.id = e.category_id
     JOIN payment_methods pm ON pm.code = e.method_code
     JOIN users u ON u.id = e.created_by
     WHERE e.expense_date BETWEEN ? AND ?${expBranchClause}${expUserClause}
     ORDER BY e.expense_date DESC
     LIMIT ? OFFSET ?`,
    [fromKey, toKey, ...expBranchParams, ...expUserParams, pageSize, offsetOf(expensesPage)],
  );
  const detailedExpensesTotal = Number(
    db.scalar(`SELECT COUNT(*) FROM expenses e WHERE e.expense_date BETWEEN ? AND ?${expBranchClause}${expUserClause}`, [fromKey, toKey, ...expBranchParams, ...expUserParams]) ?? 0,
  );

  const detailedRefunds = db.all<{
    id: string; created_at: string; full_name: string; amount_minor: number;
    reason: string; method_label: string; payment_id: string;
    creator_name: string; branch_id: string | null; refund_no: string | null;
  }>(
    `SELECT pr.id, pr.created_at, m.full_name, pr.amount_minor, pr.reason,
      pm.label_ar AS method_label, pr.payment_id,
      u.full_name AS creator_name, p.branch_id, pr.refund_no
     FROM payment_refunds pr
     JOIN payments p ON p.id = pr.payment_id
     JOIN members m ON m.id = p.member_id
     JOIN payment_methods pm ON pm.code = p.method_code
     JOIN users u ON u.id = pr.created_by
     WHERE pr.created_at BETWEEN ? AND ?${payBranchClause}${refUserClause}
     ORDER BY pr.created_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, ...payBranchParams, ...refUserParams, pageSize, offsetOf(refundsPage)],
  );
  const detailedRefundsTotal = Number(
    db.scalar(
      `SELECT COUNT(*) FROM payment_refunds pr
       JOIN payments p ON p.id = pr.payment_id
       WHERE pr.created_at BETWEEN ? AND ?${payBranchClause}${refUserClause}`,
      [from, to, ...payBranchParams, ...refUserParams],
    ) ?? 0,
  );

  const detailedVoids = db.all<{
    id: string; voided_at: string; full_name: string; paid_amount_minor: number;
    void_reason: string; method_label: string;
    voider_name: string; branch_id: string | null;
  }>(
    `SELECT p.id, p.voided_at, m.full_name, p.paid_amount_minor, p.void_reason,
      pm.label_ar AS method_label,
      COALESCE(u.full_name, '—') AS voider_name, p.branch_id
     FROM payments p
     JOIN members m ON m.id = p.member_id
     JOIN payment_methods pm ON pm.code = p.method_code
     LEFT JOIN users u ON u.id = p.voided_by
     WHERE p.status = 'voided' AND p.voided_at BETWEEN ? AND ?${payBranchClause}${voidUserClause}
     ORDER BY p.voided_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, ...payBranchParams, ...voidUserParams, pageSize, offsetOf(voidsPage)],
  );
  const detailedVoidsTotal = Number(
    db.scalar(`SELECT COUNT(*) FROM payments p WHERE p.status = 'voided' AND p.voided_at BETWEEN ? AND ?${payBranchClause}${voidUserClause}`, [from, to, ...payBranchParams, ...voidUserParams]) ?? 0,
  );

  // Multi-branch summary
  const branchesList = listRegisteredBranches(db);
  const byBranch: BranchFinancialSummary[] = branchesList.map((b) => {
    const bRevenue = Number(
      db.scalar(
        `SELECT COALESCE(SUM(p.paid_amount_minor), 0) FROM payments p
         WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?
         AND COALESCE(p.branch_id, 'main') = ?${payUserClause}
         AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))`,
        [from, to, b.branchId, ...payUserParams],
      ) ?? 0,
    );
    const bStoreRev = Number(
      db.scalar(
        `SELECT COALESCE(SUM(s.total_minor), 0) FROM store_sales s
         WHERE s.status = 'completed' AND s.is_credit = 0 AND s.sold_at BETWEEN ? AND ?
         AND COALESCE(s.branch_id, 'main') = ?${storeUserClause}`,
        [from, to, b.branchId, ...storeUserParams],
      ) ?? 0,
    );
    const bTotalRev = bRevenue + bStoreRev;

    const bPayCount = Number(
      db.scalar(
        `SELECT COUNT(*) FROM payments p
         WHERE p.status IN ('partial', 'paid', 'refunded') AND p.paid_at BETWEEN ? AND ?
         AND COALESCE(p.branch_id, 'main') = ?${payUserClause}
         AND (p.subscription_id IS NULL OR p.subscription_id NOT IN (SELECT id FROM member_subscriptions WHERE status = 'cancelled'))`,
        [from, to, b.branchId, ...payUserParams],
      ) ?? 0,
    );
    const bRefunds = Number(
      db.scalar(
        `SELECT COALESCE(SUM(pr.amount_minor), 0) FROM payment_refunds pr
         JOIN payments p ON p.id = pr.payment_id
         WHERE pr.created_at BETWEEN ? AND ? AND COALESCE(p.branch_id, 'main') = ?${refUserClause}`,
        [from, to, b.branchId, ...refUserParams],
      ) ?? 0,
    );
    const bExpenses = Number(
      db.scalar(
        `SELECT COALESCE(SUM(CASE WHEN e.status = 'active' THEN e.amount_minor ELSE 0 END), 0)
         FROM expenses e WHERE e.expense_date BETWEEN ? AND ? AND COALESCE(e.branch_id, 'main') = ?${expUserClause}`,
        [fromKey, toKey, b.branchId, ...expUserParams],
      ) ?? 0,
    );

    return {
      branchId: b.branchId,
      branchName: b.branchName,
      revenueMinor: bTotalRev,
      refundsMinor: bRefunds,
      expensesMinor: bExpenses,
      netResultMinor: bTotalRev - bRefunds - bExpenses,
      paymentCount: bPayCount,
    };
  });

  const sessionUserClause = targetUser ? " AND (cs.opened_by = ? OR cs.closed_by = ?)" : "";
  const sessionUserParams = targetUser ? [targetUser, targetUser] : [];

  const cashSessionRows = db.all<{
    id: string;
    opened_at: string;
    closed_at: string | null;
    opening_balance_minor: number;
    expected_closing_minor: number | null;
    counted_closing_minor: number | null;
    difference_minor: number | null;
    close_note: string | null;
    status: string;
    box: string | null;
    opener_name: string;
    closer_name: string | null;
  }>(
    `SELECT cs.id, cs.opened_at, cs.closed_at, cs.opening_balance_minor,
            cs.expected_closing_minor, cs.counted_closing_minor, cs.difference_minor,
            cs.close_note, cs.status, cs.box,
            ou.full_name AS opener_name, cu.full_name AS closer_name
     FROM cash_sessions cs
     JOIN users ou ON ou.id = cs.opened_by
     LEFT JOIN users cu ON cu.id = cs.closed_by
     WHERE cs.opened_at BETWEEN ? AND ?${sessionUserClause}
     ORDER BY cs.opened_at DESC`,
    [from, to, ...sessionUserParams],
  );

  let totalShortageMinor = 0;
  let totalSurplusMinor = 0;
  let closedSessionsCount = 0;

  const detailedCashSessions: DetailedCashSessionItem[] = cashSessionRows.map((cs) => {
    const diff = cs.difference_minor == null ? null : Number(cs.difference_minor);
    if (cs.status === "closed") {
      closedSessionsCount++;
      if (diff != null) {
        if (diff < 0) totalShortageMinor += Math.abs(diff);
        else if (diff > 0) totalSurplusMinor += diff;
      }
    }
    return {
      id: cs.id,
      openedAt: cs.opened_at,
      closedAt: cs.closed_at,
      openedByName: cs.opener_name,
      closedByName: cs.closer_name,
      openingBalanceMinor: Number(cs.opening_balance_minor),
      expectedClosingMinor: cs.expected_closing_minor == null ? null : Number(cs.expected_closing_minor),
      countedClosingMinor: cs.counted_closing_minor == null ? null : Number(cs.counted_closing_minor),
      differenceMinor: diff,
      closeNote: cs.close_note,
      status: cs.status,
      box: cs.box ?? "gym",
    };
  });

  const ownerWithdrawalsRow = db.first<{ total: number }>(
    `SELECT COALESCE(SUM(e.amount_minor), 0) AS total
     FROM expenses e
     JOIN expense_categories c ON c.id = e.category_id
     WHERE e.status = 'active' AND e.expense_date BETWEEN ? AND ?${expBranchClause}${expUserClause}
     AND (e.category_id = 'cat-owner-withdrawal' OR c.name_ar LIKE '%مسحوبات%' OR e.description LIKE '%مسحوبات المالك%')`,
    [fromKey, toKey, ...expBranchParams, ...expUserParams],
  );
  const totalOwnerWithdrawalsMinor = Number(ownerWithdrawalsRow?.total ?? 0);

  const cashSummary: PeriodCashSummary = {
    totalShortageMinor,
    totalSurplusMinor,
    totalOwnerWithdrawalsMinor,
    closedSessionsCount,
  };

  const liquidity: LiquiditySummary = {
    gymCashMinor,
    storeCashMinor,
    walletsMinor,
    bankMinor,
    ownerWithdrawalsMinor: totalOwnerWithdrawalsMinor,
    netLiquidityMinor: gymCashMinor + storeCashMinor + walletsMinor + bankMinor,
  };

  return {
    revenueMinor,
    subscriptionsRevenueMinor,
    storeRevenueMinor,
    storeDebtRepaymentsMinor,
    quickSessionsRevenueMinor,
    privateTrainingsRevenueMinor,
    cogsMinor,
    refundsMinor,
    expensesMinor,
    netResultMinor: revenueMinor - refundsMinor - expensesMinor,
    paymentCount,
    avgTicketMinor: paymentCount > 0 ? Math.round(revenueMinor / paymentCount) : 0,
    streamsSummary,
    incomeStatement,
    receivables,
    liquidity,
    byMethod,
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
    byBranch,
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
        createdByName: r.creator_name,
        branchId: r.branch_id ?? "main",
        referenceNo: r.reference_no,
        receiptNo: r.receipt_no,
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
        createdByName: r.creator_name,
        branchId: r.branch_id ?? "main",
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
        createdByName: r.creator_name,
        branchId: r.branch_id ?? "main",
        refundNo: r.refund_no,
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
        voidedByName: r.voider_name,
        branchId: r.branch_id ?? "main",
      })),
      total: detailedVoidsTotal,
    },
    cashSummary,
    detailedCashSessions,
  };
}
