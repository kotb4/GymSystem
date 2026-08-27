import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  AlarmClock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  FileClock,
  HandCoins,
  ListChecks,
  LogIn,
  LogOut,
  Minus,
  Plus,
  History,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type PublicEmployee,
  type PublicAttendance,
  type PublicLeave,
  type LeaveType,
  type LeaveStatus,
  type PublicHrAmount,
  type PublicSalarySummary,
  type PublicDailyActivity,
} from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function HrPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState("attendance");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("nav.hr")} />
        <div className="px-5 pb-1">
          <Tabs
            items={[
              { value: "attendance", label: t("hr.tabAttendance") },
              { value: "leaves", label: t("hr.tabLeaves") },
              { value: "deductions", label: t("hr.tabDeductions") },
              { value: "incentives", label: t("hr.tabIncentives") },
              ...(hasPermission("salaries.view") || hasPermission("hr.activity_view")
                ? [{ value: "salary", label: t("hr.tabSalarySummary") }]
                : []),
              ...(hasPermission("hr.activity_view")
                ? [{ value: "activity", label: t("hr.tabActivity") }]
                : []),
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </Card>
      {tab === "attendance" && <AttendanceTab />}
      {tab === "leaves" && <LeavesTab />}
      {tab === "deductions" && <DeductionsTab />}
      {tab === "incentives" && <IncentivesTab />}
      {tab === "salary" && <SalarySummaryTab />}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}

function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ------------------------------- attendance ------------------------------

function AttendanceTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const isManager = hasPermission("hr.manage");
  const { toast } = useToast();
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [rows, setRows] = useState<PublicAttendance[]>([]);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ dateKey: string; employeeId: string; clockIn: string; clockOut: string } | null>(null);

  const reload = useCallback(() => {
    api.employeesHr.listAttendance({ month, employeeId: empFilter === "all" ? null : empFilter }).then(setRows).catch(console.error);
  }, [month, empFilter]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (isManager) api.employees.list({ includeInactive: false }).then(setEmployees).catch(console.error);
  }, [isManager]);

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.employeesHr.upsertAttendance({
        employeeId: editing.employeeId,
        dateKey: editing.dateKey,
        clockInAt: editing.clockIn,
        clockOutAt: editing.clockOut || null,
      });
      toast("success", t("hr.savedToast"));
      setEditing(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<PublicAttendance>[] = [
    { key: "date", header: t("hr.dateKey"), render: (r) => <span dir="ltr" className="tabnum">{r.dateKey}</span> },
    ...(isManager ? [{ key: "emp", header: t("emp.fullName"), render: (r: PublicAttendance) => <span className="font-bold">{r.employeeName}</span> }] : []),
    { key: "in", header: t("hr.clockInAt"), render: (r) => <span dir="ltr" className="tabnum">{r.clockInAt.slice(11, 19)}</span> },
    { key: "out", header: t("hr.clockOutAt"), render: (r) => r.clockOutAt ? <span dir="ltr" className="tabnum">{r.clockOutAt.slice(11, 19)}</span> : <span className="text-faint">—</span> },
    { key: "worked", header: t("hr.workedHours"), render: (r) => r.workedMinutes > 0 ? <span dir="ltr" className="tabnum">{hoursLabel(r.workedMinutes)}</span> : <span>—</span> },
    { key: "late", header: t("common.status"), render: (r) => r.isLate ? <Badge variant="danger">{t("hr.late")}</Badge> : <Badge variant="success">{t("hr.onTime")}</Badge> },
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("hr.attendanceTable")}
          action={
            <div className="flex items-center gap-2">
              {!isManager && (
                <SelfClockButtons onDone={reload} />
              )}
              <Input type="month" dir="ltr" value={month} onChange={(e: ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} className="w-36" />
              {isManager && employees.length > 0 && (
                <Select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} options={[
                  { value: "all", label: t("emp.fullName") + " — " + t("hr.pickEmployee") },
                  ...employees.map((e) => ({ value: e.id, label: e.fullName })),
                ]} className="w-44" />
              )}
            </div>
          }
        />
        {rows.length === 0 ? <EmptyState icon={<CalendarDays />} title={t("hr.noAttendanceToday")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {isManager && (
        <Card>
          <CardHeader title={t("hr.addAttendance")} action={
            employees.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing({ dateKey: todayKey(), employeeId: employees[0].id, clockIn: "", clockOut: "" })}>
                <Plus className="size-3.5" />{t("hr.addAttendance")}
              </Button>
            ) : undefined
          } />
          {employees.length === 0 && <EmptyState icon={<UserPlus />} title={t("hr.noAttendanceToday")} />}
        </Card>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={t("hr.editAttendance")} widthClass="max-w-sm"
          footer={<><Button onClick={saveEdit}>{t("hr.saveAttendance")}</Button><Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button></>}>
          <div className="space-y-3.5">
            <Select label={t("emp.fullName")} value={editing.employeeId} onChange={(e) => setEditing((s) => s && { ...s, employeeId: e.target.value })} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} />
            <Input label={t("hr.dateKey")} type="date" dir="ltr" value={editing.dateKey} onChange={(e) => setEditing((s) => s && { ...s, dateKey: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t("hr.clockInAt")} dir="ltr" value={editing.clockIn} onChange={(e) => setEditing((s) => s && { ...s, clockIn: e.target.value })} placeholder="YYYY-MM-DD HH:MM:SS" />
              <Input label={t("hr.clockOutAt")} dir="ltr" value={editing.clockOut} onChange={(e) => setEditing((s) => s && { ...s, clockOut: e.target.value })} placeholder="YYYY-MM-DD HH:MM:SS" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function SelfClockButtons({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const act = async (k: "in" | "out") => {
    setBusy(k);
    try {
      if (k === "in") await api.employeesHr.clockIn({});
      else await api.employeesHr.clockOut({});
      toast("success", k === "in" ? t("hr.clockInToast") : t("hr.clockOutToast"));
      onDone();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" loading={busy === "in"} onClick={() => void act("in")}><LogIn className="size-3.5" />{t("hr.clockIn")}</Button>
      <Button size="sm" variant="secondary" loading={busy === "out"} onClick={() => void act("out")}><LogOut className="size-3.5" />{t("hr.clockOut")}</Button>
    </div>
  );
}

// ------------------------------- leaves -----------------------------------

function LeavesTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const isManager = hasPermission("hr.manage");
  const { toast } = useToast();
  const [rows, setRows] = useState<PublicLeave[]>([]);
  const [balance, setBalance] = useState<{ entitlement: number; used: number; remaining: number }>({ entitlement: 0, used: 0, remaining: 0 });
  const [requesting, setRequesting] = useState(false);
  const [decideTarget, setDecideTarget] = useState<PublicLeave | null>(null);
  const [decideApprove, setDecideApprove] = useState(true);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);

  const reload = useCallback(() => {
    api.employeesHr.listLeaves({ status: "all" }).then(setRows).catch(console.error);
    api.employeesHr.getLeaveBalance({}).then(setBalance).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (isManager) api.employees.list({ includeInactive: false }).then(setEmployees).catch(console.error);
  }, [isManager]);

  const leaveTypeLabel = (lt: LeaveType) =>
    lt === "annual" ? t("hr.ltAnnual") : lt === "sick" ? t("hr.ltSick") : lt === "unpaid" ? t("hr.ltUnpaid") : t("hr.ltEmergency");
  const statusVariant = (s: LeaveStatus): "success" | "warning" | "danger" | "neutral" =>
    s === "approved" ? "success" : s === "pending" ? "warning" : s === "rejected" ? "danger" : "neutral";
  const statusLabel = (s: LeaveStatus) =>
    s === "approved" ? t("hr.leaveApproved") : s === "rejected" ? t("hr.leaveRejected") : s === "cancelled" ? t("hr.leaveCancelled") : t("hr.leavePending");

  const decide = async () => {
    if (!decideTarget) return;
    try {
      const approve = decideApprove;
      await api.employeesHr.decideLeave({ leaveId: decideTarget.id, approve, decisionNote: "" });
      toast("success", approve ? t("hr.leaveApproved") : t("hr.leaveRejected"));
      setDecideTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<PublicLeave>[] = [
    ...(isManager ? [{ key: "emp", header: t("emp.fullName"), render: (r: PublicLeave) => <span className="font-bold">{r.employeeName}</span> }] : []),
    { key: "type", header: t("hr.leaveType"), render: (r) => leaveTypeLabel(r.leaveType) },
    { key: "period", header: t("hr.leaveStart"), render: (r) => <span dir="ltr" className="tabnum">{r.startDate} → {r.endDate}</span> },
    { key: "days", header: t("hr.leaveDays"), render: (r) => <span dir="ltr" className="tabnum">{r.days}</span> },
    { key: "reason", header: t("hr.leaveReason"), render: (r) => <span className="text-subtle">{r.reason ?? "—"}</span> },
    { key: "status", header: t("hr.leaveStatus"), render: (r) => <Badge variant={statusVariant(r.status)} dot>{statusLabel(r.status)}</Badge> },
    ...(isManager ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: PublicLeave) => r.status === "pending" ? (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => { setDecideApprove(true); setDecideTarget(r); }}><ListChecks className="size-3.5" />{t("hr.approve")}</Button>
          <Button size="sm" variant="ghost" className="text-red" onClick={() => { setDecideApprove(false); setDecideTarget(r); }}><Minus className="size-3.5" />{t("hr.reject")}</Button>
        </div>
      ) : null,
    }] : []),
  ];

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile icon={CalendarDays} label={t("hr.leaveEntitlement")} value={String(balance.entitlement)} />
        <SummaryTile icon={FileClock} label={t("hr.leaveUsed")} value={String(balance.used)} />
        <SummaryTile icon={Clock3} label={t("hr.leaveRemaining")} value={String(balance.remaining)} />
      </div>
      <Card>
        <CardHeader title={t("hr.tabLeaves")} action={
          hasPermission("hr.view") ? <Button onClick={() => setRequesting(true)}><Plus className="size-4" />{t("hr.requestLeave")}</Button> : undefined
        } />
        {rows.length === 0 ? <EmptyState icon={<CalendarDays />} title={t("hr.noAttendanceToday")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {requesting && (
        <RequestLeaveModal
          isManager={isManager}
          employees={employees}
          onClose={() => setRequesting(false)}
          onSaved={() => { setRequesting(false); reload(); }}
        />
      )}
      <ConfirmDialog
        open={decideTarget !== null}
        onClose={() => setDecideTarget(null)}
        title={decideApprove ? t("hr.approve") : t("hr.reject")}
        message={decideTarget ? `${decideTarget.employeeName} — ${leaveTypeLabel(decideTarget.leaveType)} ${decideTarget.days} يوم` : ""}
        confirmLabel={decideApprove ? t("common.confirm") : t("common.cancel")}
        onConfirm={() => void decide()}
      />
    </>
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-neon/10 text-neon"><Icon className="size-5" /></div>
      <div>
        <div className="text-[12px] text-subtle">{label}</div>
        <div className="text-xl font-extrabold tabnum">{value}</div>
      </div>
    </div>
  );
}

function RequestLeaveModal({ isManager, employees, onClose, onSaved }: {
  isManager: boolean;
  employees: PublicEmployee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({
    employeeId: employees[0]?.id ?? "",
    leaveType: "annual" as LeaveType,
    startDate: todayKey(),
    endDate: todayKey(),
    reason: "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.employeesHr.requestLeave({
        employeeId: isManager ? form.employeeId || null : null,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || null,
      });
      toast("success", t("hr.requestLeave"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("hr.requestLeave")} widthClass="max-w-sm"
      footer={<><Button loading={busy} onClick={save}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <div className="space-y-3.5">
        {isManager && (
          <Select label={t("emp.fullName")} value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} />
        )}
        <Select label={t("hr.leaveType")} value={form.leaveType} onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value as LeaveType }))} options={[
          { value: "annual", label: t("hr.ltAnnual") },
          { value: "sick", label: t("hr.ltSick") },
          { value: "unpaid", label: t("hr.ltUnpaid") },
          { value: "emergency", label: t("hr.ltEmergency") },
        ]} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("hr.leaveStart")} type="date" dir="ltr" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          <Input label={t("hr.leaveEnd")} type="date" dir="ltr" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
        </div>
        <Input label={t("hr.leaveReason")} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
      </div>
    </Modal>
  );
}

// --------------------------- deductions/incentives ------------------------

function DeductionsTab() {
  const t = useT();
  return <AmountTab kind="deduction" title={t("hr.tabDeductions")} addLabel={t("hr.addDeduction")} emptyTitle={t("hr.noAttendanceToday")} />;
}
function IncentivesTab() {
  const t = useT();
  return <AmountTab kind="incentive" title={t("hr.tabIncentives")} addLabel={t("hr.addIncentive")} emptyTitle={t("hr.noAttendanceToday")} />;
}

function AmountTab({ kind, title, addLabel, emptyTitle }: { kind: "deduction" | "incentive"; title: string; addLabel: string; emptyTitle: string }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const isManager = hasPermission("hr.manage");
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [rows, setRows] = useState<PublicHrAmount[]>([]);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [adding, setAdding] = useState(false);

  const fetchRows = useCallback(() => {
    const p = kind === "deduction" ? api.employeesHr.listDeductions : api.employeesHr.listIncentives;
    p({ month }).then(setRows).catch(console.error);
  }, [kind, month]);
  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    if (isManager) api.employees.list({ includeInactive: false }).then(setEmployees).catch(console.error);
  }, [isManager]);

  const Icon = kind === "deduction" ? Minus : Plus;

  const columns: Column<PublicHrAmount>[] = [
    ...(isManager ? [{ key: "emp", header: t("emp.fullName"), render: (r: PublicHrAmount) => <span className="font-bold">{r.employeeName}</span> }] : []),
    { key: "date", header: t("hr.dateKey"), render: (r) => <span dir="ltr" className="tabnum">{r.dateKey}</span> },
    { key: "reason", header: t("hr.reason"), render: (r) => <span className="text-subtle">{r.reason}</span> },
    { key: "amount", header: t("hr.amount"), render: (r) => <span dir="ltr" className={`font-bold tabnum ${kind === "deduction" ? "text-red" : "text-neon"}`}>{formatMinor(r.amountMinor)}</span> },
  ];

  return (
    <>
      <Card>
        <CardHeader title={title} action={
          <div className="flex items-center gap-2">
            {isManager && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" />{addLabel}</Button>}
            <Input type="month" dir="ltr" value={month} onChange={(e: ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} className="w-36" />
          </div>
        } />
        {rows.length === 0 ? <EmptyState icon={<Icon />} title={emptyTitle} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {adding && (
        <AddAmountModal
          kind={kind}
          employees={employees}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); fetchRows(); }}
        />
      )}
    </>
  );
}

function AddAmountModal({ kind, employees, onClose, onSaved }: {
  kind: "deduction" | "incentive";
  employees: PublicEmployee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({ employeeId: employees[0]?.id ?? "", amountMajor: "", reason: "", dateKey: todayKey() });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const amountMinor = Math.round(Number(form.amountMajor || 0) * 100);
      if (!form.employeeId || amountMinor <= 0 || form.reason.trim().length < 2) throw new Error("validation");
      const input = { employeeId: form.employeeId, amountMinor, reason: form.reason, dateKey: form.dateKey };
      if (kind === "deduction") await api.employeesHr.addDeduction(input);
      else await api.employeesHr.addIncentive(input);
      toast("success", kind === "deduction" ? t("hr.deductionCreated") : t("hr.incentiveCreated"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={kind === "deduction" ? t("hr.addDeduction") : t("hr.addIncentive")} widthClass="max-w-sm"
      footer={<><Button loading={busy} onClick={save}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <div className="space-y-3.5">
        <Select label={t("emp.fullName")} value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("hr.amount")} type="number" step="0.01" min={0} dir="ltr" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} />
          <Input label={t("hr.dateKey")} type="date" dir="ltr" value={form.dateKey} onChange={(e) => setForm((f) => ({ ...f, dateKey: e.target.value }))} />
        </div>
        <Input label={t("hr.reason")} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
      </div>
    </Modal>
  );
}

// ----------------------------- salary summary ----------------------------

function SalarySummaryTab() {
  const t = useT();
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [empId, setEmpId] = useState("");
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [summary, setSummary] = useState<PublicSalarySummary | null>(null);

  useEffect(() => {
    api.employees.list({ includeInactive: false }).then((list) => {
      setEmployees(list);
      setEmpId((prev) => prev || list[0]?.id || "");
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!empId) { setSummary(null); return; }
    api.employeesHr.monthlySalarySummary({ employeeId: empId, periodMonth: month }).then(setSummary).catch(() => setSummary(null));
  }, [empId, month]);

  return (
    <Card>
      <CardHeader title={t("hr.tabSalarySummary")} action={
        <div className="flex items-center gap-2">
          <Input type="month" dir="ltr" value={month} onChange={(e: ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} className="w-36" />
          <Select value={empId} onChange={(e) => setEmpId(e.target.value)} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} className="w-44" />
        </div>
      } />
      {!summary ? (
        <EmptyState icon={<Wallet />} title={t("hr.noAttendanceToday")} />
      ) : (
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <span className="font-bold">{summary.employeeName}</span>
            {summary.alreadyRecorded && <Badge variant="neutral">{t("hr.alreadyRecordedSalary")}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SummaryTile icon={Banknote} label={t("hr.baseSalary")} value={formatMinor(summary.baseMinor)} />
            <SummaryTile icon={CircleDollarSign} label={t("hr.incentivesTotal")} value={formatMinor(summary.incentivesMinor)} />
            <SummaryTile icon={Minus} label={t("hr.deductionsTotal")} value={formatMinor(summary.deductionsMinor)} />
            <SummaryTile icon={CalendarDays} label={t("hr.attendedDays")} value={String(summary.attendedDays)} />
          </div>
          <p className="flex items-center justify-between rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm">
            <span>{t("hr.unpaidLeaveImpact")} ({summary.unpaidLeaveDays} يوم)</span>
            <span dir="ltr" className="font-bold tabnum text-red">-{formatMinor(summary.unpaidLeaveImpactMinor)}</span>
          </p>
          <p className="flex items-center justify-between border-t border-line pt-3 text-lg font-extrabold">
            <span>{t("hr.netSalary")}</span>
            <span dir="ltr" className="tabnum text-neon">{formatMinor(summary.netMinor)}</span>
          </p>
        </div>
      )}
    </Card>
  );
}

// ------------------------------- activity ---------------------------------

function ActivityTab() {
  const t = useT();
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [empId, setEmpId] = useState("");
  const [dateKey, setDateKey] = useState(todayKey());
  const [activity, setActivity] = useState<PublicDailyActivity | null>(null);

  useEffect(() => {
    api.employees.list({ includeInactive: false }).then((list) => {
      setEmployees(list);
      setEmpId((prev) => prev || list[0]?.id || "");
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!empId) { setActivity(null); return; }
    api.employeesHr.employeeDailyActivity({ employeeId: empId, dateKey }).then(setActivity).catch(() => setActivity(null));
  }, [empId, dateKey]);

  const totals = activity?.totals;
  const entries = useMemo(() => activity?.entries ?? [], [activity]);

  const categoryLabel = (cat: string, label: string) =>
    cat === "attendance"
      ? (label === "clockIn" ? t("hr.clockIn") : t("hr.clockOut"))
      : cat === "subscription" ? t("hr.actSubscription")
      : cat === "sale" ? t("hr.actSale")
      : cat === "payment" ? t("hr.actPayment")
      : cat === "expense" ? t("hr.actExpense")
      : label;

  return (
    <Card>
      <CardHeader title={t("hr.activityFor")} action={
        <div className="flex items-center gap-2">
          <Input type="date" dir="ltr" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className="w-40" />
          <Select value={empId} onChange={(e) => setEmpId(e.target.value)} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} className="w-44" />
        </div>
      } />
      {!totals ? (
        <EmptyState icon={<History />} title={t("hr.noActivity")} />
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ActivityStat icon={LogIn} label={t("hr.attendanceIn")} value={String(totals.attendanceIn)} />
            <ActivityStat icon={LogOut} label={t("hr.attendanceOut")} value={String(totals.attendanceOut)} />
            <ActivityStat icon={CalendarDays} label={t("hr.subscriptionsSold")} value={`${totals.subscriptionsSold} — ${formatMinor(totals.subscriptionsTotalMinor)}`} />
            <ActivityStat icon={HandCoins} label={t("hr.storeSales")} value={`${totals.storeSales} — ${formatMinor(totals.storeSalesTotalMinor)}`} />
            <ActivityStat icon={ArrowDownToLine} label={t("hr.paymentsReceived")} value={`${totals.paymentsReceived} — ${formatMinor(totals.paymentsTotalMinor)}`} />
            <ActivityStat icon={ArrowUpFromLine} label={t("hr.expensesRecorded")} value={`${totals.expensesRecorded} — ${formatMinor(totals.expensesTotalMinor)}`} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ActivityStat icon={AlarmClock} label={t("hr.auditedActions")} value={String(totals.auditedActions)} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold text-subtle">{t("hr.timeline")}</h3>
            {entries.length === 0 ? (
              <EmptyState icon={<History />} title={t("hr.noActivity")} />
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
                {entries.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span dir="ltr" className="w-16 shrink-0 tabnum text-faint">{e.time}</span>
                    <span className="w-40 shrink-0 text-subtle">{categoryLabel(e.category, e.label)}</span>
                    <span className="min-w-0 flex-1 truncate">{e.reference ?? "—"}</span>
                    {e.amountMinor > 0 && <span dir="ltr" className="shrink-0 font-bold tabnum">{formatMinor(e.amountMinor)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function ActivityStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-neon/10 text-neon"><Icon className="size-4" /></div>
      <div className="min-w-0">
        <div className="text-[11px] text-subtle">{label}</div>
        <div dir="ltr" className="truncate text-sm font-bold tabnum">{value}</div>
      </div>
    </div>
  );
}
