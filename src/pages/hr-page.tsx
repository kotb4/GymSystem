import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  AlarmClock,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  Check,
  Clock3,
  FileClock,
  HandCoins,
  ListChecks,
  LogIn,
  LogOut,
  Minus,
  Plus,
  Pencil,
  Printer,
  Trash2,
  History,
  UserPlus,
  Wallet,
  X,
  CreditCard,
  Calculator,
  Eye,
  FileSpreadsheet,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import {
  api,
  type PublicEmployee,
  type PublicAttendance,
  type PublicLeave,
  type LeaveType,
  type LeaveStatus,
  type PublicHrAmount,
  type PublicDailyActivity,
  type PublicLeaveBalance,
  type EmployeeDailyWorked,
  type PublicEmployeeAdvance,
  type TrainerMonthlyDuesResult,
  type PayslipData,
} from "@/api";
import { formatMinor } from "@/core/money";
import { formatTime } from "@/services/format";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRange } from "@/components/ui/date-range";

function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ------------------------------- attendance ------------------------------

export function AttendanceTab({ onDataChanged }: { onDataChanged?: () => void }) {
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
    onDataChanged?.();
  }, [month, empFilter, onDataChanged]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (isManager) api.employees.list({ includeInactive: false }).then(setEmployees).catch(console.error);
  }, [isManager]);

  const onExportAttendance = () => {
    const headers = [
      "التاريخ",
      "اسم الموظف",
      "وقت الحضور",
      "وقت الانصراف",
      "ساعات العمل",
      "الحالة",
    ];
    const dataRows = rows.map((r) => [
      r.dateKey,
      r.employeeName,
      r.clockInAt ? r.clockInAt.slice(11, 19) : "",
      r.clockOutAt ? r.clockOutAt.slice(11, 19) : "",
      r.workedMinutes > 0 ? hoursLabel(r.workedMinutes) : "",
      r.isLate ? "متأخر" : "في الموعد",
    ]);
    downloadCsvWithBom(`سجل_حضور_الموظفين_${month}`, headers, dataRows);
  };

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
    { key: "in", header: t("hr.clockInAt"), render: (r) => <span className="tabnum">{formatTime(r.clockInAt)}</span> },
    { key: "out", header: t("hr.clockOutAt"), render: (r) => r.clockOutAt ? <span className="tabnum">{formatTime(r.clockOutAt)}</span> : <span className="text-faint">—</span> },
    { key: "worked", header: t("hr.workedHours"), render: (r) => r.workedMinutes > 0 ? <span dir="ltr" className="tabnum">{hoursLabel(r.workedMinutes)}</span> : <span>—</span> },
    { key: "late", header: t("common.status"), render: (r) => r.isLate ? <Badge variant="danger">{t("hr.late")}</Badge> : <Badge variant="success">{t("hr.onTime")}</Badge> },
    ...(isManager ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: PublicAttendance) => (
        <div className="flex items-center justify-end">
          <button
            type="button"
            aria-label={t("common.edit")}
            onClick={() => setEditing({ dateKey: r.dateKey, employeeId: r.employeeId, clockIn: r.clockInAt || "", clockOut: r.clockOutAt || "" })}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-neon"
          >
            <Pencil className="size-4" />
          </button>
        </div>
      ),
    }] : []),
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
              <Button variant="secondary" size="sm" onClick={onExportAttendance}>
                <FileSpreadsheet className="size-4 text-neon" />
                {t("hr.exportAttendanceCsv")}
              </Button>
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

export function LeavesTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const isManager = hasPermission("hr.manage");
  const { toast } = useToast();
  const [rows, setRows] = useState<PublicLeave[]>([]);
  const [balances, setBalances] = useState<PublicLeaveBalance[]>([]);
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | "all">("all");
  const [requesting, setRequesting] = useState(false);
  const [settingEntitlements, setSettingEntitlements] = useState(false);
  const [decideTarget, setDecideTarget] = useState<PublicLeave | null>(null);
  const [decideApprove, setDecideApprove] = useState(true);
  const [editingLeave, setEditingLeave] = useState<PublicLeave | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PublicLeave | null>(null);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);

  const reload = useCallback(() => {
    api.employeesHr.listLeaves({ status: statusFilter }).then(setRows).catch(console.error);
    api.employeesHr.getLeaveBalance({}).then(setBalances).catch(console.error);
    onDataChanged?.();
  }, [statusFilter, onDataChanged]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (isManager) api.employees.list({ includeInactive: false }).then(setEmployees).catch(console.error);
  }, [isManager]);

  const onExportLeaves = () => {
    const headers = [
      "اسم الموظف",
      "نوع الإجازة",
      "تاريخ البداية",
      "تاريخ النهاية",
      "عدد الأيام",
      "السبب",
      "الحالة",
    ];
    const dataRows = rows.map((r) => [
      r.employeeName,
      leaveTypeLabel(r.leaveType),
      r.startDate,
      r.endDate,
      r.days,
      r.reason ?? "",
      statusLabel(r.status),
    ]);
    downloadCsvWithBom(`سجل_إجازات_الموظفين_${todayKey()}`, headers, dataRows);
  };

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

  const doCancel = async () => {
    if (!cancelTarget) return;
    try {
      await api.employeesHr.cancelLeave(cancelTarget.id);
      toast("success", t("hr.leaveCancelled"));
      setCancelTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<PublicLeave>[] = [
    ...(isManager ? [{ key: "emp", header: t("emp.fullName"), render: (r: PublicLeave) => <span className="font-bold">{r.employeeName}</span> }] : []),
    { key: "type", header: t("hr.leaveType"), render: (r) => leaveTypeLabel(r.leaveType) },
    { key: "period", header: t("hr.leaveStart"), render: (r) => <DateRange start={r.startDate} end={r.endDate} /> },
    { key: "days", header: t("hr.leaveDays"), render: (r) => <span dir="ltr" className="tabnum">{r.days}</span> },
    { key: "reason", header: t("hr.leaveReason"), render: (r) => <span className="text-subtle">{r.reason ?? "—"}</span> },
    { key: "status", header: t("hr.leaveStatus"), render: (r) => <Badge variant={statusVariant(r.status)} dot>{statusLabel(r.status)}</Badge> },
    ...([{
      key: "actions", header: "", align: "end" as const,
      render: (r: PublicLeave) => r.status === "pending" ? (
        <div className="flex items-center gap-1">
          {isManager && (
            <>
              <button
                type="button"
                aria-label={t("hr.approve")}
                onClick={() => { setDecideApprove(true); setDecideTarget(r); }}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-neon"
              >
                <ListChecks className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("hr.reject")}
                onClick={() => { setDecideApprove(false); setDecideTarget(r); }}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-red"
              >
                <Minus className="size-4" />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={t("hr.editLeave")}
            onClick={() => setEditingLeave(r)}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-neon"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t("hr.cancelLeave")}
            onClick={() => setCancelTarget(r)}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-red"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null,
    }]),
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {balances.map((b) => (
          <div key={b.type} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neon/10 text-neon">
                {b.type === "annual" ? <CalendarDays className="size-4" /> : b.type === "sick" ? <FileClock className="size-4" /> : <Clock3 className="size-4" />}
              </div>
              <div className="text-[13px] font-bold">{leaveTypeLabel(b.type)}</div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1 text-center">
              <div>
                <div className="text-[11px] text-subtle">{t("hr.leaveEntitlement")}</div>
                <div className="font-bold tabnum">{b.limited ? b.entitlement : "∞"}</div>
              </div>
              <div>
                <div className="text-[11px] text-subtle">{t("hr.leaveUsed")}</div>
                <div className="font-bold tabnum">{b.used}</div>
              </div>
              <div>
                <div className="text-[11px] text-subtle">{t("hr.leaveRemaining")}</div>
                <div className={`font-bold tabnum ${b.limited && b.remaining === 0 ? "text-red" : "text-neon"}`}>{b.limited ? b.remaining : "∞"}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader title={t("hr.tabLeaves")} action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onExportLeaves}>
              <FileSpreadsheet className="size-4 text-neon" />
              {t("hr.exportLeavesCsv")}
            </Button>
            {isManager && <Button variant="secondary" size="sm" onClick={() => setSettingEntitlements(true)}>{t("hr.setLeaveEntitlements")}</Button>}
            {hasPermission("hr.view") && <Button size="sm" onClick={() => setRequesting(true)}><Plus className="size-3.5" />{t("hr.requestLeave")}</Button>}
          </div>
        } />
        {/* Status Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface/30 px-4 py-2">
          {(["all", "pending", "approved", "rejected", "cancelled"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                statusFilter === st
                  ? "bg-neon/15 text-neon ring-1 ring-neon/40 shadow-glow-sm"
                  : "text-subtle hover:bg-white/5 hover:text-ink"
              }`}
            >
              {st === "all" ? t("common.all") : statusLabel(st)}
            </button>
          ))}
        </div>
        {rows.length === 0 ? <EmptyState icon={<CalendarDays />} title={t("hr.noAttendanceToday")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {settingEntitlements && (
        <LeaveEntitlementsModal
          employees={employees}
          onClose={() => setSettingEntitlements(false)}
          onSaved={() => { setSettingEntitlements(false); reload(); }}
        />
      )}
      {requesting && (
        <RequestLeaveModal
          isManager={isManager}
          employees={employees}
          onClose={() => setRequesting(false)}
          onSaved={() => { setRequesting(false); reload(); }}
        />
      )}
      {editingLeave && (
        <EditLeaveModal
          leave={editingLeave}
          onClose={() => setEditingLeave(null)}
          onSaved={() => { setEditingLeave(null); reload(); }}
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
      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t("hr.cancelLeave")}
        message={cancelTarget ? `${cancelTarget.employeeName} — ${leaveTypeLabel(cancelTarget.leaveType)}` : ""}
        confirmLabel={t("common.confirm")}
        onConfirm={() => void doCancel()}
      />
    </>
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

function EditLeaveModal({ leave, onClose, onSaved }: {
  leave: PublicLeave;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({
    leaveType: leave.leaveType,
    startDate: leave.startDate,
    endDate: leave.endDate,
    reason: leave.reason ?? "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.employeesHr.updateLeave({
        leaveId: leave.id,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || null,
      });
      toast("success", t("hr.savedToast"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t("hr.editLeave")} — ${leave.employeeName}`} widthClass="max-w-sm"
      footer={<><Button loading={busy} onClick={save}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <div className="space-y-3.5">
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

function LeaveEntitlementsModal({ employees, onClose, onSaved }: {
  employees: PublicEmployee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [annual, setAnnual] = useState("");
  const [sick, setSick] = useState("");
  const [unpaid, setUnpaid] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    api.employeesHr.getLeaveBalance({ employeeId }).then((balances) => {
      if (!alive) return;
      const yearly = balances.find((b) => b.type === "annual");
      const sickly = balances.find((b) => b.type === "sick");
      const nopay = balances.find((b) => b.type === "unpaid");
      setAnnual(yearly?.limited ? String(yearly.entitlement) : "");
      setSick(sickly?.limited ? String(sickly.entitlement) : "");
      setUnpaid(nopay?.limited ? String(nopay.entitlement) : "");
    }).catch(console.error);
    return () => { alive = false; };
  }, [employeeId]);

  const save = async () => {
    if (!employeeId) return;
    setBusy(true);
    try {
      const toNum = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
      await api.employeesHr.setLeaveEntitlements({
        employeeId,
        annualDays: toNum(annual),
        sickDays: toNum(sick),
        unpaidDays: toNum(unpaid),
      });
      toast("success", t("hr.setLeaveEntitlements"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("hr.setLeaveEntitlements")} widthClass="max-w-sm"
      footer={<><Button loading={busy} onClick={save}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <div className="space-y-3.5">
        <Select label={t("emp.fullName")} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} />
        <p className="text-[12px] text-subtle">{t("hr.leaveEntitlementUnlimited")}</p>
        <div className="grid grid-cols-3 gap-3">
          <Input label={t("hr.annualLeaveDays")} type="number" min={0} dir="ltr" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="∞" />
          <Input label={t("hr.sickLeaveDays")} type="number" min={0} dir="ltr" value={sick} onChange={(e) => setSick(e.target.value)} placeholder="∞" />
          <Input label={t("hr.unpaidLeaveDays")} type="number" min={0} dir="ltr" value={unpaid} onChange={(e) => setUnpaid(e.target.value)} placeholder="∞" />
        </div>
      </div>
    </Modal>
  );
}

// --------------------------- deductions/incentives ------------------------

export function DeductionsTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const t = useT();
  return <AmountTab kind="deduction" title={t("hr.tabDeductions")} addLabel={t("hr.addDeduction")} emptyTitle={t("hr.noAttendanceToday")} onDataChanged={onDataChanged} />;
}
export function IncentivesTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const t = useT();
  return <AmountTab kind="incentive" title={t("hr.tabIncentives")} addLabel={t("hr.addIncentive")} emptyTitle={t("hr.noAttendanceToday")} onDataChanged={onDataChanged} />;
}

function AmountTab({ kind, title, addLabel, emptyTitle, onDataChanged }: { kind: "deduction" | "incentive"; title: string; addLabel: string; emptyTitle: string; onDataChanged?: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const isManager = hasPermission("hr.manage");
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [rows, setRows] = useState<PublicHrAmount[]>([]);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PublicHrAmount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicHrAmount | null>(null);

  const fetchRows = useCallback(() => {
    const p = kind === "deduction" ? api.employeesHr.listDeductions : api.employeesHr.listIncentives;
    p({ month }).then(setRows).catch(console.error);
    onDataChanged?.();
  }, [kind, month, onDataChanged]);
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
    ...(isManager ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: PublicHrAmount) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={t("common.edit")}
            onClick={() => setEditing(r)}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-neon"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            aria-label={kind === "deduction" ? t("hr.deleteDeduction") : t("hr.deleteIncentive")}
            onClick={() => setDeleteTarget(r)}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-red"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ),
    }] : []),
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
      {editing && (
        <AddAmountModal
          kind={kind}
          employees={employees}
          editTarget={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchRows(); }}
        />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={kind === "deduction" ? t("hr.deleteDeduction") : t("hr.deleteIncentive")}
        message={deleteTarget ? (kind === "deduction" ? t("hr.deleteDeductionConfirm") : t("hr.deleteIncentiveConfirm")) : ""}
        confirmLabel={t("common.delete")}
        tone="danger"
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          void (async () => {
            try {
              if (kind === "deduction") await api.employeesHr.deleteDeduction(target.id);
              else await api.employeesHr.deleteIncentive(target.id);
              toast("success", t("hr.deletionDone"));
              fetchRows();
            } catch (err) {
              toast("error", describeError(err, t));
            }
          })();
        }}
      />
    </>
  );
}

function AddAmountModal({ kind, employees, editTarget, onClose, onSaved }: {
  kind: "deduction" | "incentive";
  employees: PublicEmployee[];
  editTarget?: PublicHrAmount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const isEdit = Boolean(editTarget);
  const [form, setForm] = useState({
    employeeId: editTarget?.employeeId ?? employees[0]?.id ?? "",
    amountMajor: editTarget ? String(editTarget.amountMinor / 100) : "",
    reason: editTarget?.reason ?? "",
    dateKey: editTarget?.dateKey ?? todayKey(),
  });
  const [busy, setBusy] = useState(false);
  const [calculatingDues, setCalculatingDues] = useState(false);

  useEffect(() => {
    if (!form.employeeId && employees.length > 0) {
      setForm((f) => ({ ...f, employeeId: employees[0].id }));
    }
  }, [employees, form.employeeId]);

  const autoFillTrainerDues = async () => {
    if (!form.employeeId) return;
    setCalculatingDues(true);
    try {
      const month = form.dateKey.slice(0, 7);
      const dues = await api.employees.calculateTrainerDues(form.employeeId, month);
      if (dues.totalDuesMinor > 0) {
        setForm((f) => ({
          ...f,
          amountMajor: String(dues.totalDuesMinor / 100),
          reason: dues.suggestedNotes || f.reason,
        }));
        toast("success", t("hr.duesCalculatedSuccess"));
      } else {
        toast("info", t("hr.noTrainerDues"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setCalculatingDues(false);
    }
  };

  const save = async () => {
    const amountMinor = Math.round(Number(form.amountMajor || 0) * 100);
    if (!form.employeeId) {
      toast("warning", "يرجى اختيار الموظف أولاً");
      return;
    }
    if (amountMinor <= 0 || !Number.isFinite(amountMinor)) {
      toast("warning", "يرجى إدخال مبلغ صحيح أكبر من الصفر");
      return;
    }
    if (form.reason.trim().length < 2) {
      toast("warning", `يرجى كتابة سبب ${kind === "deduction" ? "الاستقطاع" : "الحافز"} (حرفان على الأقل)`);
      return;
    }

    setBusy(true);
    try {
      if (isEdit && editTarget) {
        const input = { id: editTarget.id, amountMinor, reason: form.reason.trim(), dateKey: form.dateKey };
        if (kind === "deduction") await api.employeesHr.updateDeduction(input);
        else await api.employeesHr.updateIncentive(input);
        toast("success", kind === "deduction" ? t("hr.deductionUpdated") : t("hr.incentiveUpdated"));
      } else {
        const input = { employeeId: form.employeeId, amountMinor, reason: form.reason.trim(), dateKey: form.dateKey };
        if (kind === "deduction") await api.employeesHr.addDeduction(input);
        else await api.employeesHr.addIncentive(input);
        toast("success", kind === "deduction" ? t("hr.deductionCreated") : t("hr.incentiveCreated"));
      }
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose}
      title={isEdit ? (kind === "deduction" ? t("hr.editDeduction") : t("hr.editIncentive")) : (kind === "deduction" ? t("hr.addDeduction") : t("hr.addIncentive"))}
      widthClass="max-w-sm"
      footer={<><Button loading={busy} onClick={save}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <div className="space-y-3.5">
        <Select label={t("emp.fullName")} value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} disabled={isEdit} />
        {kind === "incentive" && !isEdit && (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={calculatingDues}
              onClick={() => void autoFillTrainerDues()}
              className="text-xs"
            >
              <Sparkles className="size-3 text-neon" />
              {t("hr.calculateTrainerDues")}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("hr.amount")} type="number" step="0.01" min={0} dir="ltr" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} />
          <Input label={t("hr.dateKey")} type="date" dir="ltr" value={form.dateKey} onChange={(e) => setForm((f) => ({ ...f, dateKey: e.target.value }))} />
        </div>
        <Input label={t("hr.reason")} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
      </div>
    </Modal>
  );
}

// ----------------------------- advances -----------------------------------

export function AdvancesTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const isManager = hasPermission("hr.manage");
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [rows, setRows] = useState<PublicEmployeeAdvance[]>([]);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [adding, setAdding] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PublicEmployeeAdvance | null>(null);

  const fetchRows = useCallback(() => {
    api.employeesHr.listAdvances({ month }).then(setRows).catch(console.error);
    onDataChanged?.();
  }, [month, onDataChanged]);
  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    if (isManager) api.employees.list({ includeInactive: false }).then(setEmployees).catch(console.error);
  }, [isManager]);

  const onExportAdvances = () => {
    const headers = [
      "اسم الموظف",
      "شهر الخصم",
      "مبلغ السلفة (ج.م)",
      "الحالة",
      "ملاحظات",
    ];
    const dataRows = rows.map((r) => [
      r.employeeName,
      r.deductionMonth,
      (r.amountMinor / 100).toFixed(2),
      r.status === "open" ? t("hr.advanceStatusOpen") : r.status === "settled" ? t("hr.advanceStatusSettled") : t("hr.advanceStatusCancelled"),
      r.notes ?? "",
    ]);
    downloadCsvWithBom(`كشف_سلف_الموظفين_${month}`, headers, dataRows);
  };

  const openTotalMinor = rows.filter((r) => r.status === "open").reduce((sum, r) => sum + r.amountMinor, 0);
  const settledTotalMinor = rows.filter((r) => r.status === "settled").reduce((sum, r) => sum + r.amountMinor, 0);

  const columns: Column<PublicEmployeeAdvance>[] = [
    ...(isManager ? [{ key: "emp", header: t("emp.fullName"), render: (r: PublicEmployeeAdvance) => <span className="font-bold">{r.employeeName}</span> }] : []),
    { key: "month", header: t("hr.deductionMonth"), render: (r) => <span dir="ltr" className="tabnum">{r.deductionMonth}</span> },
    { key: "amount", header: t("hr.amount"), render: (r) => <span dir="ltr" className="font-bold tabnum text-warning">{formatMinor(r.amountMinor)}</span> },
    { key: "notes", header: t("common.notes"), render: (r) => <span className="text-subtle">{r.notes ?? "—"}</span> },
    {
      key: "status", header: t("common.status"), render: (r) => r.status === "open"
        ? <Badge variant="warning" dot>{t("hr.advanceStatusOpen")}</Badge>
        : r.status === "settled" ? <Badge variant="success" dot>{t("hr.advanceStatusSettled")}</Badge>
        : <Badge variant="neutral" dot>{t("hr.advanceStatusCancelled")}</Badge>,
    },
    ...(isManager ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: PublicEmployeeAdvance) => r.status === "open" ? (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCancelTarget(r)}
            className="text-red hover:bg-red/10"
            title={t("hr.cancelAdvance")}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null,
    }] : []),
  ];

  return (
    <>
      {/* Advances Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.advanceStatusOpen")}</span>
          <div className="mt-1 flex items-baseline justify-between">
            <span dir="ltr" className="text-lg font-black tabnum text-amber-400">{formatMinor(openTotalMinor)}</span>
            <span className="text-xs text-faint">{rows.filter((r) => r.status === "open").length} سلف</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.advanceStatusSettled")}</span>
          <div className="mt-1 flex items-baseline justify-between">
            <span dir="ltr" className="text-lg font-black tabnum text-emerald-400">{formatMinor(settledTotalMinor)}</span>
            <span className="text-xs text-faint">{rows.filter((r) => r.status === "settled").length} سلف</span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader title={t("hr.tabAdvances")} action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onExportAdvances}>
              <FileSpreadsheet className="size-4 text-neon" />
              {t("hr.exportAdvancesCsv")}
            </Button>
            {isManager && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" />{t("hr.addAdvance")}
              </Button>
            )}
            <Input type="month" dir="ltr" value={month} onChange={(e: ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} className="w-36" />
          </div>
        } />
        {rows.length === 0 ? <EmptyState icon={<CreditCard />} title={t("hr.advancesEmpty")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {adding && (
        <AddAdvanceModal
          employees={employees}
          defaultMonth={month}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); fetchRows(); }}
        />
      )}
      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t("hr.cancelAdvance")}
        message={cancelTarget ? t("hr.confirmCancelAdvance", { name: cancelTarget.employeeName, amount: formatMinor(cancelTarget.amountMinor) }) : ""}
        confirmLabel={t("common.confirm")}
        tone="danger"
        onConfirm={() => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (!target) return;
          void (async () => {
            try {
              await api.employeesHr.cancelAdvance(target.id);
              toast("success", t("hr.advanceCancelled"));
              fetchRows();
            } catch (err) {
              toast("error", describeError(err, t));
            }
          })();
        }}
      />
    </>
  );
}

function AddAdvanceModal({ employees, defaultMonth, onClose, onSaved }: {
  employees: PublicEmployee[];
  defaultMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({
    employeeId: employees[0]?.id ?? "",
    amountMajor: "",
    deductionMonth: defaultMonth || todayKey().slice(0, 7),
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form.employeeId && employees.length > 0) {
      setForm((f) => ({ ...f, employeeId: employees[0].id }));
    }
  }, [employees, form.employeeId]);

  const save = async () => {
    const amountMinor = Math.round(Number(form.amountMajor || 0) * 100);
    if (!form.employeeId) {
      toast("warning", "يرجى اختيار الموظف أولاً");
      return;
    }
    if (amountMinor <= 0 || !Number.isFinite(amountMinor)) {
      toast("warning", "يرجى إدخال مبلغ صحيح أكبر من الصفر");
      return;
    }
    if (!form.deductionMonth) {
      toast("warning", "يرجى تحديد شهر الخصم للسلفة");
      return;
    }

    setBusy(true);
    try {
      await api.employeesHr.addAdvance({
        employeeId: form.employeeId,
        amountMinor,
        deductionMonth: form.deductionMonth,
        notes: form.notes || null,
      });
      toast("success", t("hr.advanceCreated"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose}
      title={t("hr.addAdvance")}
      widthClass="max-w-sm"
      footer={<><Button loading={busy} onClick={save}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <div className="space-y-3.5">
        <Select label={t("emp.fullName")} value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("hr.advanceAmount")} type="number" step="0.01" min={0} dir="ltr" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} autoFocus />
          <Input label={t("hr.deductionMonth")} type="month" dir="ltr" value={form.deductionMonth} onChange={(e) => setForm((f) => ({ ...f, deductionMonth: e.target.value }))} />
        </div>
        <Input label={t("common.notes")} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </div>
    </Modal>
  );
}

// ----------------------------- salary summary ----------------------------

export function SalarySummaryTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid" | "none">("all");
  const [approving, setApproving] = useState(false);
  const [payTarget, setPayTarget] = useState<{ id: string; name: string; netMinor: number } | null>(null);
  const canManage = hasPermission("salaries.manage");

  interface SummaryRow {
    employeeId: string;
    employeeName: string;
    baseMinor: number;
    incentivesMinor: number;
    deductionsMinor: number;
    advancesMinor: number;
    unpaidLeaveDays: number;
    unpaidLeaveImpactMinor: number;
    netMinor: number;
    status: "none" | "pending" | "paid";
    salaryId: string | null;
  }

  const reload = useCallback(() => {
    Promise.all([
      api.employees.list({ includeInactive: false }).catch(() => []),
      api.employees.listSalaries({ periodMonth: month }).catch(() => []),
    ]).then(async ([emps, salaries]) => {
      const byEmp: Record<string, { status: SummaryRow["status"]; salaryId: string | null }> = {};
      for (const s of salaries) byEmp[s.employeeId] = { status: s.status, salaryId: s.id };
      const summaries = await Promise.all(
        emps.map((e) => api.employeesHr.monthlySalarySummary({ employeeId: e.id, periodMonth: month }).catch(() => null)),
      );
      setRows(emps.map((e, i) => {
        const sum = summaries[i];
        const rec = byEmp[e.id];
        return {
          employeeId: e.id,
          employeeName: e.fullName,
          baseMinor: sum?.baseMinor ?? 0,
          incentivesMinor: sum?.incentivesMinor ?? 0,
          deductionsMinor: sum?.deductionsMinor ?? 0,
          advancesMinor: sum?.advancesMinor ?? 0,
          unpaidLeaveDays: sum?.unpaidLeaveDays ?? 0,
          unpaidLeaveImpactMinor: sum?.unpaidLeaveImpactMinor ?? 0,
          netMinor: sum?.netMinor ?? 0,
          status: rec?.status ?? "none",
          salaryId: rec?.salaryId ?? null,
        };
      }));
      onDataChanged?.();
    });
  }, [month, onDataChanged]);
  useEffect(() => { reload(); }, [reload]);

  const [printingId, setPrintingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewPayslip, setPreviewPayslip] = useState<PayslipData | null>(null);
  const [loadingPayslipId, setLoadingPayslipId] = useState<string | null>(null);

  const [duesTarget, setDuesTarget] = useState<{ empId: string; name: string } | null>(null);
  const [duesData, setDuesData] = useState<TrainerMonthlyDuesResult | null>(null);
  const [loadingDues, setLoadingDues] = useState(false);
  const [applyingDues, setApplyingDues] = useState(false);

  const printPayslip = async (salaryId: string) => {
    setPrintingId(salaryId);
    try {
      const res = await api.pdf.generatePayslip(salaryId);
      const byteChars = atob(res.base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPrintingId(null);
    }
  };

  const sendWhatsAppPayslip = async (salaryId: string) => {
    setSendingId(salaryId);
    try {
      const res = await api.employees.sendPayslipWhatsApp(salaryId);
      if (res.success) {
        toast("success", t("hr.payslipSentSuccess"));
      } else if (res.directUrl) {
        toast("info", t("hr.payslipSentFailFallback"));
        window.open(res.directUrl, "_blank");
      } else {
        toast("info", t("hr.payslipSentSuccess"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSendingId(null);
    }
  };

  const openPayslipPreview = async (salaryId: string) => {
    setLoadingPayslipId(salaryId);
    try {
      const data = await api.employees.getPayslip(salaryId);
      setPreviewPayslip(data);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoadingPayslipId(null);
    }
  };

  const calculateDues = async (empId: string, name: string) => {
    setDuesTarget({ empId, name });
    setLoadingDues(true);
    try {
      const res = await api.employees.calculateTrainerDues(empId, month);
      setDuesData(res);
    } catch (err) {
      toast("error", describeError(err, t));
      setDuesTarget(null);
    } finally {
      setLoadingDues(false);
    }
  };

  const applyDuesAsIncentive = async () => {
    if (!duesTarget || !duesData || duesData.totalDuesMinor <= 0) return;
    setApplyingDues(true);
    try {
      await api.employeesHr.addIncentive({
        employeeId: duesTarget.empId,
        amountMinor: duesData.totalDuesMinor,
        reason: duesData.suggestedNotes || "مستحقات تدريب وكلاسات",
        dateKey: `${month}-01`,
      });
      toast("success", t("hr.duesCalculatedSuccess"));
      setDuesTarget(null);
      setDuesData(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setApplyingDues(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    try {
      const res = await api.employeesHr.ensureSalariesForMonth({ periodMonth: month });
      toast("success", res.created > 0 ? t("hr.salariesGenerated", { count: res.created }) : t("hr.salaryAlreadyApproved"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setApproving(false);
    }
  };

  const doPay = async () => {
    if (!payTarget) return;
    try {
      await api.employees.paySalary(payTarget.id);
      toast("success", t("emp.paidToast"));
      setPayTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const onExportPayroll = () => {
    const headers = [
      "الموظف",
      "الراتب الأساسي (ج.م)",
      "الحوافز والمكافآت (ج.م)",
      "الخصومات والغياب (ج.م)",
      "السلف المستقطعة (ج.م)",
      "أثر الإجازات بدون أجر (ج.م)",
      "صافي الراتب المستحق (ج.م)",
      "حالة الصرف",
      "شهر الاستحقاق",
    ];
    const dataRows = filteredRows.map((r) => [
      r.employeeName,
      (r.baseMinor / 100).toFixed(2),
      (r.incentivesMinor / 100).toFixed(2),
      ((r.deductionsMinor + r.unpaidLeaveImpactMinor) / 100).toFixed(2),
      (r.advancesMinor / 100).toFixed(2),
      (r.unpaidLeaveImpactMinor / 100).toFixed(2),
      (r.netMinor / 100).toFixed(2),
      r.status === "paid"
        ? t("emp.paid")
        : r.status === "pending"
          ? t("emp.pending")
          : t("hr.salaryNotGenerated"),
      month,
    ]);
    downloadCsvWithBom(`مسير_رواتب_${month}`, headers, dataRows);
  };

  const totalBase = rows.reduce((sum, r) => sum + r.baseMinor, 0);
  const totalIncentives = rows.reduce((sum, r) => sum + r.incentivesMinor, 0);
  const totalDeductions = rows.reduce((sum, r) => sum + r.deductionsMinor + r.unpaidLeaveImpactMinor, 0);
  const totalAdvances = rows.reduce((sum, r) => sum + r.advancesMinor, 0);
  const totalNet = rows.reduce((sum, r) => sum + r.netMinor, 0);
  const totalPaid = rows.filter((r) => r.status === "paid").reduce((sum, r) => sum + r.netMinor, 0);
  const totalPending = rows.filter((r) => r.status === "pending").reduce((sum, r) => sum + r.netMinor, 0);

  const columns: Column<SummaryRow>[] = [
    { key: "emp", header: t("emp.fullName"), render: (r) => <span className="font-bold">{r.employeeName}</span> },
    { key: "base", header: t("emp.base"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.baseMinor)}</span> },
    { key: "incentives", header: t("hr.incentivesTotal"), render: (r) => <span dir="ltr" className="tabnum text-neon">{formatMinor(r.incentivesMinor)}</span> },
    { key: "deductions", header: t("hr.deductionsTotal"), render: (r) => <span dir="ltr" className="tabnum text-red">{formatMinor(r.deductionsMinor + r.unpaidLeaveImpactMinor)}</span> },
    { key: "advances", header: t("hr.advancesTotal"), render: (r) => <span dir="ltr" className="tabnum text-warning">{formatMinor(r.advancesMinor)}</span> },
    { key: "net", header: t("hr.netSalary"), render: (r) => <span dir="ltr" className="font-bold tabnum text-neon">{formatMinor(r.netMinor)}</span> },
    {
      key: "status", header: t("common.status"), render: (r) => r.status === "paid"
        ? <Badge variant="success" dot>{t("emp.paid")}</Badge>
        : r.status === "pending" ? <Badge variant="warning" dot>{t("emp.pending")}</Badge>
        : <Badge variant="neutral" dot>{t("hr.salaryNotGenerated")}</Badge>,
    },
    {
      key: "actions", header: "", align: "end" as const,
      render: (r: SummaryRow) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            title={t("hr.calculateTrainerDues")}
            onClick={() => void calculateDues(r.employeeId, r.employeeName)}
          >
            <Calculator className="size-3.5 text-neon" />
          </Button>
          {r.salaryId && (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={loadingPayslipId === r.salaryId}
                onClick={() => void openPayslipPreview(r.salaryId!)}
                title={t("hr.payslipPreview")}
              >
                <Eye className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={printingId === r.salaryId}
                onClick={() => void printPayslip(r.salaryId!)}
                title={t("hr.printPayslip")}
              >
                <Printer className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="text-emerald-400 hover:text-emerald-300"
                loading={sendingId === r.salaryId}
                onClick={() => void sendWhatsAppPayslip(r.salaryId!)}
                title={t("hr.sendPayslipWhatsApp")}
              >
                <Send className="size-3.5" />
              </Button>
            </>
          )}
          {canManage && r.status === "pending" && r.salaryId ? (
            <Button size="sm" variant="secondary" onClick={() => setPayTarget({ id: r.salaryId!, name: r.employeeName, netMinor: r.netMinor })}>
              <HandCoins className="size-3.5" />{t("emp.paySalary")}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Monthly Payroll High-Level KPI Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-3">
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.monthlySalariesTotal")}</span>
          <div className="mt-1">
            <span dir="ltr" className="text-lg font-black tabnum text-neon">{formatMinor(totalNet)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.totalPaidSalaries")}</span>
          <div className="mt-1">
            <span dir="ltr" className="text-lg font-black tabnum text-emerald-400">{formatMinor(totalPaid)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.totalPendingSalaries")}</span>
          <div className="mt-1">
            <span dir="ltr" className="text-lg font-black tabnum text-amber-400">{formatMinor(totalPending)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.baseSalary")} / {t("hr.incentivesBonus")}</span>
          <div className="mt-1 flex items-baseline justify-between text-xs">
            <span dir="ltr" className="font-bold tabnum text-ink">{formatMinor(totalBase)}</span>
            <span dir="ltr" className="font-bold tabnum text-neon">+{formatMinor(totalIncentives)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface/80 p-3.5 backdrop-blur-sm">
          <span className="text-xs font-semibold text-subtle">{t("hr.deductions")} / {t("hr.tabAdvances")}</span>
          <div className="mt-1 flex items-baseline justify-between text-xs">
            <span dir="ltr" className="font-bold tabnum text-red">-{formatMinor(totalDeductions)}</span>
            <span dir="ltr" className="font-bold tabnum text-warning">-{formatMinor(totalAdvances)}</span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader title={t("hr.tabSalarySummary")} action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onExportPayroll}>
              <FileSpreadsheet className="size-4 text-neon" />
              {t("hr.exportPayrollCsv")}
            </Button>
            {canManage && <Button size="sm" loading={approving} onClick={() => void approve()}><Check className="size-3.5" />{t("hr.approveSalaries")}</Button>}
            <Input type="month" dir="ltr" value={month} onChange={(e: ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} className="w-36" />
          </div>
        } />
        {/* Status Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface/30 px-4 py-2">
          {(["all", "pending", "paid", "none"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                statusFilter === st
                  ? "bg-neon/15 text-neon ring-1 ring-neon/40 shadow-glow-sm"
                  : "text-subtle hover:bg-white/5 hover:text-ink"
              }`}
            >
              {st === "all"
                ? t("hr.filterPayrollStatusAll")
                : st === "pending"
                  ? t("hr.filterPayrollStatusPending")
                  : st === "paid"
                    ? t("hr.filterPayrollStatusPaid")
                    : t("hr.filterPayrollStatusNotGenerated")}
            </button>
          ))}
        </div>
        {filteredRows.length === 0 ? (
          <EmptyState icon={<Wallet />} title={t("hr.noAttendanceToday")} />
        ) : (
          <DataTable columns={columns} data={filteredRows} rowKey={(r) => r.employeeId} />
        )}
      </Card>
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
        <span className="text-sm font-bold">{t("hr.monthlySalariesTotal")}</span>
        <span dir="ltr" className="text-lg font-extrabold tabnum text-neon">{formatMinor(totalNet)}</span>
      </div>
      <ConfirmDialog
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title={t("emp.paySalary")}
        message={payTarget ? `${payTarget.name} — ${month} — ${formatMinor(payTarget.netMinor)}` : ""}
        confirmLabel={t("common.confirm")}
        onConfirm={() => void doPay()}
      />

      {/* Trainer Dues Calculation Modal */}
      {duesTarget && (
        <Modal
          open
          onClose={() => { setDuesTarget(null); setDuesData(null); }}
          title={t("hr.calculateTrainerDues")}
          widthClass="max-w-md"
          footer={
            <>
              {duesData && duesData.totalDuesMinor > 0 && (
                <Button loading={applyingDues} onClick={() => void applyDuesAsIncentive()}>
                  <Plus className="size-3.5" />
                  {t("hr.duesCalculatedSuccess")}
                </Button>
              )}
              <Button variant="secondary" onClick={() => { setDuesTarget(null); setDuesData(null); }}>
                {t("common.close")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-surface p-3 text-sm">
              <span className="block text-faint">{t("emp.fullName")}:</span>
              <span className="font-bold text-white">{duesTarget.name}</span>
              <span className="block text-xs text-subtle">{month}</span>
            </div>

            {loadingDues ? (
              <div className="flex items-center justify-center p-6 text-sm text-subtle">
                {t("hr.calculatingDues")}
              </div>
            ) : !duesData || !duesData.trainerId ? (
              <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-subtle">
                {t("trainers.noLinkedEmployee")}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t("hr.ptDuesCount", { count: duesData.ptSessionsCount, amount: (duesData.ptCommissionMinor / 100).toFixed(0) })}</span>
                    <span dir="ltr" className="font-bold tabnum text-neon">{formatMinor(duesData.ptCommissionMinor)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t("hr.classesDuesCount", { count: duesData.classesCount, amount: (duesData.classesEarningsMinor / 100).toFixed(0) })}</span>
                    <span dir="ltr" className="font-bold tabnum text-neon">{formatMinor(duesData.classesEarningsMinor)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-white/5 p-3 text-base font-bold">
                  <span>{t("hr.totalTrainerDues", { amount: (duesData.totalDuesMinor / 100).toFixed(0) })}</span>
                  <span dir="ltr" className="font-extrabold tabnum text-neon">{formatMinor(duesData.totalDuesMinor)}</span>
                </div>

                {duesData.suggestedNotes && (
                  <p className="rounded bg-surface p-2 text-xs text-faint">
                    {duesData.suggestedNotes}
                  </p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Payslip Preview Modal */}
      {previewPayslip && (
        <Modal
          open
          onClose={() => setPreviewPayslip(null)}
          title={t("hr.payslipPreview")}
          widthClass="max-w-lg"
          footer={
            <>
              <Button
                variant="secondary"
                loading={printingId === previewPayslip.salary.id}
                onClick={() => void printPayslip(previewPayslip.salary.id)}
              >
                <Printer className="size-3.5" />
                {t("hr.printSlip")}
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                loading={sendingId === previewPayslip.salary.id}
                onClick={() => void sendWhatsAppPayslip(previewPayslip.salary.id)}
              >
                <Send className="size-3.5" />
                {t("hr.sendPayslipWhatsApp")}
              </Button>
              <Button variant="secondary" onClick={() => setPreviewPayslip(null)}>
                {t("common.close")}
              </Button>
            </>
          }
        >
          <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
            <div className="border-b border-line pb-3 text-center">
              <h3 className="text-base font-extrabold text-neon">{previewPayslip.gymName}</h3>
              <p className="text-xs text-subtle">{t("hr.printPayslip")} — {previewPayslip.salary.periodMonth}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-faint">{t("emp.fullName")}:</span>{" "}
                <strong className="text-white">{previewPayslip.employee.fullName}</strong>
              </div>
              <div>
                <span className="text-faint">{t("emp.roleTitle")}:</span>{" "}
                <span className="text-white">{previewPayslip.employee.roleTitle || "موظف"}</span>
              </div>
              <div>
                <span className="text-faint">{t("common.phone")}:</span>{" "}
                <span dir="ltr" className="text-white">{previewPayslip.employee.phone || "—"}</span>
              </div>
              <div>
                <span className="text-faint">{t("hr.tabAttendance")}:</span>{" "}
                <span className="text-white">{previewPayslip.attendanceDays} يوم</span>
              </div>
            </div>

            <div className="space-y-2 rounded-lg bg-base p-3 text-sm">
              <div className="flex justify-between">
                <span>{t("hr.salaryBase")}</span>
                <span dir="ltr" className="font-bold tabnum">{formatMinor(previewPayslip.salary.baseMinor)}</span>
              </div>
              {previewPayslip.salary.bonusMinor > 0 && (
                <div className="flex justify-between text-neon">
                  <span>{t("hr.incentivesBonus")} (+)</span>
                  <span dir="ltr" className="font-bold tabnum">{formatMinor(previewPayslip.salary.bonusMinor)}</span>
                </div>
              )}
              {previewPayslip.salary.deductionMinor > 0 && (
                <div className="flex justify-between text-red">
                  <span>{t("hr.deductions")} (-)</span>
                  <span dir="ltr" className="font-bold tabnum">{formatMinor(previewPayslip.salary.deductionMinor)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold">
                <span className="text-white">{t("hr.netPayable")}</span>
                <span dir="ltr" className="tabnum text-neon">{formatMinor(previewPayslip.salary.netMinor)}</span>
              </div>
            </div>

            {previewPayslip.salary.notes && (
              <p className="text-xs text-subtle">
                <span className="font-semibold text-white">{t("common.notes")}:</span> {previewPayslip.salary.notes}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------- activity ---------------------------------

export function ActivityTab() {
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

export function MonthlyHoursTab() {
  const t = useT();
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [empId, setEmpId] = useState("");
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [data, setData] = useState<{ employeeName: string; days: EmployeeDailyWorked[]; totalMinutes: number } | null>(null);

  useEffect(() => {
    api.employees.list({ includeInactive: false }).then((list) => {
      setEmployees(list);
      setEmpId((prev) => prev || list[0]?.id || "");
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!empId) { setData(null); return; }
    api.employeesHr.employeeMonthlyHours({ employeeId: empId, month }).then((res) => {
      setData({
        employeeName: res.employeeName,
        days: res.days ?? [],
        totalMinutes: (res.days ?? []).reduce((sum, d) => sum + d.workedMinutes, 0),
      });
    }).catch(() => setData(null));
  }, [empId, month]);

  const columns: Column<EmployeeDailyWorked>[] = [
    { key: "date", header: t("hr.dateKey"), render: (r) => <span dir="ltr" className="tabnum">{r.dateKey}</span> },
    { key: "in", header: t("hr.clockInAt"), render: (r) => <span className="tabnum">{r.clockInAt ? formatTime(r.clockInAt) : "—"}</span> },
    { key: "out", header: t("hr.clockOutAt"), render: (r) => r.clockOutAt ? <span className="tabnum">{formatTime(r.clockOutAt)}</span> : <span className="text-faint">—</span> },
    { key: "worked", header: t("hr.workedHours"), render: (r) => r.workedMinutes > 0 ? <span dir="ltr" className="font-bold tabnum">{hoursLabel(r.workedMinutes)}</span> : <span>—</span> },
    { key: "late", header: t("common.status"), render: (r) => r.isLate ? <Badge variant="danger">{t("hr.late")}</Badge> : <Badge variant="success">{t("hr.onTime")}</Badge> },
  ];

  return (
    <Card>
      <CardHeader title={t("hr.monthlyHours")} action={
        <div className="flex items-center gap-2">
          <Input type="month" dir="ltr" value={month} onChange={(e) => setMonth(e.target.value)} className="w-36" />
          <Select value={empId} onChange={(e) => setEmpId(e.target.value)} options={employees.map((e) => ({ value: e.id, label: e.fullName }))} className="w-44" />
        </div>
      } />
      {!data ? (
        <EmptyState icon={<Clock3 />} title={t("hr.noAttendanceToday")} />
      ) : (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
            <span className="font-bold">{data.employeeName}</span>
            <span dir="ltr" className="text-lg font-extrabold tabnum text-neon">{hoursLabel(data.totalMinutes)}</span>
          </div>
          <DataTable columns={columns} data={data.days} rowKey={(d) => d.dateKey} />
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
