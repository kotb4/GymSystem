import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Cake,
  CalendarDays,
  ChevronLeft,
  CreditCard,
  Dumbbell,
  Hourglass,
  Megaphone,
  MessageCircle,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  ScanLine,
  Sparkles,
  Trash2,
  TrendingUp,
  UserPlus,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type AnnouncementRow, type BirthdayMember, type CashSession } from "@/api";
import type { DashboardFinanceSection, DashboardOperationalStats, DashboardOverview } from "@/core/services/dashboard.service";
import type { StoreStats } from "@/api";
import type { SubscriptionWithMember } from "@/core/services/subscriptions.service";
import { addDaysKey, safeDiffDaysKeys, safeParseDateKey, todayKey } from "@/core/dates";
import { formatMinor } from "@/core/money";
import { formatDateShort, formatFullHeading, formatNumber, formatTime } from "@/services/format";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { SeriesChart, type SeriesDataset } from "@/components/charts/series-chart";
import { ACCENT_TINTS, type Accent } from "@/components/ui/accent";
import { BranchFilter } from "@/components/ui/branch-filter";
import { Button } from "@/components/ui/button";
import { SystemHealthCard } from "@/components/dashboard/system-health-card";

type DashboardView = "pulse" | "finance" | "operations";
type RangeKey = "today" | "7d" | "30d" | "month" | "year" | "custom";

const RANGES: Array<{ value: RangeKey; label: string }> = [
  { value: "today", label: "dashboard.periodToday" },
  { value: "7d", label: "dashboard.periodWeek" },
  { value: "30d", label: "dashboard.periodMonth" },
  { value: "month", label: "dashboard.monthThisName" },
  { value: "year", label: "dashboard.periodYear" },
  { value: "custom", label: "dashboard.periodCustom" },
];

function bucketLabel(key: string, bucket: string): string {
  if (bucket === "month") return `${key.slice(5, 7)}/${key.slice(2, 4)}`;
  return key.slice(5);
}

export function DashboardPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();

  // Active top view tab
  const [activeView, setActiveView] = useState<DashboardView>("pulse");

  const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const today = todayKey();
  const [customFrom, setCustomFrom] = useState(addDaysKey(today, -6));
  const [customTo, setCustomTo] = useState(today);

  const [stats, setStats] = useState({
    totalMembers: 0,
    activeMembers: 0,
    activeSubscriptions: 0,
    checkinsToday: 0,
    occupancyNow: 0,
    birthdaysTodayCount: 0,
  });
  const [expiring, setExpiring] = useState<SubscriptionWithMember[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [operational, setOperational] = useState<DashboardOperationalStats | null>(null);
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null);
  const [upcomingSessions, setUpcomingSessions] = useState<Array<{id: string; className: string; sessionDate: string; startTime: string; bookedCount: number; capacity: number}>>([]);
  const [openCashSession, setOpenCashSession] = useState<CashSession | null>(null);
  const [birthdays, setBirthdays] = useState<BirthdayMember[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string>("");

  // Announcements state
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);

  const loadAnnouncements = () => {
    return api.announcements.listActive().then(setAnnouncements).catch(() => {});
  };

  const customRange = useMemo<{ fromKey: string; toKey: string } | undefined>(
    () => (customFrom && customTo ? { fromKey: customFrom, toKey: customTo } : undefined),
    [customFrom, customTo],
  );

  const canViewStore = hasPermission("store.view");
  const canViewClasses = hasPermission("classes.view");

  const refreshAll = async () => {
    if (!actor) return;
    setRefreshing(true);
    try {
      const promises: Promise<unknown>[] = [
        api.dashboard.stats(selectedBranch).then(setStats).catch((err) => console.error(err)),
        api.dashboard
          .overview(rangeKey, rangeKey === "custom" ? customRange : undefined, selectedBranch)
          .then(setOverview)
          .catch((err) => console.error(err)),
        loadAnnouncements(),
      ];
      if (hasPermission("subscriptions.view")) {
        promises.push(api.dashboard.expiring(7).then(setExpiring).catch((err) => console.error(err)));
      }
      if (hasPermission("payments.view")) {
        promises.push(api.dashboard.operational().then(setOperational).catch((err) => console.error(err)));
        promises.push(api.cash.openSession().then(setOpenCashSession).catch((err) => console.error(err)));
      }
      if (hasPermission("members.view")) {
        promises.push(api.dashboard.birthdays(selectedBranch).then(setBirthdays).catch((err) => console.error(err)));
      }
      if (canViewStore) {
        promises.push(api.store.stats({ fromKey: today, toKey: today }).then(setStoreStats).catch(() => {}));
      }
      if (canViewClasses) {
        promises.push(api.classes.listSessions({ fromDate: today, limit: 5 }).then(setUpcomingSessions).catch(() => {}));
      }
      await Promise.allSettled(promises);
      const now = new Date();
      setLastRefreshTime(
        `${String(now.getHours() % 12 || 12).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${now.getHours() < 12 ? "ص" : "م"}`
      );
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, [actor, hasPermission, selectedBranch, rangeKey, customRange]);

  const greeting = new Date().getHours() < 12 ? t("dashboard.morning") : t("dashboard.evening");

  const finance = overview?.finance ?? null;
  const growth = overview?.growth ?? null;
  const store = overview?.store ?? null;

  const revenueDataset = useMemo<SeriesDataset[]>(() => {
    if (!finance || !overview) return [];
    const points = overview.series.map((p) => ({
      label: bucketLabel(p.key, overview.bucket),
      value: p.revenueMinor,
    }));
    return [
      { label: t("dashboard.kpiRevenue"), color: "#39FF88", points },
      {
        label: t("dashboard.kpiExpenses"),
        color: "#22D3EE",
        points: overview.series.map((p) => ({
          label: bucketLabel(p.key, overview.bucket),
          value: p.expensesMinor,
        })),
      },
    ];
  }, [finance, overview, t]);

  const growthDataset = useMemo<SeriesDataset[]>(() => {
    if (!growth || !overview) return [];
    return [
      {
        label: t("dashboard.kpiAttendance"),
        color: "#39FF88",
        points: overview.series.map((p) => ({
          label: bucketLabel(p.key, overview.bucket),
          value: p.checks,
        })),
      },
      {
        label: t("dashboard.kpiNewMembers"),
        color: "#A78BFA",
        points: overview.series.map((p) => ({
          label: bucketLabel(p.key, overview.bucket),
          value: p.newMembers,
        })),
      },
    ];
  }, [growth, overview, t]);

  const VIEW_TABS: Array<{ value: DashboardView; label: string }> = [
    { value: "pulse", label: "⚡ نبض الجيم اليوم (الرئيسي)" },
    { value: "finance", label: "💰 المالية والأرباح" },
    { value: "operations", label: "📈 حركة الصالة والنمو" },
  ];

  return (
    <div className="space-y-5">
      {/* 1. Header with Greeting, Fast Refresh & Smart View Switcher */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">{greeting}</h2>
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {formatFullHeading(new Date())}
            {lastRefreshTime && (
              <span className="ms-2 text-slate-500 font-mono">
                (آخر تحديث: {lastRefreshTime})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={refreshAll}
            disabled={refreshing}
            className="gap-1.5 text-xs h-9 px-3 border-white/10"
            title={t("dashboard.refreshLive")}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-[#00D2FF]")} />
            <span className="hidden sm:inline">{t("dashboard.refreshLive")}</span>
          </Button>

          <BranchFilter
            value={selectedBranch}
            onChange={setSelectedBranch}
            allLabel={t("dashboard.allBranches")}
            label={t("dashboard.branchFilter")}
          />
        </div>
      </section>

      {/* System Health & Operational Telemetry */}
      <SystemHealthCard />

      {/* Smart View Navigation Tabs */}
      <div className="border-b border-white/[0.08] pb-3">
        <Tabs
          items={VIEW_TABS}
          value={activeView}
          onChange={(v) => setActiveView(v as DashboardView)}
        />
      </div>

      {/* ============================================================== */}
      {/* VIEW 1: PULSE (نبض الجيم اليوم - البساطة والتشغيل المباشر)       */}
      {/* ============================================================== */}
      {activeView === "pulse" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Active Cash Shift Banner */}
          {hasPermission("payments.view") && (
            <section>
              {openCashSession ? (
                <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="relative flex size-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full size-3 bg-emerald-400" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{t("dashboard.shiftActiveTitle")}</span>
                        <Badge variant="success" className="text-[10px] py-0 px-2">مفتوحة</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-0.5">
                        <span>{t("dashboard.shiftOpener", { name: openCashSession.openedByName })}</span>
                        <span>•</span>
                        <span>{t("dashboard.shiftOpenedAt", { time: formatTime(openCashSession.openedAt) })}</span>
                        <span>•</span>
                        <span>{t("dashboard.shiftStartBalance", { amount: formatMinor(openCashSession.openingBalanceMinor) })}</span>
                      </div>
                    </div>
                  </div>
                  <Link to="/treasury">
                    <Button size="sm" variant="secondary" className="text-xs gap-1.5 h-8">
                      <Banknote className="size-3.5 text-emerald-400" />
                      <span>إدارة الخزينة والوردية</span>
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="size-5 text-amber-400 shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-white">{t("dashboard.shiftClosedTitle")}</h4>
                      <p className="text-xs text-slate-400">{t("dashboard.shiftClosedSubtitle")}</p>
                    </div>
                  </div>
                  <Link to="/treasury">
                    <Button size="sm" className="bg-amber-400 text-black hover:bg-amber-300 font-bold text-xs gap-1 h-8">
                      <Plus className="size-3.5" />
                      {t("dashboard.openShiftNow")}
                    </Button>
                  </Link>
                </div>
              )}
            </section>
          )}

          {/* 4 Core Hero Pulse KPI Cards */}
          <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {/* KPI 1: Net Cash Flow Today */}
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-[#0A131A] to-[#0A1017] p-4.5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">صافي إيرادات الخزينة</span>
                <span className="size-8 rounded-xl bg-emerald-500/20 text-emerald-400 grid place-items-center">
                  <Banknote className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-white tabnum">
                  {finance ? formatMinor(finance.net.current) : formatMinor(0)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  إجمالي المحصل نقداً بعد المصروفات
                </p>
              </div>
            </div>

            {/* KPI 2: Attendance Today + Live Occupancy */}
            <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/15 via-[#0A131F] to-[#0A1017] p-4.5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">حضور الصالة اليوم</span>
                <span className="size-8 rounded-xl bg-cyan-500/20 text-cyan-400 grid place-items-center">
                  <ScanLine className="size-4" />
                </span>
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-black text-white tabnum">{formatNumber(stats.checkinsToday)}</p>
                  <span className="text-xs text-slate-400 font-semibold">زيارة اليوم</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-emerald-400 font-bold">
                  <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{stats.occupancyNow} متواجد الآن بالصالة</span>
                </div>
              </div>
            </div>

            {/* KPI 3: Active Subscriptions & Members */}
            <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/15 via-[#130E1F] to-[#0A1017] p-4.5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">الاشتراكات السارية</span>
                <span className="size-8 rounded-xl bg-purple-500/20 text-purple-400 grid place-items-center">
                  <CreditCard className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-white tabnum">{formatNumber(stats.activeSubscriptions)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  من إجمالي {formatNumber(stats.totalMembers)} عضو مسجل
                </p>
              </div>
            </div>

            {/* KPI 4: Expiring Alert */}
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-[#1F170A] to-[#0A1017] p-4.5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">تنبيهات التجديد</span>
                <span className="size-8 rounded-xl bg-amber-500/20 text-amber-400 grid place-items-center">
                  <CalendarDays className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-amber-400 tabnum">{formatNumber(expiring.length)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  اشتراكات تنتهي خلال 7 أيام للمتابعة
                </p>
              </div>
            </div>
          </section>

          {/* Quick Action Dock */}
          <section className="rounded-2xl border border-white/[0.08] bg-panel/80 p-4 backdrop-blur-md">
            <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-[#00D2FF]" />
              <span>إجراءات التشغيل السريعة الأكثر طلباً:</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <Link
                to="/attendance"
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.03] hover:bg-emerald-500/15 hover:text-emerald-400 hover:border-emerald-500/40 border border-white/[0.07] text-xs font-bold text-slate-300 transition-all shadow-sm"
              >
                <ScanLine className="size-4 text-emerald-400" />
                <span>تسجيل حضور</span>
              </Link>

              <Link
                to="/subscriptions"
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.03] hover:bg-cyan-500/15 hover:text-cyan-400 hover:border-cyan-500/40 border border-white/[0.07] text-xs font-bold text-slate-300 transition-all shadow-sm"
              >
                <CreditCard className="size-4 text-cyan-400" />
                <span>اشتراك جديد</span>
              </Link>

              <Link
                to="/payments"
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.03] hover:bg-emerald-500/15 hover:text-emerald-400 hover:border-emerald-500/40 border border-white/[0.07] text-xs font-bold text-slate-300 transition-all shadow-sm"
              >
                <Banknote className="size-4 text-emerald-400" />
                <span>تسجيل دفعة</span>
              </Link>

              <Link
                to="/quick-sessions"
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.03] hover:bg-amber-500/15 hover:text-amber-400 hover:border-amber-500/40 border border-white/[0.07] text-xs font-bold text-slate-300 transition-all shadow-sm"
              >
                <Zap className="size-4 text-amber-400" />
                <span>حصة سريعة</span>
              </Link>

              <Link
                to="/members"
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.03] hover:bg-purple-500/15 hover:text-purple-400 hover:border-purple-500/40 border border-white/[0.07] text-xs font-bold text-slate-300 transition-all shadow-sm"
              >
                <UserPlus className="size-4 text-purple-400" />
                <span>دليل المشتركين</span>
              </Link>
            </div>
          </section>

          {/* Operational Dual Grid: Recent Scans & Expiring Subscriptions */}
          <section className="grid gap-4 xl:grid-cols-2">
            <RecentCheckInsCard />
            <ExpiringCard rows={expiring} />
          </section>
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW 2: FINANCE (المالية والتدفقات النقدية والأرباح)             */}
      {/* ============================================================== */}
      {activeView === "finance" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Period Selection Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl border border-white/[0.08] bg-panel/70">
            <span className="text-xs font-bold text-slate-400">تحديد الفترة الزمنية للتقارير:</span>
            <DateRangeFilter
              value={rangeKey}
              onChange={setRangeKey}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFrom={setCustomFrom}
              onCustomTo={setCustomTo}
            />
          </div>

          {/* Financial Grand Balance Card & Dual Analytics */}
          <section className="grid gap-4 lg:grid-cols-12">
            {/* Grand Hero Financial Balance */}
            <div className="lg:col-span-5">
              <Card className="h-full relative overflow-hidden p-6 border-white/[0.12] bg-gradient-to-br from-panel via-surface/90 to-panel flex flex-col justify-between shadow-pop group">
                <div className="absolute -top-12 -end-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none transition-opacity group-hover:opacity-100 opacity-60" />

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-400 tracking-wide flex items-center gap-2">
                      <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
                      {t("dashboard.heroBalanceTitle")}
                    </span>
                    {finance && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabnum border",
                          finance.net.current >= 0
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border-rose-500/30",
                        )}
                      >
                        {finance.net.deltaPct !== null
                          ? `${finance.net.deltaPct > 0 ? "+" : ""}${finance.net.deltaPct.toFixed(1)}%`
                          : t(RANGES.find((r) => r.value === rangeKey)?.label ?? "dashboard.trendsThisMonth")}
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="text-3xl sm:text-4xl font-black tracking-tight tabnum text-white">
                      {finance ? formatMinor(finance.net.current) : formatMinor(0)}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{t("dashboard.heroBalanceSubtitle")}</p>
                  </div>

                  {/* Sub metrics: Inflow vs Outflow */}
                  {finance && (
                    <div className="mt-5 grid grid-cols-2 gap-3 pt-4 border-t border-white/[0.08]">
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="size-2 rounded-full bg-emerald-400" />
                          <span>{t("dashboard.kpiRevenue")}</span>
                        </div>
                        <div className="mt-1 text-lg font-bold tabnum text-white">
                          {formatMinor(finance.revenue.current)}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="size-2 rounded-full bg-amber-400" />
                          <span>{t("dashboard.kpiExpenses")}</span>
                        </div>
                        <div className="mt-1 text-lg font-bold tabnum text-white">
                          {formatMinor(finance.expenses.current)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs">
                  <Link to="/reports" className="font-bold text-[#00D2FF] hover:underline flex items-center gap-1">
                    <span>فتح المركز المالي التفصيلي</span>
                    <ChevronLeft className="size-3.5" />
                  </Link>
                  <Link to="/treasury" className="font-bold text-slate-400 hover:text-white">
                    دفتر الخزينة
                  </Link>
                </div>
              </Card>
            </div>

            {/* Cash Flow Chart */}
            <div className="lg:col-span-7">
              {finance && revenueDataset.length > 0 ? (
                <Card className="h-full">
                  <CardHeader
                    title={t("dashboard.chartRevenueTitle")}
                    description={t("dashboard.subtitle")}
                  />
                  <div className="px-5 pb-5">
                    <SeriesChart series={revenueDataset} />
                  </div>
                </Card>
              ) : (
                <Card className="h-full p-5 flex items-center justify-center">
                  <EmptyState icon={<TrendingUp />} title={t("common.noData")} />
                </Card>
              )}
            </div>
          </section>

          {/* Revenue Distribution & Outstanding Debts */}
          <section className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <RevenueBreakdownCard finance={finance} store={store} storeStats={storeStats} />
            </div>

            {operational && (
              <div className="lg:col-span-6 space-y-4">
                <Link to="/payments?status=partial" className="block">
                  <StatCard
                    title={t("dashboard.opOutstanding")}
                    subtitle={t("dashboard.opOutstandingMembers", { count: operational.membersWithOutstanding })}
                    value={formatMinor(operational.outstandingTotalMinor)}
                    icon={<Banknote className="size-5" />}
                    accent={operational.outstandingTotalMinor > 0 ? "amber" : "neon"}
                  />
                </Link>

                <AlertStrip overview={overview} />
              </div>
            )}
          </section>
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW 3: OPERATIONS (حركة الصالة والنمو والأنشطة)                */}
      {/* ============================================================== */}
      {activeView === "operations" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Members Birthdays Today Banner */}
          {birthdays.length > 0 && (
            <section className="p-4 rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-500/15 via-pink-500/5 to-transparent space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-xl bg-purple-500/25 text-purple-400">
                    <Cake className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {t("dashboard.birthdaysTodayTitle")}
                      <Badge variant="violet" className="py-0 px-2 text-[10px]">
                        {t("dashboard.birthdaysCount", { count: birthdays.length })}
                      </Badge>
                    </h3>
                    <p className="text-[11px] text-slate-400">{t("dashboard.birthdaysTodaySub")}</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {birthdays.map((b) => {
                  const cleanPhone = b.phone ? b.phone.replace(/\D/g, "").replace(/^0/, "20") : "";
                  const waText = encodeURIComponent(
                    `كل سنة وحضرتك طيب يا كابتن ${b.fullName}! 🎉 أسرة الجيم بتتمنى لك سنة سعيدة مليانة صحة وإنجازات وقوة! 💪🎂`
                  );
                  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${waText}` : null;

                  return (
                    <div
                      key={b.id}
                      className="p-3 rounded-xl bg-panel border border-white/[0.08] flex items-center justify-between gap-3 shadow-sm hover:border-purple-500/30 transition-all"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={b.fullName} size="sm" />
                        <div className="min-w-0">
                          <Link
                            to={`/members/${b.id}`}
                            className="text-xs font-bold text-white hover:text-purple-400 truncate block transition-colors"
                          >
                            {b.fullName}
                          </Link>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            <span>{b.memberCode}</span>
                            {b.age !== null && (
                              <>
                                <span>•</span>
                                <span className="text-purple-400 font-medium">
                                  {t("dashboard.yearsOld", { age: b.age })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {waUrl && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors shrink-0"
                          title={t("dashboard.congratulateWhatsApp")}
                        >
                          <MessageCircle className="size-4" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Announcements Banner Section */}
          {announcements.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                  <Megaphone className="size-4 text-[#00D2FF]" />
                  التنبيهات والإعلانات العامة للنادي
                </span>
              </div>

              {announcements.map((a) => {
                const levelClass =
                  a.level === "danger"
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                    : a.level === "warning"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : a.level === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400";
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "p-3.5 rounded-xl border flex items-start justify-between gap-3 shadow-sm",
                      levelClass,
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <Megaphone className="size-4 mt-0.5 shrink-0" />
                      <div>
                        <h3 className="font-bold text-sm text-white">{a.title}</h3>
                        <p className="text-xs mt-1 text-white/80 leading-relaxed whitespace-pre-wrap">
                          {a.content}
                        </p>
                        <span className="text-[10px] text-slate-400 mt-1 block">
                          {a.created_at?.slice(0, 10)} {a.creator_name ? `• ${a.creator_name}` : ""}
                        </span>
                      </div>
                    </div>
                    {hasPermission("announcements.manage") && (
                      <button
                        onClick={async () => {
                          if (confirm("هل تريد حذف هذا الإعلان؟")) {
                            await api.announcements.delete(a.id);
                            loadAnnouncements();
                          }
                        }}
                        className="text-xs text-slate-400 hover:text-rose-400 p-1 transition-colors"
                        title="حذف الإعلان"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* Growth Chart & Busy Hours Grid */}
          <section className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7">
              {growth && growthDataset.length > 0 ? (
                <Card className="h-full">
                  <CardHeader
                    title={t("dashboard.chartGrowthTitle")}
                    description={t("dashboard.vsPrevPeriod")}
                  />
                  <div className="px-5 pb-5">
                    <SeriesChart series={growthDataset} />
                  </div>
                </Card>
              ) : (
                <Card className="h-full p-5 flex items-center justify-center">
                  <EmptyState icon={<TrendingUp />} title={t("common.noData")} />
                </Card>
              )}
            </div>

            {/* Busy Hours Card */}
            <div className="lg:col-span-5">
              <Card className="p-5 h-full flex flex-col justify-between">
                <CardHeader title={t("dashboard.opBusyHours")} description="أوقات الذروة وازدحام الصالة اليوم" />
                {!operational || operational.busyHoursToday.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500 text-center py-6">لا توجد بيانات حضور مسجلة حتى الآن اليوم</p>
                ) : (
                  <ul className="space-y-2.5 px-2">
                    {operational.busyHoursToday.map((h) => (
                      <li key={h.hour} className="flex items-center justify-between gap-3 text-xs font-semibold">
                        <span dir="ltr" className="tabnum text-slate-300 font-mono w-14">
                          {String(h.hour).padStart(2, "0")}:00
                        </span>
                        <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                          <span
                            className="block h-full rounded-full bg-cyan-400 transition-all duration-300"
                            style={{
                              width: `${Math.max(
                                10,
                                Math.round((h.count / Math.max(1, operational.busyHoursToday[0].count)) * 100),
                              )}%`,
                            }}
                          />
                        </span>
                        <span className="w-8 text-end tabnum text-slate-400 font-bold">{h.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </section>

          {/* Store & Classes Mini Deck */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {storeStats && (
              <>
                <Link to="/store" className="block">
                  <StatCard
                    title={t("dashboard.storeTodaySales")}
                    value={formatNumber(storeStats.salesCount)}
                    icon={<ReceiptText className="size-5" />}
                    accent="neon"
                  />
                </Link>
                <Link to="/store" className="block">
                  <StatCard
                    title={t("dashboard.storeLowStock")}
                    value={formatNumber(store ? store.lowStock : storeStats.lowStockCount)}
                    icon={<PackageCheck className="size-5" />}
                    accent={(store ? store.lowStock : storeStats.lowStockCount) > 0 ? "amber" : "cyan"}
                  />
                </Link>
              </>
            )}

            <Link to="/classes" className="block">
              <StatCard
                title="الحصص والأكاديميات"
                value={formatNumber(upcomingSessions.length)}
                subtitle="حصص تدريبية مقررة"
                icon={<Dumbbell className="size-5" />}
                accent="cyan"
              />
            </Link>

            <Link to="/quick-sessions" className="block">
              <StatCard
                title={t("dashboard.opQuickSessions")}
                subtitle={operational ? formatMinor(operational.quickSessionsTodayRevenueMinor) : "—"}
                value={formatNumber(operational?.quickSessionsTodayCount ?? 0)}
                icon={<Zap className="size-5" />}
                accent="amber"
              />
            </Link>
          </section>

          {/* Upcoming Sessions List */}
          {upcomingSessions.length > 0 && (
            <section>
              <Card>
                <CardHeader title={t("dashboard.upcomingClasses")} description="جدول الحصص والأنشطة القادمة" />
                <ul className="divide-y divide-white/[0.06] px-5 pb-4">
                  {upcomingSessions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="block font-bold text-white">{s.className}</span>
                        <span className="block text-xs text-slate-400 tabnum font-medium">
                          {s.sessionDate} • {formatTime(s.startTime)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="info">{s.bookedCount}/{s.capacity}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function DateRangeFilter({
  value,
  onChange,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        items={RANGES.map((r) => ({ value: r.value, label: t(r.label) }))}
        value={value}
        onChange={(v) => onChange(v as RangeKey)}
      />
      {value === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFrom(e.target.value)}
            className="rounded-lg border border-white/10 bg-surface px-2.5 py-1 text-xs text-white"
          />
          <ArrowLeft className="size-3 text-slate-500 shrink-0" />
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomTo(e.target.value)}
            className="rounded-lg border border-white/10 bg-surface px-2.5 py-1 text-xs text-white"
          />
        </div>
      )}
    </div>
  );
}

function RevenueBreakdownCard({
  finance,
  store,
  storeStats,
}: {
  finance: DashboardFinanceSection | null;
  store: { lowStock: number; debtMinor: number } | null;
  storeStats: StoreStats | null;
}) {
  const t = useT();
  const totalRev = finance?.revenue.current ?? 0;

  const subRev = finance?.streams
    ? finance.streams.subscriptionsMinor
    : Math.max(0, totalRev - (storeStats?.revenueMinor ?? 0));
  const storeRev = finance?.streams
    ? finance.streams.storeMinor
    : (storeStats?.revenueMinor ?? 0);
  const quickRev = finance?.streams?.quickSessionsMinor ?? 0;
  const ptRev = finance?.streams?.privateTrainingMinor ?? 0;
  const debtMinor = store?.debtMinor ?? 0;

  const subPct = totalRev > 0 ? Math.min(100, Math.round((subRev / totalRev) * 100)) : 0;
  const storePct = totalRev > 0 ? Math.min(100, Math.round((storeRev / totalRev) * 100)) : 0;
  const quickPct = totalRev > 0 ? Math.min(100, Math.round((quickRev / totalRev) * 100)) : 0;
  const ptPct = totalRev > 0 ? Math.min(100, Math.round((ptRev / totalRev) * 100)) : 0;

  return (
    <Card className="h-full flex flex-col justify-between">
      <CardHeader
        title={t("dashboard.revenueDistributionTitle")}
        description={t("dashboard.revenueDistributionSubtitle")}
      />
      <div className="p-5 space-y-4">
        {/* Item 1: Subscriptions */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-emerald-400 shadow-sm" />
              {t("dashboard.sourceSubscriptions")}
            </span>
            <span className="font-bold tabnum text-white">
              {formatMinor(subRev)} <span className="text-slate-400 font-normal">({subPct}%)</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-500"
              style={{ width: `${subPct}%` }}
            />
          </div>
        </div>

        {/* Item 2: Store */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-cyan-400 shadow-sm" />
              {t("dashboard.sourceStore")}
            </span>
            <span className="font-bold tabnum text-white">
              {formatMinor(storeRev)} <span className="text-slate-400 font-normal">({storePct}%)</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all duration-500"
              style={{ width: `${storePct}%` }}
            />
          </div>
        </div>

        {/* Item 3: Quick Sessions */}
        {quickRev > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-amber-400 shadow-sm" />
                {t("dashboard.sourceQuickSessions")}
              </span>
              <span className="font-bold tabnum text-white">
                {formatMinor(quickRev)} <span className="text-slate-400 font-normal">({quickPct}%)</span>
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400 transition-all duration-500"
                style={{ width: `${quickPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Item 4: Private Training PT */}
        {ptRev > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-purple-400 shadow-sm" />
                {t("dashboard.sourcePrivateTraining")}
              </span>
              <span className="font-bold tabnum text-white">
                {formatMinor(ptRev)} <span className="text-slate-400 font-normal">({ptPct}%)</span>
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-purple-400 transition-all duration-500"
                style={{ width: `${ptPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Item 5: Debts */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-rose-400 shadow-sm" />
              {t("dashboard.sourceDebts")}
            </span>
            <span className="font-bold tabnum text-white">
              {formatMinor(debtMinor)}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-rose-400 transition-all duration-500"
              style={{ width: debtMinor > 0 ? (totalRev > 0 ? `${Math.min(100, Math.round((debtMinor / (totalRev + debtMinor)) * 100))}%` : "100%") : "0%" }}
            />
          </div>
        </div>
      </div>

      <div className="p-3 mx-5 mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-2.5">
        <Sparkles className="size-4 text-emerald-400 shrink-0" />
        <div className="text-xs text-slate-400 leading-relaxed">
          <span className="font-bold text-white">{t("dashboard.smartInsightsTitle")}: </span>
          {finance && finance.net.current >= 0
            ? t("dashboard.insightCashFlow")
            : t("dashboard.insightOutstanding")}
        </div>
      </div>
    </Card>
  );
}

function AlertStrip({ overview }: { overview: DashboardOverview | null }) {
  const t = useT();
  const { hasPermission } = useAuth();
  if (!overview) return null;

  type AlertItem = {
    icon: LucideIcon;
    accent: Accent;
    label: string;
    value: string;
    link?: string;
    show?: boolean;
  };

  const ops = overview.operations;
  const store = overview.store;

  const items: AlertItem[] = [];

  if (ops && hasPermission("subscriptions.view")) {
    items.push({
      icon: CalendarDays,
      accent: ops.expiringWithin7 > 0 ? "amber" : "neon",
      label: t("dashboard.alertExpiringSoon"),
      value: formatNumber(ops.expiringWithin7),
      link: "/subscriptions",
      show: true,
    });
    items.push({
      icon: AlertTriangle,
      accent: ops.expiredSubscriptions > 0 ? "red" : "neon",
      label: t("dashboard.alertExpired"),
      value: formatNumber(ops.expiredSubscriptions),
      link: "/subscriptions",
      show: true,
    });
  }
  if (ops && hasPermission("payments.view")) {
    items.push({
      icon: Banknote,
      accent: ops.outstandingTotalMinor > 0 ? "amber" : "neon",
      label: t("dashboard.alertOutstanding"),
      value: formatMinor(ops.outstandingTotalMinor),
      link: "/payments?status=partial",
      show: true,
    });
  }
  if (ops && hasPermission("members.view")) {
    items.push({
      icon: CreditCard,
      accent: ops.lostCards > 0 ? "violet" : "neon",
      label: t("dashboard.alertLostCards"),
      value: formatNumber(ops.lostCards),
      link: "/cards",
      show: true,
    });
  }
  if (store && hasPermission("store.view")) {
    items.push({
      icon: PackageCheck,
      accent: store.lowStock > 0 ? "amber" : "neon",
      label: t("dashboard.alertLowStock"),
      value: formatNumber(store.lowStock),
      link: "/store",
      show: true,
    });
  }
  if (overview.expiredTrials > 0 && hasPermission("trials.view")) {
    items.push({
      icon: Hourglass,
      accent: "violet",
      label: t("dashboard.alertExpiredTrials"),
      value: formatNumber(overview.expiredTrials),
      link: "/crm?tab=trials",
      show: true,
    });
  }

  const visible = items.filter((i) => i.show);

  if (visible.length === 0) return null;

  return (
    <Card className="h-full flex flex-col justify-between">
      <CardHeader title={t("dashboard.alertsTitle")} />
      <div className="grid gap-2.5 p-4">
        {visible.map((item) => (
          <Link
            key={item.label}
            to={item.link ?? "#"}
            className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-surface/80 p-2.5 transition-all hover:border-emerald-500/40 hover:bg-surface"
          >
            <span
              aria-hidden
              className={cn("grid size-9 shrink-0 place-items-center rounded-lg", ACCENT_TINTS[item.accent])}
            >
              <item.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-slate-400">{item.label}</span>
              <span className="block text-base font-extrabold leading-tight tabnum text-white">{item.value}</span>
            </span>
            <ChevronLeft
              aria-hidden
              className="size-4 shrink-0 text-slate-500 transition-transform group-hover:-translate-x-0.5 group-hover:text-emerald-400"
            />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function ExpiringCard({ rows }: { rows: SubscriptionWithMember[] }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const today = todayKey();

  interface Row {
    id: string;
    memberId: string;
    name: string;
    planName: string;
    endDateKey: string;
    left: number;
    phone: string | null;
  }

  const data: Row[] = rows.map((sub) => ({
    id: sub.id,
    memberId: sub.memberId,
    name: sub.memberName,
    planName: sub.planName ?? "—",
    endDateKey: sub.endDate,
    left: safeDiffDaysKeys(sub.endDate, today) ?? 0,
    phone: sub.memberPhone ? String(sub.memberPhone) : null,
  }));

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("common.member"),
      render: (row) => (
        <Link to={`/members/${row.memberId}`} className="flex items-center gap-2">
          <Avatar name={row.name} size="sm" />
          <span className="font-bold hover:text-[#00D2FF] text-white text-xs">{row.name}</span>
        </Link>
      ),
    },
    {
      key: "plan",
      header: t("common.plan"),
      render: (row) => <span className="text-slate-400 text-xs">{row.planName}</span>,
    },
    {
      key: "endDate",
      header: t("common.endDate"),
      render: (row) => {
        const d = safeParseDateKey(row.endDateKey);
        return <span className="tabnum text-slate-400 text-xs">{d ? formatDateShort(d) : row.endDateKey}</span>;
      },
    },
    {
      key: "left",
      header: t("common.remaining"),
      render: (row) => (
        <Badge variant={row.left <= 3 ? "danger" : "warning"} dot className="text-xs">
          {row.left <= 0 ? t("dashboard.expiredToday") : t("dashboard.daysLeft", { days: row.left })}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "تواصل سريع",
      render: (row) => {
        if (!row.phone) return <span className="text-slate-500 text-xs">—</span>;
        const clean = row.phone.replace(/\D/g, "").replace(/^0/, "20");
        const msg = encodeURIComponent(
          `أهلاً بحضرتك يا كابتن ${row.name} 🌹\nنود تذكيرك بأن اشتراكك في الجيم (${row.planName}) أوشك على الانتهاء.\nيسعدنا تجديد اشتراكك لاستمرار حماسك وتدريبك معنا! 💪`
        );
        return (
          <a
            href={`https://wa.me/${clean}?text=${msg}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 text-[11px] font-bold"
            title="تذكير المشترك عبر واتساب"
          >
            <MessageCircle className="size-3.5" />
            <span>تذكير</span>
          </a>
        );
      },
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader
        title={t("dashboard.expiringTitle")}
        description="المشتركون الذين تنتهي اشتراكاتهم قريباً لتذكيرهم والتجديد"
        action={
          hasPermission("subscriptions.view") ? (
            <Link
              to="/subscriptions"
              className="inline-flex items-center gap-1 text-xs font-bold text-[#00D2FF] transition-opacity hover:opacity-80"
            >
              {t("dashboard.viewAll")}
              <ChevronLeft aria-hidden className="size-3.5" />
            </Link>
          ) : undefined
        }
      />
      {hasPermission("subscriptions.view") ? (
        data.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-8 text-slate-500" />} title={t("dashboard.expiringEmpty")} description="لا توجد اشتراكات توشك على الانتهاء في الـ 7 أيام القادمة" />
        ) : (
          <DataTable columns={columns} data={data} rowKey={(r) => r.id} />
        )
      ) : (
        <EmptyState icon={<CalendarDays className="size-8 text-slate-500" />} title={t("errors.forbidden")} />
      )}
    </Card>
  );
}

function RecentCheckInsCard() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const canView = hasPermission("checkin.view_history");
  const [recent, setRecent] = useState<
    Array<{ id: string; memberName: string; memberCode: string; checkinAt: string }>
  >([]);

  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    api.attendance
      .recent(8)
      .then((rows) => {
        if (alive) setRecent(rows as Array<{ id: string; memberName: string; memberCode: string; checkinAt: string }>);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, canView]);

  return (
    <Card className="h-full">
      <CardHeader title={t("checkin.recent")} description="سجل المشتركين الذين دخلوا الصالة اليوم بالتوقيت اللحظي" />
      {!canView ? (
        <EmptyState icon={<ScanLine className="size-8 text-slate-500" />} title={t("errors.forbidden")} />
      ) : recent.length === 0 ? (
        <EmptyState icon={<ScanLine className="size-8 text-slate-500" />} title={t("checkin.noScans")} description="لم يتم تسجيل أي حركة دخول بالباركود اليوم بعد" />
      ) : (
        <ul className="divide-y divide-white/[0.06] px-4 pb-3">
          {recent.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.02] px-2 rounded-xl transition-colors">
              <Avatar name={item.memberName} size="sm" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-white">{item.memberName}</span>
                <span className="block text-[10px] font-mono text-slate-400">{item.memberCode}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-slate-400 tabnum font-medium">
                  {formatTime(item.checkinAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
