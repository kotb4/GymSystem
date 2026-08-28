import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicEmployee, type PublicUser, type SalaryType } from "@/api";
import { formatMinor } from "@/core/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
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

  const visibleTabs = [
    ...(canEmployees ? [{ value: "employees", label: t("emp.tabEmployees") }] : []),
    ...(canHr ? [{ value: "attendance", label: t("hr.tabAttendance") }] : []),
    ...(canHr ? [{ value: "leaves", label: t("hr.tabLeaves") }] : []),
    ...(canHr ? [{ value: "hours", label: t("hr.monthlyHours") }] : []),
    ...(hasPermission("hr.manage") ? [{ value: "deductions", label: t("hr.tabDeductions") }] : []),
    ...(hasPermission("hr.manage") ? [{ value: "incentives", label: t("hr.tabIncentives") }] : []),
    ...(canSalaries || canActivity ? [{ value: "salary", label: t("hr.tabSalarySummary") }] : []),
    ...(canActivity ? [{ value: "activity", label: t("hr.tabActivity") }] : []),
  ];

  const activeTab = visibleTabs.some((tn) => tn.value === tab) ? tab : visibleTabs[0]?.value ?? "employees";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("nav.employees")} />
        <div className="px-5 pb-1">
          <Tabs items={visibleTabs} value={activeTab} onChange={setTab} />
        </div>
      </Card>
      {activeTab === "employees" && canEmployees && <EmployeesTab />}
      {activeTab === "attendance" && canHr && <AttendanceTab />}
      {activeTab === "leaves" && canHr && <LeavesTab />}
      {activeTab === "hours" && canHr && <MonthlyHoursTab />}
      {activeTab === "deductions" && hasPermission("hr.manage") && <DeductionsTab />}
      {activeTab === "incentives" && hasPermission("hr.manage") && <IncentivesTab />}
      {activeTab === "salary" && (canSalaries || canActivity) && <SalarySummaryTab />}
      {activeTab === "activity" && canActivity && <ActivityTab />}
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
    { key: "barcode", header: t("emp.barcode"), render: (r) => <span dir="ltr" className="font-mono tabnum text-subtle">{r.barcode ?? "—"}</span> },
    { key: "dept", header: t("members.department"), render: (r) => r.department === "men" ? t("members.deptMen") : r.department === "women" ? t("members.deptWomen") : t("members.deptGeneral") },
    { key: "salary", header: t("emp.salaryBase"), render: (r) => hasPermission("salaries.view") && r.salaryBaseMinor != null
      ? <span dir="ltr" className="tabnum">{formatMinor(r.salaryBaseMinor)}</span> : <span>—</span> },
    { key: "status", header: t("common.status"), render: (r) => <Badge variant={r.isActive ? "success" : "neutral"} dot>{r.isActive ? t("status.active") : t("status.inactive")}</Badge> },
    ...(hasPermission("employees.manage") || hasPermission("employees.purge") ? [{
      key: "actions", header: "", align: "end" as const,
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
    barcode: target?.barcode ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [linkedUserId, setLinkedUserId] = useState(target?.userId ?? "");
  const canLinkUser = target || hasPermission("users.view");
  useEffect(() => {
    if (!canLinkUser) return;
    let alive = true;
    api.users.list().then((list) => { if (alive) setUsers(list); }).catch(console.error);
    return () => { alive = false; };
  }, [canLinkUser]);
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
        isActive: form.isActive,
      };
      if (canLinkUser) payload.userId = linkedUserId ? linkedUserId : null;
      if (canSeeSalary) {
        payload.salaryType = form.salaryType;
        payload.salaryBaseMinor = form.salaryMajor === "" ? null : Math.round(Number(form.salaryMajor) * 100);
      }
      let id = target?.id ?? "";
      if (target) await api.employees.update(target.id, payload);
      else {
        const created = await api.employees.create(payload as never);
        id = created.id;
      }
      await api.employeesHr.setEmployeeBarcode(id, form.barcode.trim() === "" ? null : form.barcode.trim());
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
        <Input label={t("emp.barcode")} dir="ltr" className="font-mono uppercase tracking-widest" placeholder="EMP-000001" value={form.barcode} onChange={set("barcode")} />
        {canLinkUser && (
          <Select label={t("emp.userId")} value={linkedUserId} onChange={(e) => setLinkedUserId(e.target.value)} options={[
            { value: "", label: t("emp.noUserAccount") },
            ...users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.username})` })),
          ]} />
        )}
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
        <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}>
          {form.isActive ? t("status.active") : t("status.inactive")}
        </Checkbox>
      </form>
    </Modal>
  );
}
