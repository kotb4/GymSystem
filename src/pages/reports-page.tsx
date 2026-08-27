import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarCheck, Clock3, ReceiptText, ScrollText, TrendingDown, TrendingUp, Users, Banknote } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api } from "@/api";
import type { PeriodReport } from "@/core/services/financial-report.service";
import type {
  AttendanceAnalytics,
  MemberVisitRow,
} from "@/core/services/attendance-analytics.service";
import type { StaffActivityEntry } from "@/core/services/staff-activity.service";
import { formatMinor } from "@/core/money";
import { addDaysKey, todayKey } from "@/core/dates";
import { formatNumber } from "@/services/format";
import type { ServiceActor } from "@/core/permissions";

import type { ChartDataset } from "@/types";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type Column } from "@/components/ui/table";
import { AttendanceChart } from "@/components/charts/attendance-chart";

type PeriodValue = "today" | "week" | "month" | "custom";
type ReportView = "finance" | "attendance" | "staff";

const PERIODS: Array<{ value: string; key: string }> = [
  { value: "today", key: "rpt.periodToday" },
  { value: "week", key: "rpt.periodWeek" },
  { value: "month", key: "rpt.periodMonth" },
  { value: "custom", key: "rpt.periodCustom" },
];

const VIEWS: Array<{ value: ReportView; key: string }> = [
  { value: "finance", key: "rpt.tabFinance" },
  { value: "attendance", key: "rpt.tabAttendance" },
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
  const [customFrom, setCustomFrom] = useState(rangeFor("month").fromKey);
  const [customTo, setCustomTo] = useState(todayKey());
  const [appliedCustom, setAppliedCustom] = useState<{ fromKey: string; toKey: string }>(rangeFor("month"));
  const [report, setReport] = useState<PeriodReport | null>(null);

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
      .period(range.fromKey, range.toKey)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, period, appliedCustom, hasPermission, view]);

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

  const detailedPaymentColumns: Column<NonNullable<PeriodReport["detailedPayments"][number]>>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{row.paidAt.slice(0, 16)}</span> },
    { key: "member", header: t("pay.colMember"), render: (row) => <span className="font-bold">{row.memberName} · {row.memberCode}</span> },
    { key: "plan", header: t("pay.colPlan"), render: (row) => <span className="text-subtle">{row.planName}</span> },
    { key: "net", header: t("pay.colNet"), render: (row) => <span dir="ltr" className="font-extrabold tabnum">{formatMinor(row.netMinor)}</span> },
    { key: "paid", header: t("pay.colPaid"), render: (row) => <span dir="ltr" className="font-bold tabnum text-emerald">{formatMinor(row.paidMinor)}</span> },
    { key: "remaining", header: t("pay.colRemaining"), render: (row) => row.status === "voided" ? <span className="text-faint">—</span> : row.remainingMinor > 0 ? <span dir="ltr" className="font-bold tabnum text-red">{formatMinor(row.remainingMinor)}</span> : <span className="text-faint">0.00</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    { key: "status", header: t("pay.colStatus"), render: (row) => <span className="text-subtle">{t(`payStatus.${row.status}`)}</span> },
    { key: "reason", header: t("pay.colReason"), render: (row) => row.voidReason ? <span className="text-[12px] text-subtle max-w-32 truncate block" title={row.voidReason}>{row.voidReason}</span> : row.refundReason ? <span className="text-[12px] text-subtle max-w-32 truncate block" title={row.refundReason}>{row.refundReason}</span> : <span className="text-faint">—</span> },
  ];

  const detailedExpenseColumns: Column<NonNullable<PeriodReport["detailedExpenses"][number]>>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{row.date}</span> },
    { key: "category", header: t("exp.filterCategory"), render: (row) => <span className="font-bold">{row.categoryName}</span> },
    { key: "amount", header: t("exp.colAmount"), render: (row) => <span dir="ltr" className="font-extrabold tabnum text-red">{formatMinor(row.amountMinor)}</span> },
    { key: "desc", header: t("rpt.colDescription"), render: (row) => <span className="text-subtle max-w-40 truncate block" title={row.description}>{row.description}</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    { key: "voidReason", header: t("rpt.colVoidReason"), render: (row) => row.voidReason ? <span className="text-[12px] text-subtle max-w-32 truncate block" title={row.voidReason}>{row.voidReason}</span> : <span className="text-faint">—</span> },
  ];

  const detailedRefundColumns: Column<NonNullable<PeriodReport["detailedRefunds"][number]>>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{row.createdAt.slice(0, 16)}</span> },
    { key: "member", header: t("pay.colMember"), render: (row) => <span className="font-bold">{row.memberName}</span> },
    { key: "amount", header: t("exp.colAmount"), render: (row) => <span dir="ltr" className="font-extrabold tabnum text-amber">{formatMinor(row.amountMinor)}</span> },
    { key: "reason", header: t("rpt.colRefundReason"), render: (row) => <span className="text-[12px] text-subtle max-w-40 truncate block" title={row.reason}>{row.reason}</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
  ];

  const detailedVoidColumns: Column<NonNullable<PeriodReport["detailedVoids"][number]>>[] = [
    { key: "date", header: t("rpt.colDate"), render: (row) => <span dir="ltr" className="tabnum text-subtle">{row.voidedAt.slice(0, 16)}</span> },
    { key: "member", header: t("pay.colMember"), render: (row) => <span className="font-bold">{row.memberName}</span> },
    { key: "amount", header: t("pay.colPaid"), render: (row) => <span dir="ltr" className="font-extrabold tabnum text-red">{formatMinor(row.amountMinor)}</span> },
    { key: "reason", header: t("rpt.colVoidReason"), render: (row) => <span className="text-[12px] text-subtle max-w-40 truncate block" title={row.voidReason}>{row.voidReason}</span> },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
  ];

  if (!hasPermission("reports.view")) {
    return <EmptyState icon={<BarChart3 />} title={t("errors.forbidden")} />;
  }

  const activeRange = period === "custom" ? appliedCustom : rangeFor(period);

  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-2xl font-extrabold tracking-tight">{t("rpt.title")}</h2>
        <p className="mt-1 text-sm text-subtle">{t("rpt.subtitle")}</p>
      </section>

      <Tabs
        items={VIEWS.map((v) => ({ value: v.value, label: t(v.key) }))}
        value={view}
        onChange={(value) => setView(value as ReportView)}
      />

      <Tabs
        items={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
        value={period}
        onChange={(value) => setPeriod(value as PeriodValue)}
      />

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
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title={t("rpt.revenue")}
              subtitle={`${t("rpt.count", { count: report.paymentCount })}`}
              value={formatMinor(report.revenueMinor)}
              icon={<TrendingUp className="size-5" />}
              accent="neon"
            />
            <StatCard
              title={t("rpt.expenses")}
              value={formatMinor(report.expensesMinor)}
              icon={<TrendingDown className="size-5" />}
              accent="red"
            />
            <StatCard
              title={t("rpt.netResult")}
              value={formatMinor(report.netResultMinor)}
              icon={<BarChart3 className="size-5" />}
              accent={report.netResultMinor >= 0 ? "cyan" : "red"}
            />
            <StatCard
              title={t("rpt.refunds")}
              subtitle={`${t("rpt.avgTicket")}: ${formatMinor(report.avgTicketMinor)}`}
              value={formatMinor(report.refundsMinor)}
              icon={<ReceiptText className="size-5" />}
              accent="amber"
            />
          </section>

          {chartDataset && chartDataset.points.length > 0 && (
            <Card>
              <CardHeader title={t("rpt.overTime")} />
              <div className="px-4 pb-4">
                <AttendanceChart dataset={chartDataset} />
              </div>
            </Card>
          )}

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

          <Card>
            <CardHeader title={t("rpt.detailPayments")} description={`${report.detailedPayments.length} عملية`} />
            {report.detailedPayments.length === 0 ? (
              <EmptyState icon={<Banknote />} title={t("rpt.emptyRange")} />
            ) : (
              <DataTable columns={detailedPaymentColumns} data={report.detailedPayments} rowKey={(r) => r.id} />
            )}
          </Card>

          <Card>
            <CardHeader title={t("rpt.detailExpenses")} description={`${report.detailedExpenses.length} مصروف`} />
            {report.detailedExpenses.length === 0 ? (
              <EmptyState icon={<TrendingDown />} title={t("rpt.emptyRange")} />
            ) : (
              <DataTable columns={detailedExpenseColumns} data={report.detailedExpenses} rowKey={(r) => r.id} />
            )}
          </Card>

          {report.detailedRefunds.length > 0 && (
            <Card>
              <CardHeader title={t("rpt.detailRefunds")} description={`${report.detailedRefunds.length} استرداد`} />
              <DataTable columns={detailedRefundColumns} data={report.detailedRefunds} rowKey={(r) => r.id} />
            </Card>
          )}

          {report.detailedVoids.length > 0 && (
            <Card>
              <CardHeader title={t("rpt.detailVoids")} description={`${report.detailedVoids.length} إلغاء`} />
              <DataTable columns={detailedVoidColumns} data={report.detailedVoids} rowKey={(r) => r.id} />
            </Card>
          )}
        </>
      ))}

      {view === "attendance" && (
        <AttendanceReportView range={activeRange} />
      )}

      {view === "staff" && (
        <StaffActivityView actor={actor} range={activeRange} />
      )}
    </div>
  );
}

function AttendanceReportView({ range }: { range: { fromKey: string; toKey: string } }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [analytics, setAnalytics] = useState<AttendanceAnalytics | null>(null);

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
        <span dir="ltr" className="tabnum text-subtle">{row.lastVisitAt?.slice(0, 16) ?? "—"}</span>
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

function StaffActivityView({
  actor,
  range,
}: {
  actor: ServiceActor | null;
  range: { fromKey: string; toKey: string };
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
        <span dir="ltr" className="tabnum text-subtle">{row.lastAt.slice(0, 16)}</span>
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
