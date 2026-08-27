import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { BanknoteCheck, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicEmployee, type PublicSalary, type SalaryType } from "@/api";
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

export function EmployeesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState("employees");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("nav.employees")} />
        <div className="px-5 pb-1">
          <Tabs
            items={[
              { value: "employees", label: t("emp.tabEmployees") },
              ...(hasPermission("salaries.view") ? [{ value: "salaries", label: t("emp.tabSalaries") }] : []),
            ]}
            value={hasPermission("salaries.view") ? tab : "employees"}
            onChange={setTab}
          />
        </div>
      </Card>
      {tab === "employees" && <EmployeesTab />}
      {tab === "salaries" && hasPermission("salaries.view") && <SalariesTab />}
    </div>
  );
}

// ------------------------------- employees --------------------------------

function EmployeesTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<PublicEmployee[]>([]);
  const [modal, setModal] = useState<{ open: boolean; target: PublicEmployee | null }>({ open: false, target: null });

  const reload = useCallback(() => {
    api.employees.list({ includeInactive: true }).then(setRows).catch(console.error);
  }, []);
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

  const columns: Column<PublicEmployee>[] = [
    { key: "name", header: t("emp.fullName"), render: (r) => (
      <span><span className="block font-bold">{r.fullName}</span>{r.roleTitle && <span className="block text-[11px] text-faint">{r.roleTitle}</span>}</span>
    ) },
    { key: "phone", header: t("common.phone"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.phone ?? "—"}</span> },
    { key: "dept", header: t("members.department"), render: (r) => r.department === "men" ? t("members.deptMen") : r.department === "women" ? t("members.deptWomen") : t("members.deptGeneral") },
    { key: "salary", header: t("emp.salaryBase"), render: (r) => hasPermission("salaries.view") && r.salaryBaseMinor != null
      ? <span dir="ltr" className="tabnum">{formatMinor(r.salaryBaseMinor)}</span> : <span>—</span> },
    { key: "status", header: t("common.status"), render: (r) => <Badge variant={r.isActive ? "success" : "neutral"} dot>{r.isActive ? t("status.active") : t("status.inactive")}</Badge> },
    ...(hasPermission("employees.purge") ? [{
      key: "purge", header: "", align: "end" as const,
      render: (r: PublicEmployee) => (
        <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={() => setPurgeTarget(r)}>
          <Trash2 className="size-3.5" />{t("emp.purgeAction")}
        </Button>
      ),
    }] : []),
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("emp.tabEmployees")}
          action={hasPermission("employees.manage") ? (
            <Button onClick={() => setModal({ open: true, target: null })}><UserPlus className="size-4" />{t("emp.addEmployee")}</Button>
          ) : undefined}
        />
        {rows.length === 0 ? <EmptyState icon={<UserPlus />} title={t("trainers.emptyTitle")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {modal.open && (
        <EmployeeFormModal
          target={modal.target}
          canSeeSalary={hasPermission("salaries.view")}
          onClose={() => setModal({ open: false, target: null })}
          onSaved={() => { setModal({ open: false, target: null }); reload(); }}
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

function EmployeeFormModal({ target, canSeeSalary, onClose, onSaved }: {
  target: PublicEmployee | null;
  canSeeSalary: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({
    fullName: target?.fullName ?? "",
    phone: target?.phone ?? "",
    roleTitle: target?.roleTitle ?? "",
    department: target?.department ?? "general",
    specialization: target?.specialization ?? "",
    joinedDate: target?.joinedDate ?? "",
    salaryType: target?.salaryType ?? "monthly",
    salaryMajor: target?.salaryBaseMinor != null ? String(target.salaryBaseMinor / 100) : "",
    notes: target?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
        notes: form.notes || null,
      };
      if (canSeeSalary) {
        payload.salaryType = form.salaryType;
        payload.salaryBaseMinor = form.salaryMajor === "" ? null : Math.round(Number(form.salaryMajor) * 100);
      }
      if (target) await api.employees.update(target.id, payload);
      else await api.employees.create(payload as never);
      toast("success", t("toast.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={target ? t("emp.editEmployee") : t("emp.addEmployee")} widthClass="max-w-lg"
      footer={<><Button type="submit" form="employee-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="employee-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <Input label={t("emp.fullName")} value={form.fullName} onChange={set("fullName")} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("common.phone")} dir="ltr" value={form.phone} onChange={set("phone")} />
          <Input label={t("emp.roleTitle")} value={form.roleTitle} onChange={set("roleTitle")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label={t("members.department")} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value as typeof f.department }))} options={[
            { value: "general", label: t("members.deptGeneral") },
            { value: "men", label: t("members.deptMen") },
            { value: "women", label: t("members.deptWomen") },
          ]} />
          <Input label={t("emp.joinedDate")} type="date" dir="ltr" value={form.joinedDate} onChange={set("joinedDate")} />
        </div>
        <Input label={t("emp.specialization")} value={form.specialization} onChange={set("specialization")} />
        {canSeeSalary && (
          <div className="grid grid-cols-2 gap-3">
            <Select label={t("emp.salaryType")} value={form.salaryType} onChange={(e) => setForm((f) => ({ ...f, salaryType: e.target.value as SalaryType }))} options={[
              { value: "monthly", label: t("emp.stMonthly") },
              { value: "daily", label: t("emp.stDaily") },
              { value: "per_class", label: t("emp.stPerClass") },
              { value: "custom", label: t("emp.stCustom") },
            ]} />
            <Input label={t("emp.salaryBase")} type="number" step="0.01" min={0} dir="ltr" value={form.salaryMajor} onChange={set("salaryMajor")} />
          </div>
        )}
        <Input label={t("common.notes")} value={form.notes} onChange={set("notes")} />
      </form>
    </Modal>
  );
}

// ------------------------------- salaries ---------------------------------

function SalariesTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<PublicSalary[]>([]);
  const [periodMonth, setPeriodMonth] = useState(todayKey().slice(0, 7));
  const [recordFor, setRecordFor] = useState<PublicEmployee | null>(null);
  const [payTarget, setPayTarget] = useState<PublicSalary | null>(null);

  const reload = useCallback(() => {
    api.employees.listSalaries({ periodMonth }).then(setRows).catch(console.error);
  }, [periodMonth]);
  useEffect(() => { reload(); }, [reload]);

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

  const columns: Column<PublicSalary>[] = [
    { key: "emp", header: t("emp.fullName"), render: (r) => <span className="font-bold">{r.employeeName}</span> },
    { key: "period", header: t("emp.period"), render: (r) => <span dir="ltr" className="tabnum">{r.periodMonth}</span> },
    { key: "base", header: t("emp.base"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.baseMinor)}</span> },
    { key: "net", header: t("emp.net"), render: (r) => <span dir="ltr" className="font-bold tabnum">{formatMinor(r.netMinor)}</span> },
    { key: "status", header: t("common.status"), render: (r) => <Badge variant={r.status === "paid" ? "success" : "warning"} dot>{r.status === "paid" ? t("emp.paid") : t("emp.pending")}</Badge> },
    ...(hasPermission("salaries.manage") ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: PublicSalary) => r.status === "pending" ? (
        <Button size="sm" variant="secondary" onClick={() => setPayTarget(r)}><BanknoteCheck className="size-3.5" />{t("emp.paySalary")}</Button>
      ) : <span dir="ltr" className="text-[11px] tabnum text-faint">{r.paidAt?.slice(0, 16)}</span>,
    }] : []),
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("emp.tabSalaries")}
          action={
            <div className="flex items-center gap-2">
              <Input type="month" dir="ltr" value={periodMonth} onChange={(e: ChangeEvent<HTMLInputElement>) => setPeriodMonth(e.target.value)} className="w-36" />
              {hasPermission("salaries.manage") && actor && (
                <PickEmployeeButton onPick={(emp) => setRecordFor(emp)} />
              )}
            </div>
          }
        />
        {rows.length === 0 ? <EmptyState icon={<UserPlus />} title={t("audit.empty")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>

      {recordFor && (
        <RecordSalaryModal
          employee={recordFor}
          periodMonth={periodMonth}
          onClose={() => setRecordFor(null)}
          onSaved={() => { setRecordFor(null); reload(); }}
        />
      )}
      <ConfirmDialog
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title={t("emp.paySalary")}
        message={payTarget ? `${payTarget.employeeName} — ${payTarget.periodMonth} — ${formatMinor(payTarget.netMinor)}` : ""}
        confirmLabel={t("common.confirm")}
        onConfirm={() => void doPay()}
      />
    </>
  );
}

function PickEmployeeButton({ onPick }: { onPick: (emp: PublicEmployee) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PublicEmployee[]>([]);
  useEffect(() => {
    if (!open) return;
    api.employees.list().then(setList).catch(console.error);
  }, [open]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>{t("emp.recordSalary")}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("emp.recordSalary")} widthClass="max-w-xs">
        <ul className="divide-y divide-line text-sm">
          {list.map((emp) => (
            <li key={emp.id}>
              <button type="button" className="w-full px-1 py-2.5 text-start hover:text-neon"
                onClick={() => { setOpen(false); onPick(emp); }}>
                {emp.fullName}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function RecordSalaryModal({ employee, periodMonth, onClose, onSaved }: {
  employee: PublicEmployee;
  periodMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [bonusMajor, setBonusMajor] = useState("0");
  const [deductionMajor, setDeductionMajor] = useState("0");
  const [busy, setBusy] = useState(false);

  const baseMinor = employee.salaryBaseMinor ?? 0;
  const netMinor = baseMinor + Math.round(Number(bonusMajor || 0) * 100) - Math.round(Number(deductionMajor || 0) * 100);

  const save = async () => {
    setBusy(true);
    try {
      await api.employees.recordSalary({
        employeeId: employee.id,
        periodMonth,
        bonusMinor: Math.round(Number(bonusMajor || 0) * 100),
        deductionMinor: Math.round(Number(deductionMajor || 0) * 100),
      });
      toast("success", t("emp.recordedToast"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t("emp.recordSalary")} — ${employee.fullName}`} widthClass="max-w-sm"
      footer={<><Button type="submit" form="salary-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="salary-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <p className="flex justify-between rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm">
          <span>{t("emp.base")}</span>
          <span dir="ltr" className="font-bold tabnum">{formatMinor(baseMinor)}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("emp.bonus")} type="number" step="0.01" min={0} dir="ltr" value={bonusMajor} onChange={(e: ChangeEvent<HTMLInputElement>) => setBonusMajor(e.target.value)} />
          <Input label={t("emp.deduction")} type="number" step="0.01" min={0} dir="ltr" value={deductionMajor} onChange={(e: ChangeEvent<HTMLInputElement>) => setDeductionMajor(e.target.value)} />
        </div>
        <p className="flex justify-between border-t border-line pt-3 text-sm font-extrabold">
          <span>{t("emp.net")}</span>
          <span dir="ltr" className="tabnum text-neon">{formatMinor(Math.max(0, netMinor))}</span>
        </p>
      </form>
    </Modal>
  );
}
