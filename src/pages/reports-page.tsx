import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  Clock3,
  Layers,
  ReceiptText,
  Repeat,
  ScrollText,
  TrendingDown,
  TrendingUp,
  UserRoundX,
  Users,
  Banknote,
  Building2,
  FileSpreadsheet,
  Printer,
  Percent,
  Wallet,
  CreditCard,
  ShoppingBag,
  CheckCircle2,
  Coins,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { api, type BranchFinancialSummary, type PublicUser } from "@/api";
import type { PeriodReport } from "@/core/services/financial-report.service";
import type {
  AttendanceAnalytics,
  MemberVisitRow,
  PeakHoursHeatmapData,
} from "@/core/services/attendance-analytics.service";
import type { StaffActivityEntry } from "@/core/services/staff-activity.service";
import type {
  RetentionInsights,
  InactiveMemberRow,
  DayOfWeekPoint,
  DepartmentPoint,
} from "@/core/services/activity-insights.service";
import { formatMinor } from "@/core/money";
import { addDaysKey, parseDateKey, todayKey } from "@/core/dates";
import { formatDateShort, formatNumber, formatTime } from "@/services/format";
import type { ServiceActor } from "@/core/permissions";
import { cn } from "@/utils/cn";

import type { ChartDataset } from "@/types";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type Column } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { AttendanceChart } from "@/components/charts/attendance-chart";
import { BranchFilter } from "@/components/ui/branch-filter";
import { BranchBadge } from "@/components/ui/branch-badge";
import { Badge } from "@/components/ui/badge";

type PeriodValue = "today" | "week" | "month" | "custom";
type ReportView = "finance" | "attendance" | "retention" | "staff";

const PERIODS: Array<{ value: string; key: string }> = [
  { value: "today", key: "rpt.periodToday" },
  { value: "week", key: "rpt.periodWeek" },
  { value: "month", key: "rpt.periodMonth" },
  { value: "custom", key: "rpt.periodCustom" },
];

const VIEWS: Array<{ value: ReportView; key: string }> = [
  { value: "finance", key: "rpt.tabFinance" },
  { value: "attendance", key: "rpt.tabAttendance" },
  { value: "retention", key: "rpt.tabRetention" },
  { value: "staff", key: "rpt.tabStaff" },
];

function rangeFor(period: PeriodValue): { fromKey: string; toKey: string } {
  const today = todayKey();
  if (period === "today") return { fromKey: today, toKey: today };
  if (period === "week") return { fromKey: addDaysKey(today, -6), toKey: today };
  if (period === "month") return { fromKey: `${today.slice(0, 7)}-01`, toKey: today };
  return { fromKey: addDaysKey(today, -29), toKey: today };
}

interface MethodRow {
  code: string;
  label: string;
  revenueMinor: number;
  count: number;
}

export function ReportsPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();

  const [view, setView] = useState<ReportView>("finance");
  const [period, setPeriod] = useState<PeriodValue>("month");
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [customFrom, setCustomFrom] = useState(rangeFor("month").fromKey);
  const [customTo, setCustomTo] = useState(todayKey());
  const [appliedCustom, setAppliedCustom] = useState<{ fromKey: string; toKey: string }>(rangeFor("month"));
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [detailPages, setDetailPages] = useState({
    payments: 1,
    expenses: 1,
    refunds: 1,
    voids: 1,
  });
  const DETAIL_PAGE_SIZE = 50;
  const { toast } = useToast();
  const [financeSubTab, setFinanceSubTab] = useState<"overview" | "streams" | "receivables" | "liquidity" | "details">("overview");
  const [printModalOpen, setPrintModalOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api.users
      .list()
      .then((u) => {
        if (alive) setUsers(u);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const handleBranchChange = (branchId: string) => {
    setSelectedBranch(branchId);
    setDetailPages({ payments: 1, expenses: 1, refunds: 1, voids: 1 });
  };

  const handleUserChange = (userId: string) => {
    setSelectedUser(userId);
    setDetailPages({ payments: 1, expenses: 1, refunds: 1, voids: 1 });
  };

  useEffect(() => {
    if (!actor || !hasPermission("reports.view")) return;
    if (view !== "finance") return;
    let alive = true;
    const range = period === "custom" ? appliedCustom : rangeFor(period);
    if (range.fromKey > range.toKey) {
      setReport(null);
      return;
    }
    api.reports
      .period(range.fromKey, range.toKey, {
        paymentsPage: detailPages.payments,
        expensesPage: detailPages.expenses,
        refundsPage: detailPages.refunds,
        voidsPage: detailPages.voids,
        pageSize: DETAIL_PAGE_SIZE,
        branchId: selectedBranch,
        userId: selectedUser !== "all" ? selectedUser : undefined,
      })
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, period, appliedCustom, hasPermission, view, selectedBranch, selectedUser, detailPages.payments, detailPages.expenses, detailPages.refunds, detailPages.voids]);

  const chartDataset = useMemo<ChartDataset | null>(() => {
    if (!report) return null;
    return {
      mode: "bars",
      points: report.daily.map((d) => ({
        label: d.dateKey.slice(5),
        value: Math.round((d.revenueMinor - d.expensesMinor) / 100),
      })),
    };
  }, [report]);

  const methodRows: MethodRow[] =
    report?.byMethod.map((m) => ({
      code: m.code,
      label: m.label,
      revenueMinor: m.revenueMinor,
      count: m.count,
    })) ?? [];

  const methodColumns: Column<MethodRow>[] = [
    { key: "label", header: t("pay.colMethod"), render: (row) => <span className="font-bold">{row.label}</span> },
    {
      key: "revenue",
      header: t("rpt.revenue"),
      render: (row) => (
        <span dir="ltr" className="font-extrabold tabnum text-emerald">
          {formatMinor(row.revenueMinor)}
        </span>
      ),
    },
    {
      key: "count",
      header: t("rpt.paymentCount"),
      render: (row) => <span className="tabnum text-subtle">{t("rpt.count", { count: row.count })}</span>,
    },
  ];

  interface PlanRow {
    planId: string;
    planName: string;
    revenueMinor: number;
    count: number;
  }

  const planRows: PlanRow[] =
    report?.byPlan.map((p) => ({
      planId: p.planId,
      planName: p.planName,
      revenueMinor: p.revenueMinor,
      count: p.count,
    })) ?? [];

  const planColumns: Column<PlanRow>[] = [
    { key: "name", header: t("common.plan"), render: (row) => <span className="font-bold">{row.planName}</span> },
    {
      key: "revenue",
      header: t("rpt.revenue"),
      render: (row) => (
        <span dir="ltr" className="font-extrabold tabnum text-emerald">
          {formatMinor(row.revenueMinor)}
        </span>
      ),
    },
    {
      key: "count",
      header: t("rpt.paymentCount"),
      render: (row) => <span className="tabnum text-subtle">{t("rpt.count", { count: row.count })}</span>,
    },
  ];

  interface CategoryRow {
    categoryId: string;
    nameAr: string;
    amountMinor: number;
    count: number;
  }

  const categoryRows: CategoryRow[] =
    report?.expensesByCategory.map((c) => ({
      categoryId: c.categoryId,
      nameAr: c.nameAr,
      amountMinor: c.amountMinor,
      count: c.count,
    })) ?? [];

  const categoryColumns: Column<CategoryRow>[] = [
    { key: "name", header: t("exp.filterCategory"), render: (row) => <span className="font-bold">{row.nameAr}</span> },
    {
      key: "amount",
      header: t("exp.colAmount"),
      render: (row) => (
        <span dir="ltr" className="font-extrabold tabnum text-red">
          {formatMinor(row.amountMinor)}
        </span>
      ),
    },
    {
      key: "count",
      header: t("rpt.paymentCount"),
      render: (row) => <span className="tabnum text-subtle">{t("rpt.count", { count: row.count })}</span>,
    },
  ];

  const streamColumns: Column<PeriodReport["streamsSummary"][number]>[] = [
    {
      key: "label",
      header: "القطاع / الرافد",
      render: (r) => <span className="font-bold text-foreground">{r.labelAr}</span>,
    },
    {
      key: "revenue",
      header: t("rpt.revenue"),
      render: (r) => (
        <span dir="ltr" className="font-extrabold tabnum text-emerald">
          {formatMinor(r.revenueMinor)}
        </span>
      ),
    },
    {
      key: "count",
      header: t("rpt.paymentCount"),
      render: (r) => <span className="tabnum text-subtle">{t("rpt.count", { count: r.paymentCount })}</span>,
    },
    {
      key: "percent",
      header: "نسبة المساهمة",
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-panel-border rounded-full overflow-hidden">
            <div
              className="h-full bg-neon transition-all"
              style={{ width: `${Math.min(100, Math.max(0, r.percentage))}%` }}
            />
          </div>
          <span dir="ltr" className="text-xs font-bold tabnum text-ink">{r.percentage}%</span>
        </div>
      ),
    },
  ];

  const debtorColumns: Column<PeriodReport["receivables"]["topDebtors"][number]>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (r) => (
        <div>
          <Link
            to={`/members/${r.memberId}`}
            className="font-bold hover:underline hover:text-neon text-foreground transition-colors"
          >
            {r.memberName}
          </Link>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-subtle">
            <span dir="ltr" className="tabnum font-mono">{r.memberCode}</span>
            {r.phone && <span dir="ltr">{r.phone}</span>}
          </div>
        </div>
      ),
    },
    {
      key: "subsDebt",
      header: t("rpt.colSubsDebt"),
      render: (r) => (
        <span dir="ltr" className="tabnum font-medium text-subtle">
          {r.subscriptionsDebtMinor > 0 ? formatMinor(r.subscriptionsDebtMinor) : "—"}
        </span>
      ),
    },
    {
      key: "storeDebt",
      header: t("rpt.colStoreDebt"),
      render: (r) => (
        <span dir="ltr" className="tabnum font-medium text-subtle">
          {r.storeDebtMinor > 0 ? formatMinor(r.storeDebtMinor) : "—"}
        </span>
      ),
    },
    {
      key: "ptDebt",
      header: t("rpt.colPtDebt"),
      render: (r) => (
        <span dir="ltr" className="tabnum font-medium text-subtle">
          {r.ptDebtMinor > 0 ? formatMinor(r.ptDebtMinor) : "—"}
        </span>
      ),
    },
    {
      key: "totalDebt",
      header: t("rpt.colTotalDebt"),
      render: (r) => (
        <span dir="ltr" className="font-extrabold tabnum text-red">
          {formatMinor(r.totalDebtMinor)}
        </span>
      ),
    },
  ];

  const handleExportCsv = () => {
    if (!report) return;
    const range = period === "custom" ? appliedCustom : rangeFor(period);
    const branchName = selectedBranch === "all" ? "كافة الفروع" : selectedBranch;

    const lines: string[] = [];
    const add = (cols: (string | number)[]) => {
      lines.push(cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    };

    add(["التقرير المالي وقائمة الدخل المعتمدة", `الفترة: ${range.fromKey} إلى ${range.toKey}`, `الفرع: ${branchName}`]);
    add([]);
    add(["=== 1. قائمة الأرباح والخسائر الشاملة (Income Statement / P&L) ==="]);
    add(["البند المحاسبي", "القيمة (ج.م)"]);
    add(["اشتراكات وتجديدات الجيم", (report.incomeStatement.subscriptionsRevenueMinor / 100).toFixed(2)]);
    add(["مبيعات المتجر والكافيتيريا", (report.incomeStatement.storeSalesRevenueMinor / 100).toFixed(2)]);
    add(["سداد مديونيات المتجر الآجلة", (report.incomeStatement.storeDebtRepaymentsMinor / 100).toFixed(2)]);
    add(["تذاكر الدخول اليومي والحصص السريعة", (report.incomeStatement.quickSessionsRevenueMinor / 100).toFixed(2)]);
    add(["باقات التدريب الخاص (PT)", (report.incomeStatement.privateTrainingRevenueMinor / 100).toFixed(2)]);
    add(["إجمالي الإيرادات التشغيلية المجمعة", (report.incomeStatement.totalRevenueMinor / 100).toFixed(2)]);
    add(["تكلفة البضاعة المباعة بالمتجر (COGS)", (-report.incomeStatement.cogsMinor / 100).toFixed(2)]);
    add(["المبالغ المستردة ومردودات المبيعات", (-(report.incomeStatement.refundsMinor + report.incomeStatement.returnsMinor) / 100).toFixed(2)]);
    add(["مجمل الربح التشغيلي (Gross Profit)", (report.incomeStatement.grossProfitMinor / 100).toFixed(2)]);
    add(["نسبة هامش مجمل الربح", `${report.incomeStatement.grossMarginPercent}%`]);
    add(["المصروفات التشغيلية والعمومية (Operating Expenses)", (-report.incomeStatement.totalExpensesMinor / 100).toFixed(2)]);
    add(["صافي الربح الحقيقي للنشاط (Net Profit)", (report.incomeStatement.netProfitMinor / 100).toFixed(2)]);
    add(["نسبة هامش صافي الربح", `${report.incomeStatement.netMarginPercent}%`]);
    add([]);
    add(["=== 2. توزيع روافد الإيرادات والمبيعات ==="]);
    add(["القطاع / الرافد", "الإيراد (ج.م)", "عدد العمليات", "نسبة المساهمة"]);
    for (const s of report.streamsSummary) {
      add([s.labelAr, (s.revenueMinor / 100).toFixed(2), s.paymentCount, `${s.percentage}%`]);
    }
    add([]);
    add(["=== 3. المديونيات والمستحقات المعلقة وأعمار الديون ==="]);
    add(["إجمالي الأموال المعلقة في السوق", (report.receivables.totalReceivablesMinor / 100).toFixed(2)]);
    add(["متبقي الاشتراكات النشطة", (report.receivables.subscriptionsDebtMinor / 100).toFixed(2)]);
    add(["مديونيات المتجر الآجلة", (report.receivables.storeDebtMinor / 100).toFixed(2)]);
    add(["متبقي التدريب الخاص (PT)", (report.receivables.privateTrainingDebtMinor / 100).toFixed(2)]);
    add(["ديون جارية (أقل من 30 يوم)", (report.receivables.aging.under30DaysMinor / 100).toFixed(2)]);
    add(["ديون متوسطة (30 إلى 60 يوم)", (report.receivables.aging.from30To60DaysMinor / 100).toFixed(2)]);
    add(["ديون متأخرة (أكثر من 60 يوم)", (report.receivables.aging.over60DaysMinor / 100).toFixed(2)]);
    add([]);
    add(["قائمة أكبر الأعضاء المدينين"]);
    add(["كود العضو", "اسم العضو", "الهاتف", "متبقي اشتراك", "دين متجر", "متبقي تدريب", "إجمالي المديونية المطلوبة"]);
    for (const d of report.receivables.topDebtors) {
      add([d.memberCode, d.memberName, d.phone || "—", (d.subscriptionsDebtMinor / 100).toFixed(2), (d.storeDebtMinor / 100).toFixed(2), (d.ptDebtMinor / 100).toFixed(2), (d.totalDebtMinor / 100).toFixed(2)]);
    }
    add([]);
    add(["=== 4. توزيع السيولة النقدية والأوعية المالية ==="]);
    add(["الوعاء المالي", "الرصيد الصافي للفترة (ج.م)"]);
    add(["خزينة الجيم النقدية الرئيسية", (report.liquidity.gymCashMinor / 100).toFixed(2)]);
    add(["خزينة المتجر والبوفيه", (report.liquidity.storeCashMinor / 100).toFixed(2)]);
    add(["المحافظ الإلكترونية (انستاباي / فودافون كاش)", (report.liquidity.walletsMinor / 100).toFixed(2)]);
    add(["الحسابات البنكية وفيزا", (report.liquidity.bankMinor / 100).toFixed(2)]);
    add(["مسحوبات المالك الشخصية", (report.liquidity.ownerWithdrawalsMinor / 100).toFixed(2)]);
    add(["صافي السيولة النقدية المتاحة", (report.liquidity.netLiquidityMinor / 100).toFixed(2)]);

    const csvContent = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `تقرير_مالي_${range.fromKey}_إلى_${range.toKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast("success", t("rpt.exportedSuccessfully"));
  };

  const detailedPaymentColumns: Column<PeriodReport["detailedPayments"]["items"][number]>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{formatDateShort(parseDateKey(row.paidAt.slice(0, 10)))} • {formatTime(row.paidAt)}</span> },
    {
      key: "receiptNo",
      header: t("pay.colReceiptNo"),
      render: (row) =>
        row.receiptNo ? (
          <span dir="ltr" className="font-mono text-[11px] font-bold text-ink">
            {row.receiptNo}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    { key: "member", header: t("pay.colMember"), render: (row) => <span className="font-bold">{row.memberName} · {row.memberCode}</span> },
    { key: "plan", header: t("pay.colPlan"), render: (row) => <span className="text-subtle">{row.planName}</span> },
    { key: "net", header: t("pay.colNet"), render: (row) => <span dir="ltr" className="font-extrabold tabnum">{formatMinor(row.netMinor)}</span> },
    { key: "paid", header: t("pay.colPaid"), render: (row) => <span dir="ltr" className="font-bold tabnum text-emerald">{formatMinor(row.paidMinor)}</span> },
    { key: "remaining", header: t("pay.colRemaining"), render: (row) => row.status === "voided" ? <span className="text-faint">—</span> : row.remainingMinor > 0 ? <span dir="ltr" className="font-bold tabnum text-red">{formatMinor(row.remainingMinor)}</span> : <span className="text-faint">0.00</span> },
    {
      key: "method",
      header: t("pay.colMethod"),
      render: (row) => (
        <div>
          <span className="text-subtle">{row.methodLabel}</span>
          {row.referenceNo && (
            <span
              dir="ltr"
              className="inline-block ms-1.5 rounded bg-muted/20 px-1 py-0.5 text-[10px] font-mono font-bold text-cyan tabnum border border-line/50"
              title={`الرقم المرجعي: ${row.referenceNo}`}
            >
              #{row.referenceNo}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.branchId} />,
    },
    {
      key: "by",
      header: t("pay.colBy"),
      render: (row) => <span className="text-faint text-[12px]">{row.createdByName || "—"}</span>,
    },
    { key: "status", header: t("pay.colStatus"), render: (row) => <span className="text-subtle">{t(`payStatus.${row.status}`)}</span> },
    { key: "reason", header: t("pay.colReason"), render: (row) => row.voidReason ? <span className="text-[12px] text-subtle max-w-32 truncate block" title={row.voidReason}>{row.voidReason}</span> : row.refundReason ? <span className="text-[12px] text-subtle max-w-32 truncate block" title={row.refundReason}>{row.refundReason}</span> : <span className="text-faint">—</span> },
  ];

  const detailedExpenseColumns: Column<PeriodReport["detailedExpenses"]["items"][number]>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{row.date}</span> },
    { key: "category", header: t("exp.filterCategory"), render: (row) => <span className="font-bold">{row.categoryName}</span> },
    { key: "amount", header: t("exp.colAmount"), render: (row) => <span dir="ltr" className="font-extrabold tabnum text-red">{formatMinor(row.amountMinor)}</span> },
    { key: "desc", header: t("rpt.colDescription"), render: (row) => <span className="text-subtle max-w-40 truncate block" title={row.description}>{row.description}</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.branchId} />,
    },
    {
      key: "by",
      header: t("exp.colBy"),
      render: (row) => <span className="text-faint text-[12px]">{row.createdByName || "—"}</span>,
    },
    { key: "voidReason", header: t("rpt.colVoidReason"), render: (row) => row.voidReason ? <span className="text-[12px] text-subtle max-w-32 truncate block" title={row.voidReason}>{row.voidReason}</span> : <span className="text-faint">—</span> },
  ];

  const detailedRefundColumns: Column<PeriodReport["detailedRefunds"]["items"][number]>[] = [
    {
      key: "date",
      header: t("rpt.colDate"),
      render: (row) => (
        <div>
          <span dir="ltr" className="tabnum text-subtle block">{formatDateShort(parseDateKey(row.createdAt.slice(0, 10)))} • {formatTime(row.createdAt)}</span>
          {row.refundNo && (
            <span dir="ltr" className="text-[10px] font-mono font-bold text-ink">
              {row.refundNo}
            </span>
          )}
        </div>
      ),
    },
    { key: "member", header: t("pay.colMember"), render: (row) => <span className="font-bold">{row.memberName}</span> },
    { key: "amount", header: t("exp.colAmount"), render: (row) => <span dir="ltr" className="font-extrabold tabnum text-amber">{formatMinor(row.amountMinor)}</span> },
    { key: "reason", header: t("rpt.colRefundReason"), render: (row) => <span className="text-[12px] text-subtle max-w-40 truncate block" title={row.reason}>{row.reason}</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.branchId} />,
    },
    {
      key: "by",
      header: t("pay.colBy"),
      render: (row) => <span className="text-faint text-[12px]">{row.createdByName || "—"}</span>,
    },
  ];

  const detailedVoidColumns: Column<PeriodReport["detailedVoids"]["items"][number]>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{formatDateShort(parseDateKey(row.voidedAt.slice(0, 10)))} • {formatTime(row.voidedAt)}</span> },
    { key: "member", header: t("pay.colMember"), render: (row) => <span className="font-bold">{row.memberName}</span> },
    { key: "amount", header: t("pay.colPaid"), render: (row) => <span dir="ltr" className="font-extrabold tabnum text-red">{formatMinor(row.amountMinor)}</span> },
    { key: "reason", header: t("rpt.colVoidReason"), render: (row) => <span className="text-[12px] text-subtle max-w-40 truncate block" title={row.voidReason}>{row.voidReason}</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.branchId} />,
    },
    {
      key: "by",
      header: t("pay.colBy"),
      render: (row) => <span className="text-faint text-[12px]">{row.voidedByName || "—"}</span>,
    },
  ];

  const branchSummaryColumns: Column<BranchFinancialSummary>[] = [
    {
      key: "branchName",
      header: t("rpt.colBranch"),
      render: (r) => (
        <div>
          <div className="font-bold text-ink">{r.branchName}</div>
          <div className="text-[11px] text-faint font-mono" dir="ltr">{r.branchId}</div>
        </div>
      ),
    },
    {
      key: "revenue",
      header: t("rpt.revenue"),
      render: (r) => (
        <span dir="ltr" className="font-extrabold tabnum text-emerald">
          {formatMinor(r.revenueMinor)}
        </span>
      ),
    },
    {
      key: "refunds",
      header: t("rpt.refunds"),
      render: (r) => (
        <span dir="ltr" className="tabnum text-amber-500">
          {formatMinor(r.refundsMinor)}
        </span>
      ),
    },
    {
      key: "expenses",
      header: t("rpt.expenses"),
      render: (r) => (
        <span dir="ltr" className="tabnum text-red">
          {formatMinor(r.expensesMinor)}
        </span>
      ),
    },
    {
      key: "net",
      header: t("rpt.netResult"),
      render: (r) => (
        <span dir="ltr" className={cn("font-extrabold tabnum", r.netResultMinor >= 0 ? "text-emerald" : "text-red")}>
          {formatMinor(r.netResultMinor)}
        </span>
      ),
    },
    {
      key: "count",
      header: t("rpt.paymentCount"),
      render: (r) => (
        <span className="tabnum text-subtle">{t("rpt.count", { count: r.paymentCount })}</span>
      ),
    },
  ];

  const cashSessionReportColumns: Column<PeriodReport["detailedCashSessions"][number]>[] = [
    {
      key: "period",
      header: t("rpt.colDate"),
      render: (r) => (
        <div className="flex flex-col text-xs">
          <span className="font-semibold text-foreground">
            {formatDateShort(parseDateKey(r.openedAt.slice(0, 10)))} • {formatTime(r.openedAt)}
          </span>
          {r.closedAt ? (
            <span className="text-[11px] text-subtle">
              إغلاق: {formatDateShort(parseDateKey(r.closedAt.slice(0, 10)))} • {formatTime(r.closedAt)}
            </span>
          ) : (
            <Badge variant="warning" dot className="w-fit mt-0.5 text-[10px]">
              مفتوحة حالياً
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "staff",
      header: "الموظفون المسؤولون",
      render: (r) => (
        <div className="flex flex-col text-xs">
          <span className="font-semibold text-foreground flex items-center gap-1">
            <span className="text-[10px] text-faint">استلام:</span> {r.openedByName}
          </span>
          {r.closedByName ? (
            <span className="text-subtle flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-amber">تسليم:</span> {r.closedByName}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "opening",
      header: "رصيد الافتتاح",
      render: (r) => (
        <span dir="ltr" className="tabnum text-subtle font-medium">
          {formatMinor(r.openingBalanceMinor)}
        </span>
      ),
    },
    {
      key: "expected",
      header: "المتوقع",
      render: (r) => (
        <span dir="ltr" className="tabnum font-bold">
          {r.expectedClosingMinor == null ? "—" : formatMinor(r.expectedClosingMinor)}
        </span>
      ),
    },
    {
      key: "counted",
      header: "المعدود الفعلي",
      render: (r) => (
        <span dir="ltr" className="tabnum font-bold">
          {r.countedClosingMinor == null ? "—" : formatMinor(r.countedClosingMinor)}
        </span>
      ),
    },
    {
      key: "diff",
      header: "الفارق / العجز",
      render: (r) => {
        if (r.differenceMinor == null) return <span className="text-faint">—</span>;
        if (r.differenceMinor === 0) {
          return <Badge variant="success">{t("rpt.shiftMatched")}</Badge>;
        }
        if (r.differenceMinor > 0) {
          return (
            <Badge variant="warning">
              <span dir="ltr" className="tabnum font-bold">
                {t("rpt.surplusBadge", { amount: formatMinor(r.differenceMinor) })}
              </span>
            </Badge>
          );
        }
        return (
          <div className="flex flex-col gap-0.5 items-start">
            <Badge variant="danger">
              <span dir="ltr" className="tabnum font-bold">
                {t("rpt.unexplainedShortageBadge", { amount: formatMinor(-r.differenceMinor) })}
              </span>
            </Badge>
            <span className="text-[10px] text-faint">
              {t("rpt.staffResponsibility", { name: r.openedByName })}
            </span>
          </div>
        );
      },
    },
    {
      key: "note",
      header: t("rpt.colDescription"),
      render: (r) =>
        r.closeNote ? (
          <span className="text-xs text-subtle max-w-44 truncate block" title={r.closeNote}>
            {r.closeNote}
          </span>
        ) : (
          <span className="text-faint text-xs">—</span>
        ),
    },
  ];

  if (!hasPermission("reports.view")) {
    return <EmptyState icon={<BarChart3 />} title={t("errors.forbidden")} />;
  }

  const activeRange = useMemo(
    () => ({
      ...(period === "custom" ? appliedCustom : rangeFor(period)),
      branchId: selectedBranch,
    }),
    [period, appliedCustom, selectedBranch],
  );

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{t("rpt.title")}</h2>
          <p className="mt-1 text-sm text-subtle">{t("rpt.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <Select
              label="الموظف / المسؤول"
              value={selectedUser}
              onChange={(e) => handleUserChange(e.target.value)}
              options={[
                { value: "all", label: "جميع الموظفين والمسؤولين" },
                ...users.map((u) => {
                  const roleLabel =
                    u.roleId === "owner"
                      ? " (المالك)"
                      : u.roleId === "manager"
                        ? " (المدير)"
                        : u.roleId === "reception"
                          ? " (استقبال)"
                          : u.roleId === "trainer"
                            ? " (مدرب)"
                            : "";
                  const codePrefix = u.userCode ? `[${u.userCode}] ` : "";
                  return {
                    value: u.id,
                    label: `${codePrefix}${u.fullName || u.username}${roleLabel}`,
                  };
                }),
              ]}
            />
          </div>
          <BranchFilter
            value={selectedBranch}
            onChange={handleBranchChange}
          />
        </div>
      </section>

      {/* Executive Dashboard Hub */}
      {report && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Card 1: Consolidated 5 Revenue Streams */}
          <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3.5 backdrop-blur-md transition-all duration-200 hover:border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-subtle">إيرادات الروافد الـ 5</span>
              <div className="size-6 rounded-lg bg-emerald-500/15 text-emerald-400 grid place-items-center">
                <TrendingUp className="size-3.5" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="tabnum font-mono text-2xl font-black text-emerald-400">
                {formatMinor(report.revenueMinor)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400/80">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>اشتراكات • متجر • PT • حصص • جلسات</span>
            </div>
          </div>

          {/* Card 2: Net Profit & Net Margin */}
          <div className="group relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-cyan-500/[0.04] p-3.5 backdrop-blur-md transition-all duration-200 hover:border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-subtle">صافي الأرباح</span>
              <div className="size-6 rounded-lg bg-cyan-500/15 text-cyan-400 grid place-items-center">
                <BarChart3 className="size-3.5" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="tabnum font-mono text-2xl font-black text-cyan-400">
                {formatMinor(report.incomeStatement.netProfitMinor)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-cyan-400/80">
              <Percent className="size-3" />
              <span>هامش صافي ربح: {report.incomeStatement.netMarginPercent}%</span>
            </div>
          </div>

          {/* Card 3: Member Growth & Transactions */}
          <div className="group relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-3.5 backdrop-blur-md transition-all duration-200 hover:border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-subtle">حركات الدفع والنمو</span>
              <div className="size-6 rounded-lg bg-amber-500/15 text-amber-400 grid place-items-center">
                <Users className="size-3.5" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="tabnum font-mono text-2xl font-black text-amber-400">
                {report.paymentCount}
              </span>
              <span className="text-[11px] text-subtle">حركة توريد</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-400/80">
              <span>متوسط السند: {formatMinor(report.avgTicketMinor)}</span>
            </div>
          </div>

          {/* Card 4: Net Liquidity */}
          <div className="group relative overflow-hidden rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-3.5 backdrop-blur-md transition-all duration-200 hover:border-violet-500/60 shadow-[0_0_15px_rgba(139,92,246,0.15)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-subtle">السيولة النقدية</span>
              <div className="size-6 rounded-lg bg-violet-500/15 text-violet-400 grid place-items-center">
                <Wallet className="size-3.5" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="tabnum font-mono text-xl font-black text-violet-400">
                {formatMinor(report.liquidity.netLiquidityMinor)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-violet-400/80">
              <Coins className="size-3" />
              <span>نقدية وخزائن وبنوك</span>
            </div>
          </div>

          {/* Card 5: Outstanding Debts */}
          <div className="group relative overflow-hidden rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-3.5 backdrop-blur-md transition-all duration-200 hover:border-rose-500/60 shadow-[0_0_15px_rgba(244,63,94,0.15)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-subtle">الديون والمستحقات</span>
              <div className="size-6 rounded-lg bg-rose-500/15 text-rose-400 grid place-items-center">
                <ReceiptText className="size-3.5" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="tabnum font-mono text-xl font-black text-rose-400">
                {formatMinor(report.receivables.totalReceivablesMinor)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-rose-400/80">
              <span>مستحقات معلقة بالسوق</span>
            </div>
          </div>
        </div>
      )}

      {/* Unified Glass Capsule Navigation Console */}
      <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#0F1420]/80 p-3 shadow-lg backdrop-blur-md">
        {/* Primary View Glass Capsules */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full bg-panel/60 backdrop-blur-md border border-panel-border/50">
          {VIEWS.map((v) => {
            const active = view === v.value;
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => setView(v.value as ReportView)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all duration-200",
                  active
                    ? "bg-neon/15 text-neon border border-neon/50 shadow-glow-sm"
                    : "text-subtle hover:text-ink hover:bg-white/[0.05] border border-transparent"
                )}
              >
                <span>{t(v.key)}</span>
              </button>
            );
          })}
        </div>

        {/* Period Glass Capsule Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full bg-surface/40 backdrop-blur-md border border-white/[0.06]">
          {PERIODS.map((p) => {
            const active = period === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value as PeriodValue)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200",
                  active
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/50 shadow-glow-sm"
                    : "text-subtle hover:text-ink hover:bg-white/[0.05] border border-transparent"
                )}
              >
                <span>{t(p.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {period === "custom" && (
        <Card className="max-w-xl">
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <Input
              label={t("rpt.from")}
              type="date"
              dir="ltr"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <Input
              label={t("rpt.to")}
              type="date"
              dir="ltr"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
            <Button onClick={() => setAppliedCustom({ fromKey: customFrom, toKey: customTo })}>
              {t("rpt.apply")}
            </Button>
          </div>
        </Card>
      )}

      {view === "finance" && (report === null ? (
        <EmptyState icon={<BarChart3 />} title={t("rpt.emptyRange")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F1420]/80 p-2.5 rounded-2xl border border-white/[0.08] backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full bg-surface/50 border border-white/[0.06]">
              {[
                { value: "overview", label: t("rpt.tabSubOverview") },
                { value: "streams", label: t("rpt.tabSubStreams") },
                { value: "receivables", label: t("rpt.tabSubReceivables") },
                { value: "liquidity", label: t("rpt.tabSubLiquidity") },
                { value: "details", label: t("rpt.tabSubDetails") },
              ].map((sub) => {
                const active = financeSubTab === sub.value;
                return (
                  <button
                    key={sub.value}
                    type="button"
                    onClick={() => setFinanceSubTab(sub.value as typeof financeSubTab)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all duration-200",
                      active
                        ? "bg-neon/15 text-neon border border-neon/50 shadow-glow-sm"
                        : "text-subtle hover:text-ink hover:bg-white/[0.05] border border-transparent"
                    )}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportCsv}
                icon={<FileSpreadsheet className="size-4" />}
                className="rounded-xl h-8 text-xs"
              >
                {t("rpt.exportExcel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPrintModalOpen(true)}
                icon={<Printer className="size-4" />}
                className="rounded-xl h-8 text-xs shadow-glow-sm"
              >
                {t("rpt.printReport")}
              </Button>
            </div>
          </div>

          {selectedBranch !== "all" && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neon/10 border border-neon/20 text-xs text-neon font-semibold">
              <Building2 className="size-4 shrink-0" />
              <span>{t("rpt.branchSingleNote", { branch: selectedBranch })}</span>
            </div>
          )}

          {/* SubTab 1: Overview & P&L */}
          {financeSubTab === "overview" && (
            <div className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title={t("rpt.revenue")}
                  subtitle={`${t("rpt.count", { count: report.paymentCount })}`}
                  value={formatMinor(report.revenueMinor)}
                  icon={<TrendingUp className="size-5" />}
                  accent="neon"
                />
                <StatCard
                  title={t("rpt.cogs")}
                  subtitle={t("rpt.cogsSubtitle")}
                  value={formatMinor(report.incomeStatement.cogsMinor)}
                  icon={<ShoppingBag className="size-5" />}
                  accent="amber"
                />
                <StatCard
                  title={t("rpt.grossProfit")}
                  subtitle={`هامش ربح إجمالي: ${report.incomeStatement.grossMarginPercent}%`}
                  value={formatMinor(report.incomeStatement.grossProfitMinor)}
                  icon={<Percent className="size-5" />}
                  accent={report.incomeStatement.grossProfitMinor >= 0 ? "emerald" : "red"}
                />
                <StatCard
                  title={t("rpt.expenses")}
                  value={formatMinor(report.expensesMinor)}
                  icon={<TrendingDown className="size-5" />}
                  accent="red"
                />
              </section>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title={t("rpt.netProfit")}
                  subtitle={`هامش صافي ربح: ${report.incomeStatement.netMarginPercent}%`}
                  value={formatMinor(report.incomeStatement.netProfitMinor)}
                  icon={<BarChart3 className="size-5" />}
                  accent={report.incomeStatement.netProfitMinor >= 0 ? "cyan" : "red"}
                />
                <StatCard
                  title={t("rpt.refunds")}
                  subtitle={`${t("rpt.avgTicket")}: ${formatMinor(report.avgTicketMinor)}`}
                  value={formatMinor(report.refundsMinor + report.incomeStatement.returnsMinor)}
                  icon={<ReceiptText className="size-5" />}
                  accent="amber"
                />
                <StatCard
                  title={t("rpt.totalReceivablesTitle")}
                  subtitle="مستحقات معلقة بالسوق"
                  value={formatMinor(report.receivables.totalReceivablesMinor)}
                  icon={<Coins className="size-5" />}
                  accent="violet"
                />
                <StatCard
                  title={t("rpt.netLiquidity")}
                  subtitle="نقدية ومحافظ وبنوك"
                  value={formatMinor(report.liquidity.netLiquidityMinor)}
                  icon={<Wallet className="size-5" />}
                  accent="neon"
                />
              </section>

              {/* Full P&L Table */}
              <Card>
                <CardHeader
                  title={t("rpt.incomeStatementTitle")}
                  description={t("rpt.incomeStatementSubtitle")}
                />
                <div className="px-5 pb-5">
                  <div className="border border-panel-border rounded-xl overflow-hidden divide-y divide-panel-border text-sm">
                    {/* 1. Operating Revenue */}
                    <div className="bg-panel-header/50 px-4 py-2.5 font-extrabold text-xs text-subtle tracking-wider uppercase">
                      1. الإيرادات التشغيلية المجمعة (Operating Revenue)
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.streamSubscriptions")}</span>
                      <span dir="ltr" className="font-mono font-bold text-ink">{formatMinor(report.incomeStatement.subscriptionsRevenueMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.streamStore")}</span>
                      <span dir="ltr" className="font-mono font-bold text-ink">{formatMinor(report.incomeStatement.storeSalesRevenueMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.streamStoreDebts")}</span>
                      <span dir="ltr" className="font-mono font-bold text-ink">{formatMinor(report.incomeStatement.storeDebtRepaymentsMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.streamQuickSessions")}</span>
                      <span dir="ltr" className="font-mono font-bold text-ink">{formatMinor(report.incomeStatement.quickSessionsRevenueMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.streamPrivateTraining")}</span>
                      <span dir="ltr" className="font-mono font-bold text-ink">{formatMinor(report.incomeStatement.privateTrainingRevenueMinor)}</span>
                    </div>
                    <div className="px-4 py-3 bg-neon/5 flex justify-between items-center font-extrabold text-base border-t border-neon/30">
                      <span className="text-foreground">إجمالي الإيرادات التشغيلية (Total Gross Revenue)</span>
                      <span dir="ltr" className="font-mono text-neon font-black">{formatMinor(report.incomeStatement.totalRevenueMinor)}</span>
                    </div>

                    {/* 2. COGS & Returns */}
                    <div className="bg-panel-header/50 px-4 py-2.5 font-extrabold text-xs text-subtle tracking-wider uppercase">
                      2. تكلفة المبيعات والمردودات (Cost of Sales & Deductions)
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.cogs")}</span>
                      <span dir="ltr" className="font-mono font-bold text-amber">-{formatMinor(report.incomeStatement.cogsMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">المبالغ المستردة ومردودات المتجر</span>
                      <span dir="ltr" className="font-mono font-bold text-amber">-{formatMinor(report.incomeStatement.refundsMinor + report.incomeStatement.returnsMinor)}</span>
                    </div>
                    <div className="px-4 py-3 bg-emerald-500/10 flex justify-between items-center font-extrabold text-base border-t border-emerald-500/30">
                      <div>
                        <span className="text-foreground">{t("rpt.grossProfit")}</span>
                        <span className="ms-2 text-xs font-bold text-emerald">({report.incomeStatement.grossMarginPercent}% هامش ربح إجمالي)</span>
                      </div>
                      <span dir="ltr" className="font-mono text-emerald font-black">{formatMinor(report.incomeStatement.grossProfitMinor)}</span>
                    </div>

                    {/* 3. Operating Expenses */}
                    <div className="bg-panel-header/50 px-4 py-2.5 font-extrabold text-xs text-subtle tracking-wider uppercase">
                      3. {t("rpt.operatingExpenses")}
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.salariesExpenses")}</span>
                      <span dir="ltr" className="font-mono font-medium text-subtle">{formatMinor(report.incomeStatement.salariesExpensesMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.rentUtilitiesExpenses")}</span>
                      <span dir="ltr" className="font-mono font-medium text-subtle">{formatMinor(report.incomeStatement.rentUtilitiesExpensesMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.maintenanceExpenses")}</span>
                      <span dir="ltr" className="font-mono font-medium text-subtle">{formatMinor(report.incomeStatement.maintenanceExpensesMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.suppliesExpenses")}</span>
                      <span dir="ltr" className="font-mono font-medium text-subtle">{formatMinor(report.incomeStatement.suppliesExpensesMinor)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                      <span className="text-foreground">{t("rpt.marketingExpenses")}</span>
                      <span dir="ltr" className="font-mono font-medium text-subtle">{formatMinor(report.incomeStatement.marketingExpensesMinor)}</span>
                    </div>
                    {report.incomeStatement.otherExpensesMinor > 0 && (
                      <div className="px-4 py-2.5 flex justify-between items-center hover:bg-panel-border/20">
                        <span className="text-foreground">{t("rpt.otherExpenses")}</span>
                        <span dir="ltr" className="font-mono font-medium text-subtle">{formatMinor(report.incomeStatement.otherExpensesMinor)}</span>
                      </div>
                    )}
                    <div className="px-4 py-3 bg-red-500/10 flex justify-between items-center font-extrabold text-base border-t border-red-500/30">
                      <span className="text-foreground">إجمالي المصروفات التشغيلية (Total Expenses)</span>
                      <span dir="ltr" className="font-mono text-red font-black">-{formatMinor(report.incomeStatement.totalExpensesMinor)}</span>
                    </div>

                    {/* 4. Net Operating Profit */}
                    <div className={`px-4 py-4 flex justify-between items-center font-black text-lg ${report.incomeStatement.netProfitMinor >= 0 ? "bg-emerald/15 text-emerald border-t-2 border-emerald" : "bg-red/15 text-red border-t-2 border-red"}`}>
                      <div>
                        <span className="text-foreground">{t("rpt.netProfit")}</span>
                        <span className="ms-3 text-xs font-bold opacity-80">({report.incomeStatement.netMarginPercent}% هامش صافي الربح)</span>
                      </div>
                      <span dir="ltr" className="font-mono text-xl">{formatMinor(report.incomeStatement.netProfitMinor)}</span>
                    </div>
                  </div>
                </div>
              </Card>

              {chartDataset && chartDataset.points.length > 0 && (
                <Card>
                  <CardHeader title={t("rpt.overTime")} />
                  <div className="px-4 pb-4">
                    <AttendanceChart dataset={chartDataset} />
                  </div>
                </Card>
              )}

              {selectedBranch === "all" && report.byBranch && report.byBranch.length > 0 && (
                <Card>
                  <CardHeader
                    title={t("rpt.branchBreakdownTitle")}
                    description={t("rpt.branchBreakdownSubtitle")}
                  />
                  <DataTable
                    columns={branchSummaryColumns}
                    data={report.byBranch}
                    rowKey={(r) => r.branchId}
                  />
                </Card>
              )}
            </div>
          )}

          {/* SubTab 2: Revenue Streams */}
          {financeSubTab === "streams" && (
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={t("rpt.streamsBreakdownTitle")}
                  description={t("rpt.streamsBreakdownSubtitle")}
                />
                <DataTable
                  columns={streamColumns}
                  data={report.streamsSummary}
                  rowKey={(r) => r.key}
                />
              </Card>

              <section className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader title={t("rpt.byMethodTitle")} />
                  {methodRows.length === 0 ? (
                    <EmptyState icon={<BarChart3 />} title={t("rpt.emptyRange")} />
                  ) : (
                    <DataTable columns={methodColumns} data={methodRows} rowKey={(r) => r.code} />
                  )}
                </Card>

                <Card>
                  <CardHeader title={t("rpt.byPlanTitle")} />
                  {planRows.length === 0 ? (
                    <EmptyState icon={<BarChart3 />} title={t("rpt.emptyRange")} />
                  ) : (
                    <DataTable columns={planColumns} data={planRows} rowKey={(r) => r.planId} />
                  )}
                </Card>
              </section>

              <Card>
                <CardHeader title={t("rpt.expensesByCategory")} />
                {categoryRows.length === 0 ? (
                  <EmptyState icon={<ReceiptText />} title={t("rpt.emptyRange")} />
                ) : (
                  <DataTable columns={categoryColumns} data={categoryRows} rowKey={(r) => r.categoryId} />
                )}
              </Card>
            </div>
          )}

          {/* SubTab 3: Receivables & Debts */}
          {financeSubTab === "receivables" && (
            <div className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title={t("rpt.totalReceivablesTitle")}
                  subtitle="إجمالي الأموال المعلقة بالسوق"
                  value={formatMinor(report.receivables.totalReceivablesMinor)}
                  icon={<Coins className="size-5" />}
                  accent="neon"
                />
                <StatCard
                  title={t("rpt.subscriptionsDebt")}
                  subtitle="متبقي الاشتراكات النشطة"
                  value={formatMinor(report.receivables.subscriptionsDebtMinor)}
                  icon={<TrendingUp className="size-5" />}
                  accent="amber"
                />
                <StatCard
                  title={t("rpt.storeDebt")}
                  subtitle="ديون المتجر والكافيتيريا"
                  value={formatMinor(report.receivables.storeDebtMinor)}
                  icon={<ShoppingBag className="size-5" />}
                  accent="red"
                />
                <StatCard
                  title={t("rpt.ptDebt")}
                  subtitle="متبقي التدريب الخاص"
                  value={formatMinor(report.receivables.privateTrainingDebtMinor)}
                  icon={<BarChart3 className="size-5" />}
                  accent="cyan"
                />
              </section>

              {/* Debt Aging Classification */}
              <Card>
                <CardHeader
                  title={t("rpt.debtAgingTitle")}
                  description="تصنيف الديون حسب الفترة الزمنية منذ استحقاقها للمتابعة والتحصيل الفوري"
                />
                <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
                  <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                    <p className="text-xs font-semibold text-emerald-400">{t("rpt.agingUnder30")}</p>
                    <p dir="ltr" className="text-xl font-black text-emerald mt-1">
                      {formatMinor(report.receivables.aging.under30DaysMinor)}
                    </p>
                    <p className="text-[11px] text-subtle mt-1">ديون جارية ضمن المهلة المعتادة</p>
                  </div>
                  <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                    <p className="text-xs font-semibold text-amber-400">{t("rpt.aging30To60")}</p>
                    <p dir="ltr" className="text-xl font-black text-amber mt-1">
                      {formatMinor(report.receivables.aging.from30To60DaysMinor)}
                    </p>
                    <p className="text-[11px] text-subtle mt-1">ديون متوسطة تتطلب تنبيه العضو</p>
                  </div>
                  <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                    <p className="text-xs font-semibold text-red-400">{t("rpt.agingOver60")}</p>
                    <p dir="ltr" className="text-xl font-black text-red mt-1">
                      {formatMinor(report.receivables.aging.over60DaysMinor)}
                    </p>
                    <p className="text-[11px] text-subtle mt-1">ديون متأخرة تستلزم المتابعة العاجلة</p>
                  </div>
                </div>
              </Card>

              {/* Top Debtors Table */}
              <Card>
                <CardHeader
                  title={t("rpt.topDebtorsTitle")}
                  description="الأعضاء الأكثر مديونية على مستوى الاشتراكات والمتجر وباقات التدريب"
                />
                {report.receivables.topDebtors.length === 0 ? (
                  <EmptyState icon={<CheckCircle2 />} title="لا توجد مديونيات معلقة مسجلة على الأعضاء" />
                ) : (
                  <DataTable
                    columns={debtorColumns}
                    data={report.receivables.topDebtors}
                    rowKey={(r) => r.memberId}
                  />
                )}
              </Card>
            </div>
          )}

          {/* SubTab 4: Liquidity & Cash Flow */}
          {financeSubTab === "liquidity" && (
            <div className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard
                  title={t("rpt.gymCash")}
                  subtitle="الخزينة النقدية الرئيسية"
                  value={formatMinor(report.liquidity.gymCashMinor)}
                  icon={<Banknote className="size-5" />}
                  accent="emerald"
                />
                <StatCard
                  title={t("rpt.storeCash")}
                  subtitle="خزينة المتجر والبوفيه"
                  value={formatMinor(report.liquidity.storeCashMinor)}
                  icon={<ShoppingBag className="size-5" />}
                  accent="amber"
                />
                <StatCard
                  title={t("rpt.wallets")}
                  subtitle="انستاباي / فودافون كاش"
                  value={formatMinor(report.liquidity.walletsMinor)}
                  icon={<Wallet className="size-5" />}
                  accent="violet"
                />
                <StatCard
                  title={t("rpt.bankCards")}
                  subtitle="البطاقات البنكية والفيزا"
                  value={formatMinor(report.liquidity.bankMinor)}
                  icon={<CreditCard className="size-5" />}
                  accent="cyan"
                />
                <StatCard
                  title={t("rpt.ownerWithdrawals")}
                  subtitle="مسحوبات نقدية للمالك"
                  value={formatMinor(report.liquidity.ownerWithdrawalsMinor)}
                  icon={<TrendingDown className="size-5" />}
                  accent="red"
                />
                <StatCard
                  title={t("rpt.netLiquidity")}
                  subtitle="إجمالي السيولة النقدية المتاحة"
                  value={formatMinor(report.liquidity.netLiquidityMinor)}
                  icon={<Coins className="size-5" />}
                  accent="neon"
                />
              </section>

              {report.cashSummary && (
                <Card>
                  <CardHeader
                    title="ملخص مطابقة الورديات والخزائن اليومية"
                    description="رصد دقيق للفروقات والعجز والمسحوبات أثناء تسليم وتسلم الورديات"
                  />
                  <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                      <p className="text-xs font-semibold text-red-400">{t("rpt.totalShortage")}</p>
                      <p dir="ltr" className="text-xl font-black text-red mt-1">
                        {formatMinor(report.cashSummary.totalShortageMinor)}
                      </p>
                      <p className="text-[11px] text-subtle mt-1">{t("rpt.unexplainedShortage")}</p>
                    </div>
                    <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs font-semibold text-amber-400">{t("rpt.totalSurplus")}</p>
                      <p dir="ltr" className="text-xl font-black text-amber mt-1">
                        {formatMinor(report.cashSummary.totalSurplusMinor)}
                      </p>
                      <p className="text-[11px] text-subtle mt-1">فائض مسجل عند الإغلاق</p>
                    </div>
                    <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
                      <p className="text-xs font-semibold text-cyan-400">{t("rpt.totalOwnerWithdrawals")}</p>
                      <p dir="ltr" className="text-xl font-black text-cyan mt-1">
                        {formatMinor(report.cashSummary.totalOwnerWithdrawalsMinor)}
                      </p>
                      <p className="text-[11px] text-subtle mt-1">مسحوبات نقدية معتمدة</p>
                    </div>
                    <div className="p-4 rounded-xl border border-violet-500/20 bg-violet-500/5">
                      <p className="text-xs font-semibold text-violet-400">{t("rpt.closedSessionsCount")}</p>
                      <p className="text-xl font-black text-violet-400 mt-1">
                        {report.cashSummary.closedSessionsCount}
                      </p>
                      <p className="text-[11px] text-subtle mt-1">إجمالي الورديات المكتملة</p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* SubTab 5: Detailed Transactions */}
          {financeSubTab === "details" && (
            <div className="space-y-5">
              <Card>
                <CardHeader title={t("rpt.detailPayments")} description={`${report.detailedPayments.total} عملية`} />
                {report.detailedPayments.items.length === 0 ? (
                  <EmptyState icon={<Banknote />} title={t("rpt.emptyRange")} />
                ) : (
                  <DataTable columns={detailedPaymentColumns} data={report.detailedPayments.items} rowKey={(r) => r.id} />
                )}
                <div className="px-4 pb-4">
                  <Pagination
                    page={detailPages.payments}
                    pageSize={DETAIL_PAGE_SIZE}
                    total={report.detailedPayments.total}
                    onPageChange={(page) => setDetailPages((p) => ({ ...p, payments: page }))}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title={t("rpt.detailExpenses")} description={`${report.detailedExpenses.total} مصروف`} />
                {report.detailedExpenses.items.length === 0 ? (
                  <EmptyState icon={<TrendingDown />} title={t("rpt.emptyRange")} />
                ) : (
                  <DataTable columns={detailedExpenseColumns} data={report.detailedExpenses.items} rowKey={(r) => r.id} />
                )}
                <div className="px-4 pb-4">
                  <Pagination
                    page={detailPages.expenses}
                    pageSize={DETAIL_PAGE_SIZE}
                    total={report.detailedExpenses.total}
                    onPageChange={(page) => setDetailPages((p) => ({ ...p, expenses: page }))}
                  />
                </div>
              </Card>

              {report.detailedRefunds.total > 0 && (
                <Card>
                  <CardHeader title={t("rpt.detailRefunds")} description={`${report.detailedRefunds.total} استرداد`} />
                  <DataTable columns={detailedRefundColumns} data={report.detailedRefunds.items} rowKey={(r) => r.id} />
                  <div className="px-4 pb-4">
                    <Pagination
                      page={detailPages.refunds}
                      pageSize={DETAIL_PAGE_SIZE}
                      total={report.detailedRefunds.total}
                      onPageChange={(page) => setDetailPages((p) => ({ ...p, refunds: page }))}
                    />
                  </div>
                </Card>
              )}

              {report.detailedVoids.total > 0 && (
                <Card>
                  <CardHeader title={t("rpt.detailVoids")} description={`${report.detailedVoids.total} إلغاء`} />
                  <DataTable columns={detailedVoidColumns} data={report.detailedVoids.items} rowKey={(r) => r.id} />
                  <div className="px-4 pb-4">
                    <Pagination
                      page={detailPages.voids}
                      pageSize={DETAIL_PAGE_SIZE}
                      total={report.detailedVoids.total}
                      onPageChange={(page) => setDetailPages((p) => ({ ...p, voids: page }))}
                    />
                  </div>
                </Card>
              )}

              {report.detailedCashSessions && report.detailedCashSessions.length > 0 && (
                <Card>
                  <CardHeader
                    title={t("rpt.cashSessionsTitle")}
                    description={t("rpt.cashSessionsDesc")}
                  />
                  <DataTable
                    columns={cashSessionReportColumns}
                    data={report.detailedCashSessions}
                    rowKey={(r) => r.id}
                  />
                </Card>
              )}
            </div>
          )}

          {/* Official Printable Report Modal */}
          <Modal
            open={printModalOpen}
            onClose={() => setPrintModalOpen(false)}
            title={t("rpt.printPreviewModalTitle")}
            widthClass="max-w-4xl"
          >
            <div className="space-y-6">
              <div className="print-report-container p-6 border border-panel-border rounded-xl bg-panel text-foreground">
                <style>{`
                  @media print {
                    body * {
                      visibility: hidden !important;
                    }
                    .print-report-container, .print-report-container * {
                      visibility: visible !important;
                    }
                    .print-report-container {
                      position: absolute !important;
                      left: 0 !important;
                      top: 0 !important;
                      width: 100% !important;
                      margin: 0 !important;
                      padding: 20px !important;
                      background: white !important;
                      color: black !important;
                      border: none !important;
                    }
                  }
                `}</style>
                {/* Printable Header */}
                <div className="flex items-start justify-between border-b border-panel-border pb-4 mb-4">
                  <div>
                    <h2 className="text-xl font-black text-foreground">
                      {t("rpt.printOfficialHeader")}
                    </h2>
                    <p className="text-sm text-subtle mt-1">
                      الفترة من: <span dir="ltr" className="font-bold">{activeRange.fromKey}</span> إلى: <span dir="ltr" className="font-bold">{activeRange.toKey}</span>
                      {selectedBranch !== "all" && <span className="ms-3 font-semibold text-neon">({selectedBranch})</span>}
                    </p>
                  </div>
                  <div className="text-left text-xs text-subtle">
                    <p className="font-bold text-foreground">GymGate Management System</p>
                    <p className="tabnum">{new Date().toLocaleString("ar-EG")}</p>
                  </div>
                </div>

                {/* Executive Summary */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  <div className="p-3 border border-panel-border rounded-lg bg-panel-header/30 text-center">
                    <p className="text-xs text-subtle font-semibold">إجمالي الإيرادات</p>
                    <p dir="ltr" className="text-lg font-black text-emerald mt-1">{formatMinor(report.revenueMinor)}</p>
                  </div>
                  <div className="p-3 border border-panel-border rounded-lg bg-panel-header/30 text-center">
                    <p className="text-xs text-subtle font-semibold">المصروفات التشغيلية</p>
                    <p dir="ltr" className="text-lg font-black text-red mt-1">{formatMinor(report.expensesMinor)}</p>
                  </div>
                  <div className="p-3 border border-panel-border rounded-lg bg-panel-header/30 text-center">
                    <p className="text-xs text-subtle font-semibold">صافي الربح الحقيقي</p>
                    <p dir="ltr" className="text-lg font-black text-neon mt-1">{formatMinor(report.incomeStatement.netProfitMinor)}</p>
                  </div>
                  <div className="p-3 border border-panel-border rounded-lg bg-panel-header/30 text-center">
                    <p className="text-xs text-subtle font-semibold">المستحقات المعلقة</p>
                    <p dir="ltr" className="text-lg font-black text-amber mt-1">{formatMinor(report.receivables.totalReceivablesMinor)}</p>
                  </div>
                </div>

                {/* P&L Condensed Table */}
                <div className="border border-panel-border rounded-lg overflow-hidden mb-6 text-xs divide-y divide-panel-border">
                  <div className="bg-panel-header px-3 py-2 font-bold text-foreground">قائمة الدخل والأداء المالي (P&L Summary)</div>
                  <div className="px-3 py-1.5 flex justify-between">
                    <span>إيرادات الاشتراكات والتجديدات</span>
                    <span dir="ltr" className="font-mono font-bold">{formatMinor(report.incomeStatement.subscriptionsRevenueMinor)}</span>
                  </div>
                  <div className="px-3 py-1.5 flex justify-between">
                    <span>مبيعات المتجر والكافيتيريا وسداد الديون</span>
                    <span dir="ltr" className="font-mono font-bold">{formatMinor(report.incomeStatement.storeSalesRevenueMinor + report.incomeStatement.storeDebtRepaymentsMinor)}</span>
                  </div>
                  <div className="px-3 py-1.5 flex justify-between">
                    <span>الزيارات السريعة وتذاكر الدخول اليومي</span>
                    <span dir="ltr" className="font-mono font-bold">{formatMinor(report.incomeStatement.quickSessionsRevenueMinor)}</span>
                  </div>
                  <div className="px-3 py-1.5 flex justify-between">
                    <span>باقات التدريب الخاص (PT)</span>
                    <span dir="ltr" className="font-mono font-bold">{formatMinor(report.incomeStatement.privateTrainingRevenueMinor)}</span>
                  </div>
                  <div className="px-3 py-2 bg-emerald/5 flex justify-between font-bold border-t border-emerald/20">
                    <span>مجمل الربح التشغيلي (Gross Profit)</span>
                    <span dir="ltr" className="font-mono text-emerald">{formatMinor(report.incomeStatement.grossProfitMinor)} ({report.incomeStatement.grossMarginPercent}%)</span>
                  </div>
                  <div className="px-3 py-2 bg-red/5 flex justify-between font-bold border-t border-red/20">
                    <span>إجمالي المصروفات التشغيلية والعمومية</span>
                    <span dir="ltr" className="font-mono text-red">-{formatMinor(report.incomeStatement.totalExpensesMinor)}</span>
                  </div>
                  <div className="px-3 py-2.5 bg-neon/10 flex justify-between font-black text-sm border-t border-neon/30">
                    <span>صافي الربح النهائي للنشاط (Net Profit)</span>
                    <span dir="ltr" className="font-mono text-neon">{formatMinor(report.incomeStatement.netProfitMinor)} ({report.incomeStatement.netMarginPercent}%)</span>
                  </div>
                </div>

                {/* Streams Summary */}
                <div className="border border-panel-border rounded-lg overflow-hidden mb-6 text-xs divide-y divide-panel-border">
                  <div className="bg-panel-header px-3 py-2 font-bold text-foreground">توزيع روافد الدخل والتحصيلات</div>
                  {report.streamsSummary.map((s) => (
                    <div key={s.key} className="px-3 py-1.5 flex justify-between">
                      <span>{s.labelAr} ({s.paymentCount} عملية)</span>
                      <span dir="ltr" className="font-mono font-bold">{formatMinor(s.revenueMinor)} ({s.percentage}%)</span>
                    </div>
                  ))}
                </div>

                {/* Official Signatures */}
                <div className="grid grid-cols-2 gap-8 pt-8 mt-6 border-t border-dashed border-panel-border text-center text-xs">
                  <div>
                    <p className="font-bold text-foreground mb-12">{t("rpt.accountantSignature")}</p>
                    <div className="border-t border-panel-border/60 mx-12"></div>
                  </div>
                  <div>
                    <p className="font-bold text-foreground mb-12">{t("rpt.managerSignature")}</p>
                    <div className="border-t border-panel-border/60 mx-12"></div>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => setPrintModalOpen(false)}>
                  {t("common.close")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    window.print();
                  }}
                  icon={<Printer className="size-4" />}
                >
                  طباعة الآن (A4)
                </Button>
              </div>
            </div>
          </Modal>
        </>
      ))}

      {view === "attendance" && (
        <AttendanceReportView range={activeRange} />
      )}

      {view === "retention" && (
        <RetentionView range={activeRange} />
      )}

      {view === "staff" && (
        <StaffActivityView actor={actor} range={activeRange} />
      )}
    </div>
  );
}

function AttendanceReportView({ range }: { range: { fromKey: string; toKey: string; branchId?: string } }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [analytics, setAnalytics] = useState<AttendanceAnalytics | null>(null);
  const [heatmap, setHeatmap] = useState<PeakHoursHeatmapData | null>(null);

  useEffect(() => {
    if (!actor || !hasPermission("checkin.view_history")) return;
    let alive = true;
    api.reports
      .attendanceAnalytics(range)
      .then((a) => {
        if (alive) setAnalytics(a);
      })
      .catch((err) => {
        console.error(err);
        if (alive) setAnalytics(null);
      });

    api.reports
      .peakHoursHeatmap(range)
      .then((h) => {
        if (alive) setHeatmap(h);
      })
      .catch((err) => {
        console.error(err);
        if (alive) setHeatmap(null);
      });

    return () => {
      alive = false;
    };
  }, [actor, hasPermission, range]);

  if (!analytics) return <EmptyState icon={<CalendarCheck />} title={t("rpt.emptyRange")} />;

  const chartDataset: ChartDataset = {
    mode: "bars",
    points: analytics.daily.map((d) => ({ label: d.date.slice(5), value: d.count })),
  };

  const maxHour = Math.max(1, ...analytics.peakHours.map((h) => h.count));

  const visitColumns: Column<MemberVisitRow>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (row) => (
        <span>
          <span className="block font-bold">{row.memberName}</span>
          <span dir="ltr" className="block text-[11px] text-faint">{row.memberCode}</span>
        </span>
      ),
    },
    {
      key: "visits",
      header: t("rpt.visits"),
      render: (row) => <span className="font-extrabold tabnum text-neon">{row.visits}</span>,
    },
    {
      key: "last",
      header: t("rpt.lastVisit"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">{row.lastVisitAt ? `${formatDateShort(parseDateKey(row.lastVisitAt.slice(0, 10)))} • ${formatTime(row.lastVisitAt)}` : "—"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title={t("rpt.visits")}
          value={String(analytics.visits)}
          icon={<CalendarCheck className="size-5" />}
          accent="neon"
          subtitle={`${t("rpt.uniqueMembers")}: ${analytics.uniqueMembers}`}
        />
        <StatCard
          title={t("rpt.peakDay")}
          value={
            analytics.daily.length > 0
              ? [...analytics.daily].sort((a, b) => b.count - a.count)[0].date
              : "—"
          }
          icon={<Clock3 className="size-5" />}
          accent="cyan"
          subtitle={`${t("rpt.visitsPerDayAvg")}: ${
            analytics.daily.length > 0
              ? Math.round(analytics.visits / analytics.daily.length)
              : 0
          }`}
        />
      </section>

      {analytics.daily.length > 0 && (
        <Card>
          <CardHeader title={t("rpt.overTime")} />
          <div className="px-4 pb-4">
            <AttendanceChart dataset={chartDataset} />
          </div>
        </Card>
      )}

      {/* 7x24 Peak Hours Heatmap */}
      {heatmap && heatmap.totalVisits > 0 && (
        <Card>
          <CardHeader
            title="خريطة أوقات الذروة وازدحام الجيم (Peak Hours Heatmap)"
            description={`توزيع زيارات الأعضاء على مدار ساعات اليوم وأيام الأسبوع (أكثر الأيام ازدحاماً: ${
              ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][
                heatmap.busiestDayOfWeek
              ]
            }، أكثر الساعات: ${String(heatmap.busiestHour).padStart(2, "0")}:00)`}
          />
          <div className="p-5 overflow-x-auto">
            <div className="min-w-[700px] space-y-2">
              <div className="grid grid-cols-[80px_repeat(24,1fr)] gap-1 text-[10px] text-faint text-center">
                <span className="text-start font-bold">اليوم \ الساعة</span>
                {Array.from({ length: 24 }).map((_, h) => (
                  <span key={h} dir="ltr" className="tabnum font-mono">
                    {h}
                  </span>
                ))}
              </div>

              {["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map(
                (dayName, dow) => {
                  const dayCells = heatmap.matrix.filter((m) => m.dayOfWeek === dow);
                  return (
                    <div
                      key={dow}
                      className="grid grid-cols-[80px_repeat(24,1fr)] gap-1 items-center"
                    >
                      <span className="text-xs font-bold text-subtle text-start">{dayName}</span>
                      {Array.from({ length: 24 }).map((_, hour) => {
                        const cell = dayCells.find((c) => c.hour === hour);
                        const count = cell?.count ?? 0;
                        const intensity =
                          heatmap.maxCount > 0 ? count / heatmap.maxCount : 0;
                        const bgStyle =
                          count === 0
                            ? "bg-white/[0.02] border-line/40 text-transparent"
                            : intensity > 0.75
                              ? "bg-neon text-background font-black border-neon"
                              : intensity > 0.5
                                ? "bg-neon/60 text-foreground font-bold border-neon/70"
                                : intensity > 0.25
                                  ? "bg-neon/30 text-foreground border-neon/40"
                                  : "bg-neon/10 text-subtle border-neon/20";

                        return (
                          <div
                            key={hour}
                            title={`${dayName} الساعة ${hour}:00 — ${count} زيارة`}
                            className={`h-7 rounded flex items-center justify-center text-[10px] border transition-all hover:scale-110 cursor-default select-none ${bgStyle}`}
                          >
                            {count > 0 ? count : ""}
                          </div>
                        );
                      })}
                    </div>
                  );
                },
              )}

              <div className="flex items-center justify-end gap-3 pt-3 text-[11px] text-subtle">
                <span>تدرج الازدحام:</span>
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded bg-white/[0.02] border border-line" /> هادئ
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded bg-neon/30 border border-neon/40" /> متوسط
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded bg-neon border border-neon" /> ذروة
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t("rpt.peakHoursTitle")} />
        {analytics.peakHours.length === 0 ? (
          <EmptyState icon={<Clock3 />} title={t("rpt.emptyRange")} />
        ) : (
          <ul className="space-y-2 p-5">
            {analytics.peakHours.map((h) => (
              <li key={h.hour} className="flex items-center gap-3">
                <span dir="ltr" className="w-14 shrink-0 text-end font-bold tabnum">
                  {String(h.hour).padStart(2, "0")}:00
                </span>
                <span aria-hidden className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className="block h-full rounded-full bg-neon/70"
                    style={{ width: `${Math.max(6, Math.round((h.count / maxHour) * 100))}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 font-bold tabnum text-subtle">{h.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("rpt.topMembers")} />
          {analytics.topMembers.length === 0 ? (
            <EmptyState icon={<Users />} title={t("rpt.emptyRange")} />
          ) : (
            <DataTable columns={visitColumns} data={analytics.topMembers} rowKey={(r) => r.memberId} />
          )}
        </Card>
        <Card>
          <CardHeader title={t("rpt.leastMembers")} description={t("rpt.leastMembersHint")} />
          {analytics.leastMembers.length === 0 ? (
            <EmptyState icon={<Users />} title={t("rpt.emptyRange")} />
          ) : (
            <DataTable columns={visitColumns} data={analytics.leastMembers} rowKey={(r) => r.memberId} />
          )}
        </Card>
      </section>
    </div>
  );
}

function RetentionView({ range }: { range: { fromKey: string; toKey: string; branchId?: string } }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [data, setData] = useState<RetentionInsights | null>(null);

  useEffect(() => {
    if (!actor || !hasPermission("reports.view")) return;
    let alive = true;
    api.reports
      .retentionInsights(range)
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((err) => {
        console.error(err);
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, [actor, hasPermission, range]);

  if (!data) return <EmptyState icon={<UserRoundX />} title={t("rpt.emptyRange")} />;

  const inactiveColumns: Column<InactiveMemberRow>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (row) => (
        <span>
          <span className="block font-bold">{row.memberName}</span>
          <span dir="ltr" className="block text-[11px] text-faint">{row.memberCode}</span>
        </span>
      ),
    },
    {
      key: "department",
      header: t("rpt.department"),
      render: (row) => (
        <span className="text-subtle">
          {row.department === "men"
            ? t("members.deptMen")
            : row.department === "women"
              ? t("members.deptWomen")
              : t("members.deptGeneral")}
        </span>
      ),
    },
    {
      key: "lastVisit",
      header: t("rpt.lastVisit"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">{row.lastVisitAt ? `${formatDateShort(parseDateKey(row.lastVisitAt.slice(0, 10)))} • ${formatTime(row.lastVisitAt)}` : "—"}</span>
      ),
    },
    {
      key: "days",
      header: t("rpt.daysSinceVisit"),
      render: (row) => (
        <span className="font-extrabold tabnum text-red">{t("rpt.dayUnit", { count: row.daysSinceLastVisit })}</span>
      ),
    },
  ];

  const dowLabels: Record<number, string> = {
    0: t("dow.day0"),
    1: t("dow.day1"),
    2: t("dow.day2"),
    3: t("dow.day3"),
    4: t("dow.day4"),
    5: t("dow.day5"),
    6: t("dow.day6"),
  };
  const maxDow = Math.max(1, ...data.byDayOfWeek.map((d) => d.count));
  const maxDept = Math.max(1, ...data.byDepartment.map((d) => d.count));

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("rpt.retentionInactive")}
          value={String(data.inactiveWithActiveSub)}
          icon={<UserRoundX className="size-5" />}
          accent="red"
          subtitle={`${t("rpt.inactiveThreshold")}: ${data.inactiveThresholdDays} ${t("rpt.dayUnit", { count: data.inactiveThresholdDays })}`}
        />
        <StatCard
          title={t("rpt.retentionNewVisitors")}
          value={String(data.visitorSplit.newMembers)}
          icon={<Repeat className="size-5" />}
          accent="neon"
          subtitle={`${t("rpt.retentionReturning")}: ${data.visitorSplit.returning}`}
        />
        <StatCard
          title={t("rpt.retentionAvgCheckins")}
          value={String(data.avgCheckinsPerVisitingMember)}
          icon={<CalendarCheck className="size-5" />}
          accent="cyan"
          subtitle={`${t("rpt.uniqueMembers")}: ${data.visitorSplit.newMembers + data.visitorSplit.returning}`}
        />
        <StatCard
          title={t("rpt.visits")}
          value={String(data.totalVisitors)}
          icon={<CalendarDays className="size-5" />}
          accent="amber"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("rpt.dayOfWeekTitle")} />
          {data.byDayOfWeek.every((d) => d.count === 0) ? (
            <EmptyState icon={<CalendarDays />} title={t("rpt.emptyRange")} />
          ) : (
            <ul className="space-y-2 p-5">
              {data.byDayOfWeek.map((p: DayOfWeekPoint) => (
                <li key={p.dow} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 font-bold">{dowLabels[p.dow]}</span>
                  <span aria-hidden className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <span
                      className="block h-full rounded-full bg-neon/70"
                      style={{ width: `${Math.max(6, Math.round((p.count / maxDow) * 100))}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 font-bold tabnum text-subtle">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t("rpt.departmentSplitTitle")} />
          {data.byDepartment.length === 0 ? (
            <EmptyState icon={<Layers />} title={t("rpt.emptyRange")} />
          ) : (
            <ul className="space-y-2 p-5">
              {data.byDepartment.map((p: DepartmentPoint) => (
                <li key={p.department} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 font-bold">
                    {p.department === "men"
                      ? t("members.deptMen")
                      : p.department === "women"
                        ? t("members.deptWomen")
                        : t("members.deptGeneral")}
                  </span>
                  <span aria-hidden className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <span
                      className="block h-full rounded-full bg-cyan/70"
                      style={{ width: `${Math.max(6, Math.round((p.count / maxDept) * 100))}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 font-bold tabnum text-subtle">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <Card>
        <CardHeader
          title={t("rpt.inactiveListTitle")}
          description={t("rpt.inactiveListHint")}
        />
        {data.inactiveMembers.length === 0 ? (
          <EmptyState icon={<UserRoundX />} title={t("rpt.inactiveListEmpty")} />
        ) : (
          <DataTable columns={inactiveColumns} data={data.inactiveMembers} rowKey={(r) => r.memberId} />
        )}
      </Card>
    </div>
  );
}

function StaffActivityView({
  actor,
  range,
}: {
  actor: ServiceActor | null;
  range: { fromKey: string; toKey: string; branchId?: string };
}) {
  const t = useT();
  const [entries, setEntries] = useState<StaffActivityEntry[] | null>(null);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    api.reports
      .staffActivity(range)
      .then((result) => {
        if (alive) setEntries(result.entries);
      })
      .catch((err) => {
        console.error(err);
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [actor, range]);

  const columns: Column<StaffActivityEntry>[] = [
    {
      key: "user",
      header: t("users.fullName"),
      render: (row) => <span className="font-bold">{row.userName}</span>,
    },
    {
      key: "action",
      header: t("audit.colAction"),
      render: (row) => (
        <span dir="ltr" className="rounded-lg bg-white/5 px-2 py-1 font-mono text-[11px] font-bold text-subtle">
          {row.action}
        </span>
      ),
    },
    {
      key: "count",
      header: t("rpt.actionCount"),
      render: (row) => <span className="font-extrabold tabnum">{formatNumber(row.count)}</span>,
    },
    {
      key: "lastAt",
      header: t("rpt.lastAction"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">{formatDateShort(parseDateKey(row.lastAt.slice(0, 10)))} • {formatTime(row.lastAt)}</span>
      ),
    },
  ];

  if (!entries || entries.length === 0) {
    return <EmptyState icon={<ScrollText />} title={t("rpt.staffEmpty")} />;
  }

  return (
    <Card>
      <CardHeader title={t("rpt.tabStaff")} description={`${t("rpt.totalActions")}: ${formatNumber(entries.reduce((s, e) => s + e.count, 0))}`} />
      <DataTable columns={columns} data={entries} rowKey={(r) => `${r.userId ?? "-"}-${r.action}`} />
    </Card>
  );
}
