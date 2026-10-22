import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Clock3,
  Coins,
  CreditCard,
  FileClock,
  FileSpreadsheet,
  Fingerprint,
  History,
  Minus,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicEmployee, type PublicUser, type SalaryType } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  AttendanceTab,
  LeavesTab,
  DeductionsTab,
  IncentivesTab,
  AdvancesTab,
  SalarySummaryTab,
  ActivityTab,
  MonthlyHoursTab,
} from "@/pages/hr-page";

export function EmployeesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState("employees");
  const canEmployees = hasPermission("employees.view");
  const canSalaries = hasPermission("salaries.view");
  const canHr = hasPermission("hr.view");
  const canActivity = hasPermission("hr.activity_view");

  const [stats, setStats] = useState({
    activeCount: 0,
    onDutyCount: 0,
    monthlyPayrollNetMinor: 0,
    openAdvancesMinor: 0,
    openAdvancesCount: 0,
    pendingLeavesCount: 0,
  });

  const loadStats = useCallback(async () => {
    try {
      const today = todayKey();
      const month = today.slice(0, 7);

      const [empsRes, attRes, salariesRes, advancesRes, leavesRes] = await Promise.all([
        canEmployees ? api.employees.list({ includeInactive: false }).catch(() => []) : Promise.resolve([]),
        canHr ? api.employeesHr.listAttendance({ dateKey: today }).catch(() => []) : Promise.resolve([]),
        canSalaries ? api.employees.listSalaries({ periodMonth: month }).catch(() => []) : Promise.resolve([]),
        canHr || canSalaries ? api.employeesHr.listAdvances({ month, status: "open" }).catch(() => []) : Promise.resolve([]),
        canHr ? api.employeesHr.listLeaves({ status: "pending" }).catch(() => []) : Promise.resolve([]),
      ]);

      const onDuty = attRes.filter((a) => a.clockInAt && !a.clockOutAt).length;
      const payrollTotal = salariesRes.reduce((sum, s) => sum + s.netMinor, 0);
      const advancesTotal = advancesRes.reduce((sum, a) => sum + a.amountMinor, 0);

      setStats({
        activeCount: empsRes.length,
        onDutyCount: onDuty,
        monthlyPayrollNetMinor: payrollTotal,
        openAdvancesMinor: advancesTotal,
        openAdvancesCount: advancesRes.length,
        pendingLeavesCount: leavesRes.length,
      });
    } catch {
      // keep fallback
    }
  }, [canEmployees, canHr, canSalaries]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const capsuleTabs = [
    ...(canEmployees
      ? [
          {
            value: "employees",
            label: t("emp.tabEmployees"),
            icon: Users,
            badge: stats.activeCount > 0 ? stats.activeCount : undefined,
          },
        ]
      : []),
    ...(canHr
      ? [
          {
            value: "attendance",
            label: t("hr.tabAttendance"),
            icon: Clock3,
            badge: stats.onDutyCount > 0 ? stats.onDutyCount : undefined,
            badgeColor: "bg-emerald-500/20 text-emerald-400",
          },
        ]
      : []),
    ...(canHr ? [{ value: "hours", label: t("hr.monthlyHours"), icon: CalendarDays }] : []),
    ...(canSalaries || canActivity
      ? [
          {
            value: "salary",
            label: t("hr.tabSalarySummary"),
            icon: Coins,
          },
        ]
      : []),
    ...(canHr
      ? [
          {
            value: "leaves",
            label: t("hr.tabLeaves"),
            icon: FileClock,
            badge: stats.pendingLeavesCount > 0 ? stats.pendingLeavesCount : undefined,
            badgeColor: "bg-purple-500/20 text-purple-400",
          },
        ]
      : []),
    ...(canHr || canSalaries
      ? [
          {
            value: "advances",
            label: t("hr.tabAdvances"),
            icon: CreditCard,
            badge: stats.openAdvancesCount > 0 ? stats.openAdvancesCount : undefined,
            badgeColor: "bg-amber-500/20 text-amber-400",
          },
        ]
      : []),
    ...(hasPermission("hr.manage") ? [{ value: "deductions", label: t("hr.tabDeductions"), icon: Minus }] : []),
    ...(hasPermission("hr.manage") ? [{ value: "incentives", label: t("hr.tabIncentives"), icon: Plus }] : []),
    ...(canActivity ? [{ value: "activity", label: t("hr.tabActivity"), icon: History }] : []),
  ];

  const activeTab = capsuleTabs.some((ct) => ct.value === tab) ? tab : capsuleTabs[0]?.value ?? "employees";

  return (
    <div className="space-y-4">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={Users}
        title="فريق العمل والموظفين والموارد البشرية (HR)"
        subtitle="إدارة الموظفين، الحضور والانصراف، كشوف المرتبات، الإجازات، والسلف المالية"
        badge={
          <Badge variant="neutral" className="font-mono text-xs">
            {stats.activeCount} موظف نشط
          </Badge>
        }
      />

      {/* 2. TOP INTERACTIVE KPI TELEMETRY STRIP */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* Active Staff */}
        <button
          type="button"
          onClick={() => setTab("employees")}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            activeTab === "employees"
              ? "border-neon/60 bg-neon/10 shadow-sm shadow-neon/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-subtle">
            <span className="text-xs font-semibold">{t("emp.kpiActiveEmployees")}</span>
            <Users className="size-4 text-faint" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black tabnum text-ink">{stats.activeCount}</span>
            <span className="text-xs text-subtle">{t("status.active")}</span>
          </div>
        </button>

        {/* On Duty Now */}
        <button
          type="button"
          onClick={() => setTab("attendance")}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            activeTab === "attendance"
              ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-xs font-semibold">{t("emp.kpiOnDutyNow")}</span>
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500"></span>
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black tabnum text-emerald-400">{stats.onDutyCount}</span>
            <span className="text-xs text-emerald-400/80">{t("hr.statusWorking")}</span>
          </div>
        </button>

        {/* Monthly Payroll */}
        <button
          type="button"
          onClick={() => setTab("salary")}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            activeTab === "salary"
              ? "border-neon/60 bg-neon/10 shadow-sm shadow-neon/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-neon">
            <span className="text-xs font-semibold">{t("emp.kpiMonthlyPayroll")}</span>
            <Coins className="size-4 text-neon" />
          </div>
          <div className="mt-1">
            <span dir="ltr" className="text-xl font-black tabnum text-neon">
              {formatMinor(stats.monthlyPayrollNetMinor)}
            </span>
          </div>
        </button>

        {/* Open Advances */}
        <button
          type="button"
          onClick={() => setTab("advances")}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            activeTab === "advances"
              ? "border-amber-500/60 bg-amber-500/10 shadow-sm shadow-amber-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-amber-400">
            <span className="text-xs font-semibold">{t("emp.kpiOpenAdvances")}</span>
            <CreditCard className="size-4 text-amber-400" />
          </div>
          <div className="mt-1">
            <span dir="ltr" className="text-xl font-black tabnum text-amber-400">
              {formatMinor(stats.openAdvancesMinor)}
            </span>
          </div>
        </button>

        {/* Pending Leaves */}
        <button
          type="button"
          onClick={() => setTab("leaves")}
          className={`col-span-2 flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 sm:col-span-1 ${
            activeTab === "leaves"
              ? "border-purple-500/60 bg-purple-500/10 shadow-sm shadow-purple-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-purple-400">
            <span className="text-xs font-semibold">{t("emp.kpiPendingLeaves")}</span>
            <CalendarDays className="size-4 text-purple-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black tabnum text-purple-400">{stats.pendingLeavesCount}</span>
            <span className="text-xs text-purple-400/80">{t("hr.leavePending")}</span>
          </div>
        </button>
      </div>

      {/* 2. CAPSULE NAVIGATION BAR */}
      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-neon/10 text-neon">
              <Users className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-ink">{t("nav.employees")}</h2>
              <p className="text-xs text-faint">إدارة الكادر البشري، الحضور والانصراف، الإجازات، ومسيرات الرواتب</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasPermission("hr.employee_checkin") && (
              <Link to="/employee-checkin">
                <Button variant="secondary" size="sm" className="border-neon/30 hover:border-neon text-neon">
                  <Fingerprint className="size-4 text-neon" />
                  {t("nav.employeeCheckIn")}
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Glass Capsule Tabs */}
        <div className="border-t border-line/60 bg-surface/30 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {capsuleTabs.map((ct) => {
              const active = activeTab === ct.value;
              const Icon = ct.icon;
              return (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => setTab(ct.value)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all duration-150 ${
                    active
                      ? "bg-neon text-dark shadow-sm shadow-neon/30"
                      : "border border-line bg-surface/60 text-subtle hover:border-line hover:bg-surface hover:text-ink"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{ct.label}</span>
                  {ct.badge !== undefined && (
                    <span
                      className={`tabnum rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                        active
                          ? "bg-dark/20 text-dark"
                          : ct.badgeColor ?? "bg-panel text-faint"
                      }`}
                    >
                      {ct.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 3. ACTIVE TAB CONTENT */}
      {activeTab === "employees" && canEmployees && <EmployeesTab onDataChanged={loadStats} />}
      {activeTab === "attendance" && canHr && <AttendanceTab onDataChanged={loadStats} />}
      {activeTab === "leaves" && canHr && <LeavesTab onDataChanged={loadStats} />}
      {activeTab === "hours" && canHr && <MonthlyHoursTab />}
      {activeTab === "deductions" && hasPermission("hr.manage") && <DeductionsTab onDataChanged={loadStats} />}
      {activeTab === "incentives" && hasPermission("hr.manage") && <IncentivesTab onDataChanged={loadStats} />}
      {activeTab === "advances" && (canHr || canSalaries) && <AdvancesTab onDataChanged={loadStats} />}
      {activeTab === "salary" && (canSalaries || canActivity) && <SalarySummaryTab onDataChanged={loadStats} />}
      {activeTab === "activity" && canActivity && <ActivityTab />}
    </div>
  );
}

// ------------------------------- employees tab --------------------------------

function EmployeesTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<PublicEmployee[]>([]);
  const [modal, setModal] = useState<{ open: boolean; target: PublicEmployee | null }>({ open: false, target: null });
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [salaryTypeFilter, setSalaryTypeFilter] = useState("all");

  const reload = useCallback(() => {
    api.employees.list({ includeInactive: true }).then(setRows).catch(console.error);
    onDataChanged?.();
  }, [onDataChanged]);
  useEffect(() => { reload(); }, [reload]);

  const { toast } = useToast();
  const [purgeTarget, setPurgeTarget] = useState<PublicEmployee | null>(null);
  const doPurge = async () => {
    if (!purgeTarget) return;
    try {
      await api.employees.purge(purgeTarget.id);
      toast("success", t("emp.purgedToast"));
      setPurgeTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const matchesName = r.fullName.toLowerCase().includes(q);
        const matchesPhone = r.phone?.toLowerCase().includes(q);
        const matchesRole = r.roleTitle?.toLowerCase().includes(q);
        const matchesSpec = r.specialization?.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesRole && !matchesSpec) return false;
      }
      if (deptFilter !== "all" && r.department !== deptFilter) return false;
      if (statusFilter === "active" && !r.isActive) return false;
      if (statusFilter === "inactive" && r.isActive) return false;
      if (salaryTypeFilter !== "all" && r.salaryType !== salaryTypeFilter) return false;
      return true;
    });
  }, [rows, search, deptFilter, statusFilter, salaryTypeFilter]);

  const onExportDirectory = () => {
    const headers = [
      "اسم الموظف",
      "الدور الوظيفي",
      "رقم الهاتف",
      "القسم",
      "التخصص",
      "تاريخ التعيين",
      "ساعات الوردية",
      "نظام الراتب",
      "الراتب الأساسي (ج.م)",
      "نسبة العمولة (%)",
      "حساب مستخدم مرتبط",
      "الحالة",
    ];
    const dataRows = filteredRows.map((r) => [
      r.fullName,
      r.roleTitle ?? "",
      r.phone ?? "",
      r.department === "men" ? "رجال" : r.department === "women" ? "سيدات" : "عام",
      r.specialization ?? "",
      r.joinedDate ?? "",
      r.shiftStart && r.shiftEnd ? `${r.shiftStart} - ${r.shiftEnd}` : "",
      r.salaryType === "monthly" ? "شهري" : r.salaryType === "daily" ? "يومي" : r.salaryType === "per_class" ? "لكل حصة" : "مخصص",
      r.salaryBaseMinor != null ? (r.salaryBaseMinor / 100).toFixed(2) : "",
      r.commissionPct != null ? `${r.commissionPct}%` : "",
      r.userId ? "نعم" : "لا",
      r.isActive ? "نشط" : "غير نشط",
    ]);
    downloadCsvWithBom(`دليل_فريق_العمل_${todayKey()}`, headers, dataRows);
  };

  const columns: Column<PublicEmployee>[] = [
    {
      key: "name",
      header: t("emp.fullName"),
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-panel border border-line text-sm font-black text-neon">
            {r.fullName.slice(0, 1)}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-bold text-ink">{r.fullName}</span>
              {r.userId && (
                <Badge variant="neutral" className="text-[10px] px-1.5 py-0">
                  {t("emp.linkedUserBadge")}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-faint">
              {r.roleTitle && <span>{r.roleTitle}</span>}
              {r.specialization && <span>• {r.specialization}</span>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("common.phone"),
      render: (r) => <span dir="ltr" className="tabnum text-subtle font-mono text-xs">{r.phone ?? "—"}</span>,
    },
    {
      key: "dept",
      header: t("members.department"),
      render: (r) => (
        <Badge variant={r.department === "men" ? "info" : r.department === "women" ? "danger" : "neutral"}>
          {r.department === "men" ? t("members.deptMen") : r.department === "women" ? t("members.deptWomen") : t("members.deptGeneral")}
        </Badge>
      ),
    },
    {
      key: "shift",
      header: t("emp.shiftHours"),
      render: (r) =>
        r.shiftStart && r.shiftEnd ? (
          <span dir="ltr" className="tabnum text-xs text-subtle font-mono font-medium">
            {r.shiftStart} - {r.shiftEnd}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "salary",
      header: t("emp.salaryBase"),
      render: (r) => {
        if (!hasPermission("salaries.view") || r.salaryBaseMinor == null) return <span>—</span>;
        const typeLabel =
          r.salaryType === "monthly"
            ? t("emp.stMonthly")
            : r.salaryType === "daily"
              ? t("emp.stDaily")
              : r.salaryType === "per_class"
                ? t("emp.stPerClass")
                : t("emp.stCustom");
        return (
          <div className="space-y-0.5">
            <span dir="ltr" className="block font-bold tabnum text-ink">{formatMinor(r.salaryBaseMinor)}</span>
            <span className="text-[10px] text-subtle">{typeLabel}</span>
          </div>
        );
      },
    },
    {
      key: "status",
      header: t("common.status"),
      render: (r) => (
        <Badge variant={r.isActive ? "success" : "neutral"} dot>
          {r.isActive ? t("status.active") : t("status.inactive")}
        </Badge>
      ),
    },
    ...(hasPermission("employees.manage") || hasPermission("employees.purge")
      ? [
          {
            key: "actions",
            header: "",
            align: "end" as const,
            render: (r: PublicEmployee) => (
              <div className="flex items-center justify-end gap-1">
                {hasPermission("employees.manage") && (
                  <button
                    type="button"
                    aria-label={t("common.edit")}
                    onClick={() => setModal({ open: true, target: r })}
                    className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-neon"
                  >
                    <Pencil className="size-4" />
                  </button>
                )}
                {hasPermission("employees.purge") && (
                  <button
                    type="button"
                    aria-label={t("emp.purgeAction")}
                    onClick={() => setPurgeTarget(r)}
                    className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-red"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("emp.tabEmployees")}
          action={
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onExportDirectory}>
                <FileSpreadsheet className="size-4 text-neon" />
                {t("emp.exportDirectoryCsv")}
              </Button>
              {hasPermission("employees.manage") && (
                <Button onClick={() => setModal({ open: true, target: null })} size="sm">
                  <UserPlus className="size-4" />
                  {t("emp.addEmployee")}
                </Button>
              )}
            </div>
          }
        />

        {/* Search & Filters */}
        <div className="flex flex-col gap-3 border-b border-line bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("emp.searchPh")}
              className="ps-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              options={[
                { value: "all", label: t("emp.allDepts") },
                { value: "general", label: t("members.deptGeneral") },
                { value: "men", label: t("members.deptMen") },
                { value: "women", label: t("members.deptWomen") },
              ]}
              className="w-32"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: t("emp.allStatuses") },
                { value: "active", label: t("status.active") },
                { value: "inactive", label: t("status.inactive") },
              ]}
              className="w-28"
            />
            <Select
              value={salaryTypeFilter}
              onChange={(e) => setSalaryTypeFilter(e.target.value)}
              options={[
                { value: "all", label: t("emp.allSalaryTypes") },
                { value: "monthly", label: t("emp.stMonthly") },
                { value: "daily", label: t("emp.stDaily") },
                { value: "per_class", label: t("emp.stPerClass") },
                { value: "custom", label: t("emp.stCustom") },
              ]}
              className="w-36"
            />
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <EmptyState icon={<UserPlus />} title={t("trainers.emptyTitle")} />
        ) : (
          <DataTable columns={columns} data={filteredRows} rowKey={(r) => r.id} />
        )}
      </Card>

      {modal.open && (
        <EmployeeFormModal
          target={modal.target}
          canSeeSalary={hasPermission("salaries.view")}
          onClose={() => setModal({ open: false, target: null })}
          onSaved={() => {
            setModal({ open: false, target: null });
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title={t("emp.purgeConfirmTitle")}
        message={purgeTarget ? t("emp.purgeConfirmMsg", { name: purgeTarget.fullName }) : ""}
        confirmLabel={t("emp.purgeAction")}
        onConfirm={() => void doPurge()}
      />
    </>
  );
}

// ------------------------------- employee form modal --------------------------------

function EmployeeFormModal({
  target,
  canSeeSalary,
  onClose,
  onSaved,
}: {
  target: PublicEmployee | null;
  canSeeSalary: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const [form, setForm] = useState({
    fullName: target?.fullName ?? "",
    phone: target?.phone ?? "",
    roleTitle: target?.roleTitle ?? "",
    department: target?.department ?? "general",
    specialization: target?.specialization ?? "",
    joinedDate: target?.joinedDate ?? "",
    salaryType: target?.salaryType ?? "monthly",
    salaryMajor: target?.salaryBaseMinor != null ? String(target.salaryBaseMinor / 100) : "",
    isActive: target?.isActive ?? true,
    notes: target?.notes ?? "",
    shiftStart: target?.shiftStart ?? "",
    shiftEnd: target?.shiftEnd ?? "",
    commissionPct: target?.commissionPct != null ? String(target.commissionPct) : "",
  });
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [linkedUserId, setLinkedUserId] = useState(target?.userId ?? "");
  const canLinkUser = target || hasPermission("users.view");

  useEffect(() => {
    if (!canLinkUser) return;
    let alive = true;
    api.users.list().then((list) => {
      if (alive) setUsers(list);
    }).catch(console.error);
    return () => {
      alive = false;
    };
  }, [canLinkUser]);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: form.fullName,
        phone: form.phone || null,
        roleTitle: form.roleTitle || null,
        department: form.department,
        specialization: form.specialization || null,
        joinedDate: form.joinedDate || null,
        shiftStart: form.shiftStart || null,
        shiftEnd: form.shiftEnd || null,
        commissionPct: form.commissionPct === "" ? null : Number(form.commissionPct),
        notes: form.notes || null,
        isActive: form.isActive,
      };
      if (canLinkUser) payload.userId = linkedUserId ? linkedUserId : null;
      if (canSeeSalary) {
        payload.salaryType = form.salaryType;
        payload.salaryBaseMinor = form.salaryMajor === "" ? null : Math.round(Number(form.salaryMajor) * 100);
      }
      if (target) await api.employees.update(target.id, payload);
      else {
        await api.employees.create(payload as never);
      }
      toast("success", t("toast.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={target ? t("emp.editEmployee") : t("emp.addEmployee")}
      widthClass="max-w-xl"
      footer={
        <>
          <Button type="submit" form="employee-form" loading={busy}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form
        id="employee-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        {/* Section 1: Basic info */}
        <div className="rounded-xl border border-line bg-surface/40 p-3.5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-neon mb-1">
            <Users className="size-3.5" />
            <span>البيانات الشخصية والوظيفية</span>
          </div>

          <Input label={t("emp.fullName")} value={form.fullName} onChange={set("fullName")} autoFocus />

          <div className="grid grid-cols-2 gap-3">
            <Input label={t("common.phone")} dir="ltr" value={form.phone} onChange={set("phone")} />
            <Input label={t("emp.roleTitle")} value={form.roleTitle} onChange={set("roleTitle")} placeholder="مدرب، استقبال، محاسب..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t("members.department")}
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value as typeof f.department }))}
              options={[
                { value: "general", label: t("members.deptGeneral") },
                { value: "men", label: t("members.deptMen") },
                { value: "women", label: t("members.deptWomen") },
              ]}
            />
            <Input label={t("emp.joinedDate")} type="date" dir="ltr" value={form.joinedDate} onChange={set("joinedDate")} />
          </div>

          <Input label={t("emp.specialization")} value={form.specialization} onChange={set("specialization")} placeholder="فتنس، ملاكمة، تغذية..." />
        </div>

        {/* Section 2: Shift Hours */}
        <div className="rounded-xl border border-line bg-surface/40 p-3.5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan mb-1">
            <Clock3 className="size-3.5" />
            <span>مواعيد وساعات الوردية</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label={t("emp.shiftStart")} type="time" dir="ltr" value={form.shiftStart} onChange={set("shiftStart")} />
            <Input label={t("emp.shiftEnd")} type="time" dir="ltr" value={form.shiftEnd} onChange={set("shiftEnd")} />
          </div>
        </div>

        {/* Section 3: Salary & Commission */}
        {canSeeSalary && (
          <div className="rounded-xl border border-line bg-surface/40 p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 mb-1">
              <Coins className="size-3.5" />
              <span>الراتب والمستحقات والعمولة</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t("emp.salaryType")}
                value={form.salaryType}
                onChange={(e) => setForm((f) => ({ ...f, salaryType: e.target.value as SalaryType }))}
                options={[
                  { value: "monthly", label: t("emp.stMonthly") },
                  { value: "daily", label: t("emp.stDaily") },
                  { value: "per_class", label: t("emp.stPerClass") },
                  { value: "custom", label: t("emp.stCustom") },
                ]}
              />
              <Input
                label={t("emp.salaryBase")}
                type="number"
                step="0.01"
                min={0}
                dir="ltr"
                value={form.salaryMajor}
                onChange={set("salaryMajor")}
              />
            </div>

            <Input
              label={t("emp.commissionPct")}
              type="number"
              step="0.1"
              min={0}
              max={100}
              dir="ltr"
              value={form.commissionPct}
              onChange={set("commissionPct")}
              placeholder="مثال: 10%"
            />
          </div>
        )}

        {/* Section 4: System User Account Link */}
        {canLinkUser && (
          <div className="rounded-xl border border-line bg-surface/40 p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-purple-400 mb-1">
              <Sparkles className="size-3.5" />
              <span>ربط حساب مستخدم في النظام</span>
            </div>
            <Select
              label={t("emp.userId")}
              value={linkedUserId}
              onChange={(e) => setLinkedUserId(e.target.value)}
              options={[
                { value: "", label: t("emp.noUserAccount") },
                ...users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.username})` })),
              ]}
            />
          </div>
        )}

        <Input label={t("common.notes")} value={form.notes} onChange={set("notes")} />

        <div className="pt-1">
          <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}>
            {form.isActive ? t("status.active") : t("status.inactive")}
          </Checkbox>
        </div>
      </form>
    </Modal>
  );
}
