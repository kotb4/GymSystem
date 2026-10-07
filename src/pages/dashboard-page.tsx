import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  ChevronLeft,
  CreditCard,
  Hourglass,
  PackageCheck,
  ReceiptText,
  ScanLine,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api } from "@/api";
import type { DashboardOperationalStats, DashboardOverview } from "@/core/services/dashboard.service";
import type { StoreStats } from "@/api";
import type { SubscriptionWithMember } from "@/core/services/subscriptions.service";
import { addDaysKey, safeDiffDaysKeys, safeParseDateKey, todayKey } from "@/core/dates";
import { formatMinor } from "@/core/money";
import { formatDateShort, formatFullHeading, formatNumber } from "@/services/format";
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

function deltaProps(trend: { deltaPct: number | null }) {
  if (trend.deltaPct === null || trend.deltaPct === 0) return { delta: undefined as string | undefined, deltaDir: undefined as "up" | "down" | undefined };
  const up = trend.deltaPct > 0;
  return {
    delta: `${up ? "+" : ""}${trend.deltaPct.toFixed(1)}%`,
    deltaDir: (up ? "up" : "down") as "up" | "down",
  };
}

export function DashboardPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
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
  });
  const [expiring, setExpiring] = useState<SubscriptionWithMember[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [operational, setOperational] = useState<DashboardOperationalStats | null>(null);
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null);
  const [upcomingSessions, setUpcomingSessions] = useState<Array<{id: string; className: string; sessionDate: string; startTime: string; bookedCount: number; capacity: number}>>([]);

  const customRange = useMemo<{ fromKey: string; toKey: string } | undefined>(
    () => (customFrom && customTo ? { fromKey: customFrom, toKey: customTo } : undefined),
    [customFrom, customTo],
  );

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void api.dashboard
      .stats(selectedBranch)
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch((err) => console.error(err));
    if (hasPermission("subscriptions.view")) {
      api.dashboard
        .expiring(7)
        .then((rows) => {
          if (alive) setExpiring(rows);
        })
        .catch((err) => console.error(err));
    }
    return () => {
      alive = false;
    };
  }, [actor, hasPermission, selectedBranch]);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    api.dashboard
      .overview(rangeKey, rangeKey === "custom" ? customRange : undefined, selectedBranch)
      .then((ov) => {
        if (alive) setOverview(ov);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, rangeKey, customRange, selectedBranch]);

  useEffect(() => {
    if (!actor || !hasPermission("payments.view")) return;
    let alive = true;
    api.dashboard
      .operational()
      .then((opStats) => {
        if (alive) setOperational(opStats);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, hasPermission]);

  const canViewStore = hasPermission("store.view");

  useEffect(() => {
    if (!actor || !canViewStore) return;
    let alive = true;
    api.store.stats({ fromKey: today, toKey: today }).then((s) => { if (alive) setStoreStats(s); }).catch(() => {});
    return () => { alive = false; };
  }, [actor, canViewStore, today]);

  const canViewClasses = hasPermission("classes.view");

  useEffect(() => {
    if (!actor || !canViewClasses) return;
    let alive = true;
    api.classes.listSessions({ fromDate: today, limit: 5 }).then((s) => { if (alive) setUpcomingSessions(s); }).catch(() => {});
    return () => { alive = false; };
  }, [actor, canViewClasses, today]);

  const greeting = new Date().getHours() < 12 ? t("dashboard.morning") : t("dashboard.evening");

  const finance = overview?.finance ?? null;
  const growth = overview?.growth ?? null;
  const members = overview?.members ?? null;
  const store = overview?.store ?? null;

  const prevLabel = t("dashboard.vsPrevPeriod");

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

  return (
    <div className="space-y-6">
      {/* 1. Header with Greeting, Date & Period Filter Tabs */}
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-ink">{greeting}</h2>
          <p className="mt-1 text-sm text-subtle">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BranchFilter
            value={selectedBranch}
            onChange={setSelectedBranch}
            allLabel={t("dashboard.allBranches")}
            label={t("dashboard.branchFilter")}
          />
          <DateRangeFilter
            value={rangeKey}
            onChange={setRangeKey}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFrom={setCustomFrom}
            onCustomTo={setCustomTo}
          />
          <span className="hidden items-center gap-2 rounded-2xl border border-white/[0.08] bg-panel px-3.5 py-2 text-xs font-semibold text-subtle md:inline-flex shadow-sm">
            <CalendarDays aria-hidden className="size-4 text-faint" />
            {formatFullHeading(new Date())}
          </span>
        </div>
      </section>

      {selectedBranch !== "all" && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-neon/10 border border-neon/20 text-xs text-neon font-semibold w-fit">
          <Building2 className="size-3.5" />
          <span>{t("dashboard.branchCurrent", { name: selectedBranch })}</span>
        </div>
      )}

      {/* 2. NeuroBank Grand Balance Card + Core Metrics Grid */}
      <section className="grid gap-4 lg:grid-cols-12">
        {/* NeuroBank Grand Hero Financial Card (5 cols on large screens) */}
        <div className="lg:col-span-5">
          <Card className="h-full relative overflow-hidden p-6 border-white/[0.12] bg-gradient-to-br from-panel via-surface/90 to-panel flex flex-col justify-between shadow-pop group">
            {/* Subtle glow mesh */}
            <div className="absolute -top-12 -end-12 w-48 h-48 bg-neon/10 rounded-full blur-3xl pointer-events-none transition-opacity group-hover:opacity-100 opacity-60" />

            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-subtle tracking-wide flex items-center gap-2">
                  <span className="inline-block size-2 rounded-full bg-neon animate-pulse" />
                  {t("dashboard.heroBalanceTitle")}
                </span>
                {finance && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabnum border",
                      finance.net.current >= 0
                        ? "bg-neon/10 text-neon border-neon/20 shadow-glow-sm"
                        : "bg-red/10 text-red border-red/20",
                    )}
                  >
                    {finance.net.deltaPct !== null
                      ? `${finance.net.deltaPct > 0 ? "+" : ""}${finance.net.deltaPct.toFixed(1)}%`
                      : t(RANGES.find((r) => r.value === rangeKey)?.label ?? "dashboard.trendsThisMonth")}
                  </span>
                )}
              </div>

              <div className="mt-3">
                <div className="text-3xl sm:text-4xl font-black tracking-tight tabnum text-ink">
                  {finance ? formatMinor(finance.net.current) : formatMinor(0)}
                </div>
                <p className="mt-1 text-xs text-faint">{t("dashboard.heroBalanceSubtitle")}</p>
              </div>

              {/* Sub metrics: Inflow vs Outflow */}
              {finance && (
                <div className="mt-5 grid grid-cols-2 gap-3 pt-4 border-t border-white/[0.08]">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                    <div className="flex items-center gap-1.5 text-xs text-subtle">
                      <span className="size-2 rounded-full bg-neon" />
                      <span>{t("dashboard.kpiRevenue")}</span>
                    </div>
                    <div className="mt-1 text-lg font-bold tabnum text-ink">
                      {formatMinor(finance.revenue.current)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                    <div className="flex items-center gap-1.5 text-xs text-subtle">
                      <span className="size-2 rounded-full bg-amber" />
                      <span>{t("dashboard.kpiExpenses")}</span>
                    </div>
                    <div className="mt-1 text-lg font-bold tabnum text-ink">
                      {formatMinor(finance.expenses.current)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Action Pills in NeuroBank Style */}
            <div className="mt-6 pt-4 border-t border-white/[0.08] grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Link
                to="/payments"
                className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-white/[0.04] hover:bg-neon/15 hover:text-neon hover:border-neon/30 border border-white/[0.06] text-xs font-bold text-subtle transition-all"
              >
                <Banknote className="size-3.5" />
                <span>{t("dashboard.quickDeposit")}</span>
              </Link>
              <Link
                to="/expenses"
                className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-white/[0.04] hover:bg-amber/15 hover:text-amber hover:border-amber/30 border border-white/[0.06] text-xs font-bold text-subtle transition-all"
              >
                <ReceiptText className="size-3.5" />
                <span>{t("dashboard.quickExpense")}</span>
              </Link>
              <Link
                to="/attendance"
                className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-white/[0.04] hover:bg-cyan/15 hover:text-cyan hover:border-cyan/30 border border-white/[0.06] text-xs font-bold text-subtle transition-all"
              >
                <ScanLine className="size-3.5" />
                <span>{t("dashboard.quickCheckin")}</span>
              </Link>
              <Link
                to="/members?add=1"
                className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-white/[0.04] hover:bg-violet/15 hover:text-violet hover:border-violet/30 border border-white/[0.06] text-xs font-bold text-subtle transition-all"
              >
                <UserPlus className="size-3.5" />
                <span>{t("dashboard.quickAddMember")}</span>
              </Link>
            </div>
          </Card>
        </div>

        {/* 4 Stat Cards in 7 cols */}
        <div className="lg:col-span-7 grid gap-4 sm:grid-cols-2">
          <StatCard
            title={t("dashboard.statsMembers")}
            value={formatNumber(members?.totalMembers ?? stats.totalMembers)}
            icon={<Users className="size-5" />}
            accent="neon"
            subtitle={`${formatNumber(members?.activeMembers ?? stats.activeMembers)} ${t("dashboard.statsActiveMembers")}`}
          />
          <StatCard
            title={t("dashboard.statsActiveSubs")}
            value={formatNumber(members?.activeSubscriptions ?? stats.activeSubscriptions)}
            icon={<CreditCard className="size-5" />}
            accent="cyan"
          />
          <StatCard
            title={t("dashboard.statsCheckins")}
            value={formatNumber(stats.checkinsToday)}
            icon={<ScanLine className="size-5" />}
            accent="violet"
            subtitle={t("dashboard.periodToday")}
          />
          <StatCard
            title={t("dashboard.kpiNewMembers")}
            value={formatNumber(growth?.newMembers.current ?? 0)}
            icon={<UserPlus className="size-5" />}
            accent="amber"
            delta={growth ? deltaProps(growth.newMembers).delta : undefined}
            deltaDir={growth ? deltaProps(growth.newMembers).deltaDir : undefined}
            trendLabel={prevLabel}
          />
        </div>
      </section>

      {/* 3. Analytics & Revenue Breakdown (Dual Grid in NeuroBank style) */}
      <section className="grid gap-4 lg:grid-cols-12">
        {/* Main Cash Flow Chart (7 cols) */}
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

        {/* NeuroBank Revenue Breakdown (5 cols) */}
        <div className="lg:col-span-5">
          <RevenueBreakdownCard finance={finance} store={store} storeStats={storeStats} />
        </div>
      </section>

      {/* 4. Secondary Chart (Growth) & Operational Quick Alerts */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {growth && growthDataset.length > 0 && (
            <Card className="h-full">
              <CardHeader
                title={t("dashboard.chartGrowthTitle")}
                description={t("dashboard.vsPrevPeriod")}
              />
              <div className="px-5 pb-5">
                <SeriesChart series={growthDataset} />
              </div>
            </Card>
          )}
        </div>
        <div className="lg:col-span-5">
          <AlertStrip overview={overview} />
        </div>
      </section>

      {/* 5. Operational Stats & Busy Hours */}
      {operational && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link to="/payments?status=partial" className="block">
            <StatCard
              title={t("dashboard.opOutstanding")}
              subtitle={t("dashboard.opOutstandingMembers", { count: operational.membersWithOutstanding })}
              value={formatMinor(operational.outstandingTotalMinor)}
              icon={<Banknote className="size-5" />}
              accent={operational.outstandingTotalMinor > 0 ? "amber" : "neon"}
            />
          </Link>
          <StatCard
            title={t("dashboard.opExpiredSubs")}
            value={formatNumber(operational.expiredSubscriptions)}
            icon={<CalendarDays className="size-5" />}
            accent={operational.expiredSubscriptions > 0 ? "red" : "cyan"}
          />
          <StatCard
            title={t("dashboard.opLostCards")}
            value={formatNumber(operational.lostCards)}
            icon={<CreditCard className="size-5" />}
            accent="violet"
          />
          <Card className="p-5 flex flex-col justify-between">
            <p className="text-sm font-bold text-subtle">{t("dashboard.opBusyHours")}</p>
            {operational.busyHoursToday.length === 0 ? (
              <p className="mt-3 text-[12px] text-faint">{t("common.none")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {operational.busyHoursToday.map((h) => (
                  <li key={h.hour} className="flex items-center justify-between gap-2 text-[12px] font-semibold">
                    <span dir="ltr" className="tabnum text-subtle w-12">
                      {String(h.hour).padStart(2, "0")}:00
                    </span>
                    <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-cyan transition-all duration-300"
                        style={{
                          width: `${Math.max(
                            10,
                            Math.round((h.count / Math.max(1, operational.busyHoursToday[0].count)) * 100),
                          )}%`,
                        }}
                      />
                    </span>
                    <span className="w-6 text-end tabnum text-faint">{h.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* 6. Store Quick Stats */}
      {storeStats && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
          <Link to="/store" className="block">
            <StatCard
              title={t("dashboard.storeDebt")}
              value={formatMinor(store ? store.debtMinor : storeStats.creditOpenMinor)}
              icon={<Banknote className="size-5" />}
              accent={(store ? store.debtMinor : storeStats.creditOpenMinor) > 0 ? "amber" : "neon"}
            />
          </Link>
        </section>
      )}

      {/* 7. Upcoming Sessions */}
      {upcomingSessions.length > 0 && (
        <section>
          <Card>
            <CardHeader title={t("dashboard.upcomingClasses")} />
            <ul className="divide-y divide-white/[0.06] px-5 pb-4">
              {upcomingSessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-bold text-ink">{s.className}</span>
                    <span dir="ltr" className="block text-[11px] text-faint tabnum">
                      {s.sessionDate} {s.startTime}
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

      {/* 8. Expiring Subscriptions & Recent Check-ins */}
      <section className="grid gap-4 xl:grid-cols-2">
        <ExpiringCard rows={expiring} />
        <RecentCheckInsCard />
      </section>
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
    <div className="flex flex-wrap items-center gap-3">
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
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
          <span className="text-faint">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomTo(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
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
  finance: { revenue: { current: number }; expenses: { current: number }; net: { current: number } } | null;
  store: { lowStock: number; debtMinor: number } | null;
  storeStats: StoreStats | null;
}) {
  const t = useT();
  const totalRev = finance?.revenue.current ?? 0;
  const storeRev = storeStats?.revenueMinor ?? 0;
  const subRev = Math.max(0, totalRev - storeRev);

  const subPct = totalRev > 0 ? Math.min(100, Math.round((subRev / totalRev) * 100)) : 0;
  const storePct = totalRev > 0 ? Math.min(100, Math.round((storeRev / totalRev) * 100)) : 0;

  const debtMinor = store?.debtMinor ?? 0;

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
            <span className="font-semibold text-ink flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-neon shadow-glow-sm" />
              {t("dashboard.sourceSubscriptions")}
            </span>
            <span className="font-bold tabnum text-ink">
              {formatMinor(subRev)} <span className="text-subtle font-normal">({subPct}%)</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-neon transition-all duration-500"
              style={{ width: `${subPct}%` }}
            />
          </div>
        </div>

        {/* Item 2: Store */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-ink flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-cyan shadow-sm" />
              {t("dashboard.sourceStore")}
            </span>
            <span className="font-bold tabnum text-ink">
              {formatMinor(storeRev)} <span className="text-subtle font-normal">({storePct}%)</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan transition-all duration-500"
              style={{ width: `${storePct}%` }}
            />
          </div>
        </div>

        {/* Item 3: Debts */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-ink flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-amber shadow-sm" />
              {t("dashboard.sourceDebts")}
            </span>
            <span className="font-bold tabnum text-ink">
              {formatMinor(debtMinor)}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-amber transition-all duration-500"
              style={{ width: debtMinor > 0 ? (totalRev > 0 ? `${Math.min(100, Math.round((debtMinor / (totalRev + debtMinor)) * 100))}%` : "100%") : "0%" }}
            />
          </div>
        </div>
      </div>

      {/* Smart insights pill at the bottom */}
      <div className="p-3.5 mx-5 mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-3">
        <Sparkles className="size-5 text-neon shrink-0" />
        <div className="text-xs text-subtle leading-relaxed">
          <span className="font-bold text-ink">{t("dashboard.smartInsightsTitle")}: </span>
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
      <div className="grid gap-2.5 p-5">
        {visible.map((item) => (
          <Link
            key={item.label}
            to={item.link ?? "#"}
            className={cn(
              "group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-surface/80 p-3 transition-all duration-200",
              "hover:border-neon/40 hover:bg-surface",
            )}
          >
            <span
              aria-hidden
              className={cn("grid size-10 shrink-0 place-items-center rounded-xl", ACCENT_TINTS[item.accent])}
            >
              <item.icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-subtle">{item.label}</span>
              <span className="block text-lg font-extrabold leading-tight tabnum text-ink">{item.value}</span>
            </span>
            <ChevronLeft
              aria-hidden
              className="size-4 shrink-0 text-faint transition-transform group-hover:-translate-x-0.5 group-hover:text-neon"
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
  }

  const data: Row[] = rows.map((sub) => ({
    id: sub.id,
    memberId: sub.memberId,
    name: sub.memberName,
    planName: sub.planName ?? "—",
    endDateKey: sub.endDate,
    left: safeDiffDaysKeys(sub.endDate, today) ?? 0,
  }));

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("common.member"),
      render: (row) => (
        <Link to={`/members/${row.memberId}`} className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <span className="font-bold hover:text-neon text-ink">{row.name}</span>
        </Link>
      ),
    },
    {
      key: "plan",
      header: t("common.plan"),
      render: (row) => <span className="text-subtle">{row.planName}</span>,
    },
    {
      key: "end",
      header: t("common.endDate"),
      render: (row) => {
        const end = safeParseDateKey(row.endDateKey);
        return <span className="tabnum text-subtle">{end ? formatDateShort(end) : "—"}</span>;
      },
    },
    {
      key: "left",
      header: t("common.remaining"),
      render: (row) => (
        <Badge variant={row.left <= 3 ? "danger" : "warning"} dot>
          {row.left <= 0 ? t("dashboard.expiredToday") : t("dashboard.daysLeft", { days: row.left })}
        </Badge>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t("dashboard.expiringTitle")}
        action={
          hasPermission("subscriptions.view") ? (
            <Link
              to="/subscriptions"
              className="inline-flex items-center gap-1 text-xs font-bold text-neon transition-opacity hover:opacity-80"
            >
              {t("dashboard.viewAll")}
              <ChevronLeft aria-hidden className="size-3.5" />
            </Link>
          ) : undefined
        }
      />
      {hasPermission("subscriptions.view") ? (
        data.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title={t("dashboard.expiringEmpty")} />
        ) : (
          <DataTable columns={columns} data={data} rowKey={(r) => r.id} />
        )
      ) : (
        <EmptyState icon={<CalendarDays />} title={t("errors.forbidden")} />
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
    <Card>
      <CardHeader title={t("checkin.recent")} />
      {!canView ? (
        <EmptyState icon={<ScanLine />} title={t("errors.forbidden")} />
      ) : recent.length === 0 ? (
        <EmptyState icon={<ScanLine />} title={t("checkin.noScans")} />
      ) : (
        <ul className="divide-y divide-white/[0.06] px-5 pb-4">
          {recent.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-3 hover:bg-white/[0.02] px-2 rounded-xl transition-colors">
              <Avatar name={item.memberName} size="sm" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{item.memberName}</span>
                <span className="block text-[11px] font-mono text-faint">{item.memberCode}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-neon animate-pulse" />
                <span dir="ltr" className="text-xs text-subtle tabnum font-mono">
                  {item.checkinAt.slice(11, 16)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
