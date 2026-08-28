import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarDays,
  ChevronLeft,
  CreditCard,
  MessagesSquare,
  PackageCheck,
  ReceiptText,
  ScanLine,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api } from "@/api";
import type { DashboardOperationalStats, DashboardOverview } from "@/core/services/dashboard.service";
import type { StoreStats } from "@/api";
import type { SubscriptionWithMember } from "@/core/services/subscriptions.service";
import { addDaysKey, diffDaysKeys, parseDateKey, todayKey } from "@/core/dates";
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
      .stats()
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
  }, [actor, hasPermission]);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    api.dashboard
      .overview(rangeKey, rangeKey === "custom" ? customRange : undefined)
      .then((ov) => {
        if (alive) setOverview(ov);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, rangeKey, customRange]);

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
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{greeting}</h2>
          <p className="mt-1 text-sm text-subtle">{t("dashboard.subtitle")}</p>
        </div>
        <span className="hidden items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-2 text-xs font-semibold text-subtle md:inline-flex">
          <CalendarDays aria-hidden className="size-4 text-faint" />
          {formatFullHeading(new Date())}
        </span>
      </section>

      <DateRangeFilter
        value={rangeKey}
        onChange={setRangeKey}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("dashboard.statsMembers")}
          value={formatNumber(members?.totalMembers ?? stats.totalMembers)}
          icon={<Users className="size-5" />}
          accent="neon"
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
        />
        <StatCard
          title={t("dashboard.statsActiveMembers")}
          value={formatNumber(members?.activeMembers ?? stats.activeMembers)}
          icon={<BadgeCheck className="size-5" />}
          accent="amber"
        />
      </section>

      {finance && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiStat
            title={t("dashboard.kpiRevenue")}
            value={formatMinor(finance.revenue.current)}
            icon={<Banknote className="size-5" />}
            accent="neon"
            trend={finance.revenue}
            prevLabel={prevLabel}
          />
          <KpiStat
            title={t("dashboard.kpiExpenses")}
            value={formatMinor(finance.expenses.current)}
            icon={<ReceiptText className="size-5" />}
            accent="amber"
            trend={finance.expenses}
            prevLabel={prevLabel}
          />
          <KpiStat
            title={t("dashboard.kpiNet")}
            value={formatMinor(finance.net.current)}
            icon={<TrendingUp className="size-5" />}
            accent={finance.net.current >= 0 ? "cyan" : "red"}
            trend={finance.net}
            prevLabel={prevLabel}
          />
        </section>
      )}

      {growth && (
        <section>
          <CardHeader title={t("dashboard.growthTitle")} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 px-5 pb-5">
            <KpiStat
              title={t("dashboard.kpiNewMembers")}
              value={formatNumber(growth.newMembers.current)}
              icon={<UserPlus className="size-5" />}
              accent="neon"
              trend={growth.newMembers}
              prevLabel={prevLabel}
            />
            <KpiStat
              title={t("dashboard.kpiRenewals")}
              value={formatNumber(growth.renewals.current)}
              icon={<CreditCard className="size-5" />}
              accent="violet"
              trend={growth.renewals}
              prevLabel={prevLabel}
            />
            <KpiStat
              title={t("dashboard.kpiAttendance")}
              value={formatNumber(growth.attendance.current)}
              icon={<ScanLine className="size-5" />}
              accent="amber"
              trend={growth.attendance}
              prevLabel={prevLabel}
            />
          </div>
        </section>
      )}

      <AlertStrip overview={overview} />

      <section className="grid gap-4 xl:grid-cols-2">
        {finance && revenueDataset.length > 0 && (
          <Card>
            <CardHeader title={t("dashboard.chartRevenueTitle")} />
            <div className="px-5 pb-5">
              <SeriesChart series={revenueDataset} />
            </div>
          </Card>
        )}
        {growth && growthDataset.length > 0 && (
          <Card>
            <CardHeader title={t("dashboard.chartGrowthTitle")} />
            <div className="px-5 pb-5">
              <SeriesChart series={growthDataset} />
            </div>
          </Card>
        )}
      </section>

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
          <Card className="p-5">
            <p className="text-sm font-bold text-subtle">{t("dashboard.opBusyHours")}</p>
            {operational.busyHoursToday.length === 0 ? (
              <p className="mt-3 text-[12px] text-faint">{t("common.none")}</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {operational.busyHoursToday.map((h) => (
                  <li key={h.hour} className="flex items-center justify-between gap-2 text-[12px] font-semibold">
                    <span dir="ltr" className="tabnum text-subtle">
                      {String(h.hour).padStart(2, "0")}:00
                    </span>
                    <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full bg-cyan/80"
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

      {upcomingSessions.length > 0 && (
        <section>
          <Card>
            <CardHeader title={t("dashboard.upcomingClasses")} />
            <ul className="divide-y divide-line px-5 pb-4">
              {upcomingSessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-bold">{s.className}</span>
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

      <section className="grid gap-4 xl:grid-cols-2">
        <QuickActions />
        <ExpiringCard rows={expiring} />
      </section>

      <RecentCheckInsCard />
    </div>
  );
}

function KpiStat({
  title,
  value,
  icon,
  accent,
  trend,
  prevLabel,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  accent: Accent;
  trend: { deltaPct: number | null };
  prevLabel: string;
}) {
  const { delta, deltaDir } = deltaProps(trend);
  return (
    <StatCard
      title={title}
      value={value}
      icon={icon}
      accent={accent}
      delta={delta}
      deltaDir={deltaDir}
      trendLabel={prevLabel}
    />
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
  if (overview.pendingCrmMessages > 0 && hasPermission("crm.send")) {
    items.push({
      icon: MessagesSquare,
      accent: "cyan",
      label: t("dashboard.alertCrmPending"),
      value: formatNumber(overview.pendingCrmMessages),
      link: "/crm",
      show: true,
    });
  }

  const visible = items.filter((i) => i.show);

  if (visible.length === 0) return null;

  return (
    <section>
      <CardHeader title={t("dashboard.alertsTitle")} />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <Link
            key={item.label}
            to={item.link ?? "#"}
            className={cn(
              "group flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 transition-colors",
              "hover:border-neon/40",
            )}
          >
            <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-xl", ACCENT_TINTS[item.accent])}>
              <item.icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-subtle">{item.label}</span>
              <span className="block text-xl font-extrabold leading-tight tabnum">{item.value}</span>
            </span>
            <ChevronLeft aria-hidden className="size-4 shrink-0 text-faint transition-transform group-hover:-translate-x-0.5 group-hover:text-neon" />
          </Link>
        ))}
      </div>
    </section>
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
    left: diffDaysKeys(sub.endDate, today),
  }));

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("common.member"),
      render: (row) => (
        <Link to={`/members/${row.memberId}`} className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <span className="font-bold hover:text-neon">{row.name}</span>
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
      render: (row) => <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.endDateKey))}</span>,
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

function QuickActions() {
  const t = useT();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  interface Action {
    icon: LucideIcon;
    accent: Accent;
    label: string;
    desc: string;
    onClick: () => void;
  }

  const actions: Action[] = [];
  if (hasPermission("members.create")) {
    actions.push({
      icon: UserPlus,
      accent: "neon",
      label: t("dashboard.quickAddMember"),
      desc: t("dashboard.quickAddMemberDesc"),
      onClick: () => navigate("/members?add=1"),
    });
  }
  if (hasPermission("checkin.create")) {
    actions.push({
      icon: ScanLine,
      accent: "cyan",
      label: t("dashboard.quickCheckin"),
      desc: t("dashboard.quickCheckinDesc"),
      onClick: () => navigate("/checkin"),
    });
  }
  if (hasPermission("subscriptions.create")) {
    actions.push({
      icon: CalendarDays,
      accent: "violet",
      label: t("dashboard.quickAddSub"),
      desc: t("dashboard.quickAddSubDesc"),
      onClick: () => navigate("/subscriptions?add=1"),
    });
  }
  if (hasPermission("cards.assign")) {
    actions.push({
      icon: CreditCard,
      accent: "amber",
      label: t("dashboard.quickAssignCard"),
      desc: t("dashboard.quickAssignCardDesc"),
      onClick: () => navigate("/cards?assign=1"),
    });
  }

  if (actions.length === 0) return null;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={t("dashboard.quickTitle")} />
      <div className="grid flex-1 grid-cols-1 gap-3 p-5">
        {actions.map((action) => (
          <button
            key={`${action.label}-${action.desc}`}
            type="button"
            onClick={action.onClick}
            className="group flex items-center gap-3.5 rounded-xl border border-line bg-surface p-3.5 text-start transition-all duration-150 hover:border-neon/40 hover:bg-neon/[0.04] focus-visible:ring-2 focus-visible:ring-neon/50"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl transition-transform duration-150 group-hover:scale-105",
                ACCENT_TINTS[action.accent]
              )}
            >
              <action.icon className="size-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{action.label}</span>
              <span className="block truncate text-[11px] text-faint">{action.desc}</span>
            </span>
            <ChevronLeft aria-hidden className="ms-auto size-4 shrink-0 text-faint transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:text-neon" />
          </button>
        ))}
      </div>
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
        <ul className="divide-y divide-line px-5 pb-4">
          {recent.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={item.memberName} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.memberName}</span>
              <span dir="ltr" className="text-[11px] text-faint tabnum">
                {item.checkinAt.slice(11, 16)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
