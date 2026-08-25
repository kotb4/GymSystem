import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Banknote,
  CalendarDays,
  ChevronLeft,
  CreditCard,
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
import type { DashboardOperationalStats } from "@/core/services/dashboard.service";
import type { FinanceOverview } from "@/core/services/finance.service";
import type { StoreStats } from "@/api";
import type { SubscriptionWithMember } from "@/core/services/subscriptions.service";
import { diffDaysKeys, parseDateKey, todayKey } from "@/core/dates";
import { formatMinor } from "@/core/money";
import type { ChartDataset } from "@/types";
import { formatDateShort, formatFullHeading, formatNumber } from "@/services/format";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { AttendanceChart } from "@/components/charts/attendance-chart";
import { ACCENT_TINTS, type Accent } from "@/components/ui/accent";

const PERIODS = [
  { value: "week", label: "dashboard.periodWeek" },
  { value: "month", label: "dashboard.periodMonth" },
];

export function DashboardPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [period, setPeriod] = useState("week");

  const [stats, setStats] = useState({
    totalMembers: 0,
    activeMembers: 0,
    activeSubscriptions: 0,
    checkinsToday: 0,
  });
  const [expiring, setExpiring] = useState<SubscriptionWithMember[]>([]);
  const [series, setSeries] = useState<{ date: string; count: number }[]>([]);
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [operational, setOperational] = useState<DashboardOperationalStats | null>(null);
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null);
  const [upcomingSessions, setUpcomingSessions] = useState<Array<{id: string; className: string; sessionDate: string; startTime: string; bookedCount: number; capacity: number}>>([]);

  const canViewFinance = hasPermission("payments.view");

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
    if (!actor || !canViewFinance) return;
    let alive = true;
    const today = todayKey();
    void api.finance
      .overview(today, `${today.slice(0, 7)}-01`)
      .then((overview) => {
        if (alive) setFinance(overview);
      })
      .catch((err) => console.error(err));
    api.dashboard
      .operational()
      .then((opStats) => {
        if (alive) setOperational(opStats);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, canViewFinance]);

  const canViewStore = hasPermission("store.view");

  useEffect(() => {
    if (!actor || !canViewStore) return;
    let alive = true;
    const today = todayKey();
    api.store.stats({ fromKey: today, toKey: today }).then((s) => { if (alive) setStoreStats(s); }).catch(() => {});
    return () => { alive = false; };
  }, [actor, canViewStore]);

  const canViewClasses = hasPermission("classes.view");

  useEffect(() => {
    if (!actor || !canViewClasses) return;
    let alive = true;
    api.classes.listSessions({ fromDate: todayKey(), limit: 5 }).then((s) => { if (alive) setUpcomingSessions(s); }).catch(() => {});
    return () => { alive = false; };
  }, [actor, canViewClasses]);

  const days = period === "week" ? (7 as const) : (30 as const);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    api.dashboard
      .attendance(days)
      .then((points) => {
        if (alive) setSeries(points);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, days]);

  const dataset = useMemo<ChartDataset>(
    () => ({
      mode: "bars",
      points: series.map((p) => ({ label: p.date.slice(5), value: p.count })),
    }),
    [series]
  );

  const total = useMemo(() => series.reduce((s, p) => s + p.count, 0), [series]);
  const greeting = new Date().getHours() < 12 ? t("dashboard.morning") : t("dashboard.evening");

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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("dashboard.statsMembers")}
          value={formatNumber(stats.totalMembers)}
          icon={<Users className="size-5" />}
          accent="neon"
        />
        <StatCard
          title={t("dashboard.statsActiveSubs")}
          value={formatNumber(stats.activeSubscriptions)}
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
          value={formatNumber(stats.activeMembers)}
          icon={<BadgeCheck className="size-5" />}
          accent="amber"
        />
      </section>

      {finance && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title={t("dashboard.finTodayRevenue")}
            value={formatMinor(finance.todayInMinor)}
            icon={<Banknote className="size-5" />}
            accent="neon"
          />
          <StatCard
            title={t("dashboard.finTodayNet")}
            value={formatMinor(finance.todayNetMinor)}
            icon={<TrendingUp className="size-5" />}
            accent={finance.todayNetMinor >= 0 ? "cyan" : "red"}
          />
          <StatCard
            title={t("dashboard.finMonthRevenue")}
            value={formatMinor(finance.monthInMinor)}
            icon={<CreditCard className="size-5" />}
            accent="violet"
          />
          <StatCard
            title={t("dashboard.finMonthExpenses")}
            value={formatMinor(finance.monthOutMinor)}
            icon={<ReceiptText className="size-5" />}
            accent="amber"
          />
        </section>
      )}

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
              value={formatNumber(storeStats.lowStockCount)}
              icon={<BadgeCheck className="size-5" />}
              accent={storeStats.lowStockCount > 0 ? "amber" : "cyan"}
            />
          </Link>
          <Link to="/store" className="block">
            <StatCard
              title={t("dashboard.storeDebt")}
              value={formatMinor(storeStats.creditOpenMinor)}
              icon={<Banknote className="size-5" />}
              accent={storeStats.creditOpenMinor > 0 ? "amber" : "neon"}
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

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t("dashboard.chartTitle")}
            action={
              <Tabs
                items={PERIODS.map((p) => ({ value: p.value, label: t(p.label) }))}
                value={period}
                onChange={setPeriod}
              />
            }
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 pb-1 pt-3">
            <div>
              <p className="text-2xl font-extrabold leading-none tabnum">{formatNumber(total)}</p>
              <p className="mt-1.5 text-xs text-faint">{t("dashboard.chartTotal")}</p>
            </div>
          </div>
          <div className="p-5 pt-4">
            <AttendanceChart dataset={dataset} />
            <div className="mt-4 flex items-center gap-4 border-t border-line pt-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-subtle">
                <span aria-hidden className="size-2 rounded-full bg-neon" />
                {t("dashboard.legend")}
              </span>
            </div>
          </div>
        </Card>

        <QuickActions />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
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
            <ExpiringTable rows={expiring} />
          ) : (
            <EmptyState icon={<CalendarDays />} title={t("errors.forbidden")} />
          )}
        </Card>

        <RecentCheckInsCard />
      </section>
    </div>
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
      <div className="grid flex-1 grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-1">
        {actions.map((action) => (
          <button
            key={action.label}
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

function ExpiringTable({ rows }: { rows: SubscriptionWithMember[] }) {
  const t = useT();
  const today = todayKey();

  interface Row {
    id: string;
    name: string;
    planName: string;
    endDateKey: string;
    left: number;
  }

  const data: Row[] = rows.map((sub) => ({
    id: sub.id,
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
        <Link to={`/members/${rows.find((s) => s.id === row.id)?.memberId ?? ""}`} className="flex items-center gap-2.5">
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

  if (data.length === 0) {
    return <EmptyState icon={<CalendarDays />} title={t("dashboard.expiringEmpty")} />;
  }

  return <DataTable columns={columns} data={data} rowKey={(r) => r.id} />;
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
