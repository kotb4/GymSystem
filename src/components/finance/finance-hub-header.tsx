import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  BarChart3,
  Coins,
  CreditCard,
  ReceiptText,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  ShieldCheck,
  LockKeyhole,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { cn } from "@/utils/cn";
import { ZReportModal } from "@/components/finance/z-report-modal";

export interface FinanceHubHeaderProps {
  currentSection?: "treasury" | "payments" | "expenses" | "debts" | "reports";
  onSessionClosed?: () => void;
  showNav?: boolean;
}

export function FinanceHubHeader({ currentSection = "treasury", onSessionClosed, showNav = false }: FinanceHubHeaderProps) {
  const { hasPermission } = useAuth();

  const canTreasury = hasPermission("payments.view");
  const canExpenses = hasPermission("expenses.view");
  const canDebts = hasPermission("debts.view");
  const canReports = hasPermission("reports.view");
  const canCashClose = hasPermission("cash.close");

  const [zReportOpen, setZReportOpen] = useState(false);

  const [metrics, setMetrics] = useState({
    gymCashMinor: 0,
    storeCashMinor: 0,
    netLiquidityMinor: 0,
    todayRevenueMinor: 0,
    todayExpensesMinor: 0,
    todayNetMinor: 0,
    totalDebtsMinor: 0,
    openSession: false,
    openSessionClosingNo: null as string | null,
    expectedCashMinor: 0,
    todayDiscrepancyMinor: 0,
    closedSessionsCount: 0,
  });

  const loadMetrics = useCallback(async () => {
    try {
      const today = todayKey();
      const [periodRes, cashSessionRes, debtsRes, openTotalsRes, todaySessionsRes] = await Promise.all([
        canReports ? api.reports.period(today, today).catch(() => null) : Promise.resolve(null),
        api.cash.openSession().catch(() => null),
        canDebts ? api.debts.list({ limit: 1 }).catch(() => null) : Promise.resolve(null),
        canTreasury ? api.cash.openTotals().catch(() => null) : Promise.resolve(null),
        canReports ? api.cash.list({ fromKey: today, toKey: today, status: "closed", pageSize: 50 }).catch(() => null) : Promise.resolve(null),
      ]);

      const gymCash = periodRes?.liquidity?.gymCashMinor ?? 0;
      const storeCash = periodRes?.liquidity?.storeCashMinor ?? 0;
      const netLiquidity = periodRes?.liquidity?.netLiquidityMinor ?? (gymCash + storeCash);
      const todayRev = periodRes?.revenueMinor ?? 0;
      const todayExp = periodRes?.expensesMinor ?? 0;
      const todayNet = periodRes?.netResultMinor ?? (todayRev - todayExp);
      const totalDebts = debtsRes?.totalDebtMinor ?? (periodRes?.receivables?.totalReceivablesMinor ?? 0);

      const typedTotals = openTotalsRes as { expectedMinor?: number } | null;
      const expectedCash = typedTotals?.expectedMinor ?? (cashSessionRes ? gymCash : 0);

      // Compute total discrepancy from today's closed sessions
      const closedItems = todaySessionsRes?.items ?? [];
      const todayDiscrepancy = closedItems.reduce((acc: number, item) => acc + (item.differenceMinor ?? 0), 0);

      setMetrics({
        gymCashMinor: gymCash,
        storeCashMinor: storeCash,
        netLiquidityMinor: netLiquidity,
        todayRevenueMinor: todayRev,
        todayExpensesMinor: todayExp,
        todayNetMinor: todayNet,
        totalDebtsMinor: totalDebts,
        openSession: Boolean(cashSessionRes),
        openSessionClosingNo: cashSessionRes?.closingNo ?? null,
        expectedCashMinor: expectedCash,
        todayDiscrepancyMinor: todayDiscrepancy,
        closedSessionsCount: closedItems.length,
      });
    } catch {
      // fallback
    }
  }, [canReports, canDebts, canTreasury]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const handleZReportSuccess = () => {
    void loadMetrics();
    onSessionClosed?.();
  };

  // Main Finance Navigation Capsules
  const navCapsules = [
    ...(canTreasury
      ? [
          {
            key: "treasury",
            path: "/treasury",
            label: "الخزينة والورديات (Z-Report)",
            icon: Wallet,
            badge: metrics.openSession ? "مفتوحة 🟢" : "مغلقة",
            badgeTone: metrics.openSession ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-700/40 text-zinc-400",
          },
          {
            key: "payments",
            path: "/payments",
            label: "سجل المدفوعات والتحصيل",
            icon: Banknote,
          },
        ]
      : []),
    ...(canExpenses
      ? [
          {
            key: "expenses",
            path: "/expenses",
            label: "المصروفات وسندات الصرف",
            icon: ReceiptText,
          },
        ]
      : []),
    ...(canDebts
      ? [
          {
            key: "debts",
            path: "/debts",
            label: "ديون ومستحقات الأعضاء",
            icon: Scale,
            badge: metrics.totalDebtsMinor > 0 ? formatMinor(metrics.totalDebtsMinor) : undefined,
            badgeTone: "bg-rose-500/20 text-rose-400 font-mono",
          },
        ]
      : []),
    ...(canReports
      ? [
          {
            key: "reports",
            path: "/reports",
            label: "التقارير المالية والسيولة",
            icon: BarChart3,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* 1. Live Interactive Telemetry Strip (6 Cards) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Card 1: Vault Cash Balance */}
        <Link
          to="/treasury"
          className={cn(
            "flex flex-col gap-1 rounded-2xl border p-3.5 text-start transition-all duration-200 backdrop-blur-md",
            currentSection === "treasury"
              ? "border-neon/60 bg-neon/10 shadow-sm shadow-neon/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface",
          )}
        >
          <div className="flex items-center justify-between text-neon">
            <span className="text-[11px] font-semibold">رصيد الخزينة المباشر</span>
            <span className="relative flex size-2.5">
              {metrics.openSession && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={cn(
                  "relative inline-flex size-2.5 rounded-full",
                  metrics.openSession ? "bg-emerald-500" : "bg-zinc-600",
                )}
              ></span>
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span dir="ltr" className="text-xl font-black tabnum text-neon">
              {formatMinor(metrics.gymCashMinor)}
            </span>
            <span className="text-[10px] font-bold text-white">ج.م</span>
          </div>
          <span className="text-[10px] text-subtle">
            {metrics.openSession ? "الوردية مفتوحة بالدرج" : "الخزينة مغلقة حالياً"}
          </span>
        </Link>

        {/* Card 2: Expected vs Counted / Discrepancy Metric (Elevated to top strip) */}
        <button
          type="button"
          onClick={() => setZReportOpen(true)}
          className={cn(
            "flex flex-col gap-1 rounded-2xl border p-3.5 text-start transition-all duration-200 backdrop-blur-md cursor-pointer group",
            metrics.todayDiscrepancyMinor < 0
              ? "border-rose-500/50 bg-rose-500/10 hover:border-rose-500/80"
              : metrics.todayDiscrepancyMinor > 0
              ? "border-amber-500/50 bg-amber-500/10 hover:border-amber-500/80"
              : "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/60",
          )}
          title="انقر لفتح نافذة تقفيل الوردية وجرد الدرج الفوري (Z-Report)"
        >
          <div className="flex items-center justify-between text-white">
            <span className="text-[11px] font-semibold flex items-center gap-1">
              <span>المتوقع مقابل الفعلي</span>
            </span>
            <ShieldCheck
              className={cn(
                "size-4 transition-transform group-hover:scale-110",
                metrics.todayDiscrepancyMinor < 0
                  ? "text-rose-400"
                  : metrics.todayDiscrepancyMinor > 0
                  ? "text-amber-400"
                  : "text-emerald-400",
              )}
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              dir="ltr"
              className={cn(
                "text-xl font-black tabnum",
                metrics.todayDiscrepancyMinor < 0
                  ? "text-rose-400"
                  : metrics.todayDiscrepancyMinor > 0
                  ? "text-amber-400"
                  : "text-emerald-400",
              )}
            >
              {metrics.openSession
                ? formatMinor(metrics.expectedCashMinor)
                : metrics.todayDiscrepancyMinor === 0
                ? "مطابق 🟢"
                : `${metrics.todayDiscrepancyMinor > 0 ? "+" : ""}${formatMinor(metrics.todayDiscrepancyMinor)}`}
            </span>
            {metrics.openSession && <span className="text-[10px] font-bold text-white">ج.م</span>}
          </div>
          <span className="text-[10px] text-subtle flex items-center justify-between">
            <span>
              {metrics.openSession
                ? metrics.todayDiscrepancyMinor === 0
                  ? "مطابقة تامة بالدرج"
                  : `فرق اليوم: ${metrics.todayDiscrepancyMinor > 0 ? "+" : ""}${formatMinor(metrics.todayDiscrepancyMinor)} ج.م`
                : "جرد مطابق (إقفال وردية ⚡)"}
            </span>
            <span className="text-[9px] text-neon underline font-bold group-hover:text-white">جرد ⚡</span>
          </span>
        </button>

        {/* Card 3: Today's Revenue */}
        <Link
          to="/payments"
          className={cn(
            "flex flex-col gap-1 rounded-2xl border p-3.5 text-start transition-all duration-200 backdrop-blur-md",
            currentSection === "payments"
              ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface",
          )}
        >
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-[11px] font-semibold">إيرادات وتحصيلات اليوم</span>
            <TrendingUp className="size-4 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span dir="ltr" className="text-xl font-black tabnum text-emerald-400">
              {formatMinor(metrics.todayRevenueMinor)}
            </span>
            <span className="text-[10px] font-bold text-white">ج.م</span>
          </div>
          <span className="text-[10px] text-emerald-400/80">مجموع متحصلات اشتراكات ومتجر</span>
        </Link>

        {/* Card 4: Today's Expenses */}
        <Link
          to="/expenses"
          className={cn(
            "flex flex-col gap-1 rounded-2xl border p-3.5 text-start transition-all duration-200 backdrop-blur-md",
            currentSection === "expenses"
              ? "border-amber-500/60 bg-amber-500/10 shadow-sm shadow-amber-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface",
          )}
        >
          <div className="flex items-center justify-between text-amber-400">
            <span className="text-[11px] font-semibold">مصروفات وسندات اليوم</span>
            <TrendingDown className="size-4 text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span dir="ltr" className="text-xl font-black tabnum text-amber-400">
              {formatMinor(metrics.todayExpensesMinor)}
            </span>
            <span className="text-[10px] font-bold text-white">ج.م</span>
          </div>
          <span className="text-[10px] text-amber-400/80">منصرفات تشغيلية ورواتب وسلف</span>
        </Link>

        {/* Card 5: Today's Net Result */}
        <Link
          to="/reports"
          className={cn(
            "flex flex-col gap-1 rounded-2xl border p-3.5 text-start transition-all duration-200 backdrop-blur-md",
            currentSection === "reports"
              ? "border-cyan-500/60 bg-cyan-500/10 shadow-sm shadow-cyan-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface",
          )}
        >
          <div className="flex items-center justify-between text-cyan-400">
            <span className="text-[11px] font-semibold">صافي التدفق اليومي</span>
            <Coins className="size-4 text-cyan-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              dir="ltr"
              className={cn(
                "text-xl font-black tabnum",
                metrics.todayNetMinor >= 0 ? "text-cyan-400" : "text-rose-400",
              )}
            >
              {formatMinor(metrics.todayNetMinor)}
            </span>
            <span className="text-[10px] font-bold text-white">ج.م</span>
          </div>
          <span className="text-[10px] text-subtle">
            {metrics.todayNetMinor >= 0 ? "فائض تشغيلي إيجابي" : "عجز تشغيلي مؤقت"}
          </span>
        </Link>

        {/* Card 6: Member Debts */}
        <Link
          to="/debts"
          className={cn(
            "col-span-2 flex flex-col gap-1 rounded-2xl border p-3.5 text-start transition-all duration-200 backdrop-blur-md sm:col-span-1",
            currentSection === "debts"
              ? "border-rose-500/60 bg-rose-500/10 shadow-sm shadow-rose-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface",
          )}
        >
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-[11px] font-semibold">ديون الأعضاء المعلقة</span>
            <CreditCard className="size-4 text-rose-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span dir="ltr" className="text-xl font-black tabnum text-rose-400">
              {formatMinor(metrics.totalDebtsMinor)}
            </span>
            <span className="text-[10px] font-bold text-white">ج.م</span>
          </div>
          <span className="text-[10px] text-rose-400/80">أقساط ومستحقات مؤجلة</span>
        </Link>
      </div>

      {/* 2. Optional Legacy Capsule Navigation Bar */}
      {showNav && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-full border border-panel-border/50 bg-panel/60 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
          <div className="flex flex-wrap items-center gap-1.5">
            {navCapsules.map((item) => {
              const isActive = currentSection === item.key;
              const Icon = item.icon;

              return (
                <Link
                  key={item.key}
                  to={item.path}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all duration-200",
                    isActive
                      ? "bg-neon/15 border border-neon/60 text-white shadow-[0_0_12px_rgba(57,255,20,0.25)]"
                      : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 transition-transform duration-200 group-hover:scale-110",
                      isActive ? "text-neon" : "text-subtle",
                    )}
                  />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span
                      className={cn(
                        "ms-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        item.badgeTone || "bg-neon/20 text-neon",
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* 1-Click Z-Report Modal Action Button */}
          {canCashClose && (
            <button
              type="button"
              onClick={() => setZReportOpen(true)}
              className="group relative flex items-center gap-2 rounded-full border border-amber-500/40 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent px-4 py-2 text-xs font-black text-amber-300 transition-all duration-200 hover:border-amber-400 hover:bg-amber-500/25 shadow-md shadow-amber-500/10 cursor-pointer active:scale-95"
            >
              <LockKeyhole className="size-3.5 text-amber-400 transition-transform group-hover:scale-110" />
              <span>⚡ تقفيل الوردية (Z-Report)</span>
            </button>
          )}
        </div>
      )}

      {/* 1-Click End of Shift / Daily Z-Report Modal */}
      <ZReportModal
        open={zReportOpen}
        onClose={() => setZReportOpen(false)}
        onSuccess={handleZReportSuccess}
      />
    </div>
  );
}
