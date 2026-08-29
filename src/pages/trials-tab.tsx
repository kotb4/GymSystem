import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Plus,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicMember, type Plan, type Trial, type TrialStats, type TrialStatus, type TrialType } from "@/api";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

const DEPTS = ["general", "men", "women"] as const;

function statusVariant(s: TrialStatus): BadgeVariant {
  switch (s) {
    case "active":
      return "success";
    case "expired":
      return "danger";
    case "converted":
      return "violet";
    default:
      return "neutral";
  }
}

export function TrialsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("trials.create");
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<Trial | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <Card>
      <CardHeader
        title={t("trialsTab.title")}
        action={
          canCreate && (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-3.5" />
              {t("trialsTab.add")}
            </Button>
          )
        }
      />
      <div className="p-5">
        <TrialsView refreshKey={refreshKey} onOpen={setDetail} />
      </div>
      <NewTrialModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={reload} />
      <TrialDetailModal trial={detail} onClose={() => setDetail(null)} onChanged={reload} />
    </Card>
  );
}

const COLOR: Record<string, string> = {
  success: "text-neon",
  danger: "text-red",
  warning: "text-amber",
  info: "text-cyan",
  violet: "text-violet",
  neutral: "",
};

function StatChip({ label, value, tone }: { label: string; value: string | number; tone?: BadgeVariant }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <p className="text-[11px] font-semibold text-subtle">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold tabnum ${tone ? COLOR[tone] ?? "" : ""}`}>
        {value}
      </p>
    </div>
  );
}

// ------------------------------- list view ---------------------------------

function TrialsView({ refreshKey, onOpen }: { refreshKey: number; onOpen: (t: Trial) => void }) {
  const t = useT();
  const [rows, setRows] = useState<Trial[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TrialStats | null>(null);
  const [status, setStatus] = useState<"all" | TrialStatus>("all");
  const [dept, setDept] = useState<"all" | (typeof DEPTS)[number]>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const load = useCallback(() => {
    api.trials
      .list({
        status,
        department: dept,
        search: search || undefined,
        page,
        pageSize,
      })
      .then((r) => { setRows(r.items); setTotal(r.total); })
      .catch(console.error);
    api.trials.stats().then(setStats).catch(console.error);
  }, [status, dept, search, page, refreshKey]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const columns: Column<Trial>[] = [
    { key: "name", header: t("trialsTab.colName"), render: (r) => (
      <button type="button" onClick={() => onOpen(r)} className="font-bold hover:text-neon">
        {r.memberName ?? r.phone ?? "—"}
      </button>
    ) },
    { key: "phone", header: t("trialsTab.colPhone"), render: (r) => (
      <span dir="ltr" className="tabnum text-subtle">{r.phone ?? "—"}</span>
    ) },
    { key: "lead", header: t("trialsTab.colLead"), render: (r) => (r.leadId ? <Badge variant="info">{t("trialsTab.linkedLead")}</Badge> : "—") },
    { key: "type", header: t("trialsTab.colType"), render: (r) => (
      <Badge variant="neutral">{t(`trialsTab.type_${r.trialType}`)}</Badge>
    ) },
    { key: "plan", header: t("trialsTab.colPlan"), render: (r) => (r.planName ? <Badge variant="violet">{r.planName}</Badge> : "—") },
    { key: "dates", header: t("trialsTab.colDates"), render: (r) => (
      <span dir="ltr" className="tabnum text-subtle">{r.startDate} → {r.endDate}</span>
    ) },
    { key: "status", header: t("trialsTab.colStatus"), render: (r) => (
      <Badge variant={statusVariant(r.effectiveStatus)} dot>{t(`trialsTab.status_${r.effectiveStatus}`)}</Badge>
    ) },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <TrialsStatsChips stats={stats} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Input label="" placeholder={t("trialsTab.searchPh")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="w-40">
          <Select label="" value={status} onChange={(e) => { setStatus(e.target.value as never); setPage(1); }}
            options={[{ value: "all", label: t("trialsTab.statusAll") }, ...(["active", "expired", "converted", "cancelled"] as const).map((s) => ({ value: s, label: t(`trialsTab.status_${s}`) }))]} />
        </div>
        <div className="w-40">
          <Select label="" value={dept} onChange={(e) => { setDept(e.target.value as never); setPage(1); }}
            options={[{ value: "all", label: t("trialsTab.departmentAll") }, ...DEPTS.map((d) => ({ value: d, label: t(`trialsTab.department_${d}`) }))]} />
        </div>
      </div>
      {rows.length === 0
        ? <EmptyState icon={<CalendarClock />} title={t("trialsTab.empty")} />
        : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-subtle">
          <span>{t("trialsTab.pageCount", { page, total: totalPages })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrialsStatsChips({ stats }: { stats: TrialStats | null }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <StatChip label={t("trialsTab.st_total")} value={stats?.total ?? 0} />
      <StatChip label={t("trialsTab.st_active")} value={stats?.active ?? 0} tone="success" />
      <StatChip label={t("trialsTab.st_expired")} value={stats?.expired ?? 0} />
      <StatChip label={t("trialsTab.st_converted")} value={stats?.converted ?? 0} />
      <StatChip label={t("trialsTab.st_cancelled")} value={stats?.cancelled ?? 0} />
    </div>
  );
}

// ----------------------------- create / edit -------------------------------

function planOptions(plans: Plan[]): Array<{ value: string; label: string }> {
  return plans
    .filter((p) => p.isActive)
    .map((p) => ({ value: p.id, label: p.name }));
}

function dateInputDefault(type: TrialType, start: string): string {
  const offset: Record<string, number> = { day_1: 0, day_3: 2, day_7: 6 };
  const n = offset[type];
  if (n == null) return "";
  const d = new Date(start + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function NewTrialModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [trialType, setTrialType] = useState<TrialType>("free");
  const [department, setDepartment] = useState<(typeof DEPTS)[number]>("general");
  const [member, setMember] = useState<PublicMember | null>(null);
  const [memberPicker, setMemberPicker] = useState(false);
  const [plan, setPlan] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [phone, setPhone] = useState("");
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTrialType("free"); setDepartment("general"); setMember(null); setPlan("");
    setPhone(""); setStartDate(todayKey()); setEndDate(""); setNotes(""); setError("");
    api.plans.list().then(setPlans).catch(() => setPlans([]));
  }, [open]);

  const changeType = (v: TrialType) => {
    setTrialType(v);
    setEndDate(dateInputDefault(v, startDate) || endDate);
  };
  const changeStart = (v: string) => {
    setStartDate(v);
    if (trialType !== "free" && trialType !== "paid" && trialType !== "custom") {
      setEndDate(dateInputDefault(trialType, v));
    }
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.trials.create({
        trialType,
        department,
        memberId: member?.id ?? null,
        phone: phone.trim() || null,
        preferredPlanId: plan || null,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        notes: notes.trim() || null,
      });
      toast("success", t("trialsTab.created"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t("trialsTab.newTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t("trialsTab.cancel")}</Button>
            <Button onClick={() => void save()} loading={busy}>{t("trialsTab.save")}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-xs font-semibold text-red">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Select label={t("trialsTab.fieldType") + " *"} value={trialType} onChange={(e) => changeType(e.target.value as TrialType)}
              options={(["free", "paid", "day_1", "day_3", "day_7", "custom"] as const).map((s) => ({ value: s, label: t(`trialsTab.type_${s}`) }))} />
            <Select label={t("trialsTab.fieldDepartment")} value={department} onChange={(e) => setDepartment(e.target.value as (typeof DEPTS)[number])}
              options={DEPTS.map((d) => ({ value: d, label: t(`trialsTab.department_${d}`) }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-subtle">{t("trialsTab.fieldMember")}</p>
              {member ? (
                <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm">
                  <span className="truncate">{member.fullName}</span>
                  <button type="button" className="text-xs font-bold text-red" onClick={() => setMember(null)}>{t("trialsTab.cancel")}</button>
                </div>
              ) : (
                <Button variant="secondary" className="w-full" onClick={() => setMemberPicker(true)}>
                  <UserPlus className="size-3.5" />{t("trialsTab.linkedMember")}
                </Button>
              )}
            </div>
            <Input label={t("trialsTab.fieldPhone")} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Select label={t("trialsTab.fieldPackage")} value={plan} onChange={(e) => setPlan(e.target.value)}
            options={[{ value: "", label: "—" }, ...planOptions(plans)]} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t("trialsTab.fieldStartDate")} type="date" dir="ltr" value={startDate} onChange={(e) => changeStart(e.target.value)} />
            <Input label={t("trialsTab.fieldEndDate") + " *"} type="date" dir="ltr" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <textarea
            dir="auto"
            rows={3}
            placeholder={t("trialsTab.fieldNotes")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm outline-none focus:border-neon/60"
          />
        </div>
      </Modal>
      <MemberPickerModal open={memberPicker} onClose={() => setMemberPicker(false)} onSelect={(m) => { setMember(m); setMemberPicker(false); }} />
    </>
  );
}

// -------------------------------- detail -----------------------------------

function TrialDetailModal({ trial, onClose, onChanged }: { trial: Trial | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("trials.manage");
  const [convertOpen, setConvertOpen] = useState(false);

  if (!trial) return null;

  const editable = trial.effectiveStatus === "active" || trial.effectiveStatus === "expired";

  const expire = async () => {
    if (!confirm(t("trialsTab.expireConfirm"))) return;
    try {
      await api.trials.expire(trial.id);
      toast("success", t("trialsTab.expired"));
      onChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };
  const cancel = async () => {
    const reason = prompt(t("trialsTab.cancelReason"));
    if (reason == null) return;
    try {
      await api.trials.cancel(trial.id, reason.trim() || null);
      toast("success", t("trialsTab.cancelled"));
      onChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const openConvert = () => { setConvertOpen(false); setConvertOpen(true); };

  return (
    <>
      <Modal open onClose={onClose} title={t("trialsTab.title")} widthClass="max-w-xl">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold">{trial.memberName ?? trial.phone ?? "—"}</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-subtle">
                <span dir="ltr" className="tabnum">{trial.phone ?? "—"}</span>
                <span className="text-faint">{trial.memberCode ?? ""}</span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant={statusVariant(trial.effectiveStatus)} dot>{t(`trialsTab.status_${trial.effectiveStatus}`)}</Badge>
              <Badge variant="neutral">{t(`trialsTab.type_${trial.trialType}`)}</Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{t("trialsTab.fieldDepartment")}: {t(`trialsTab.department_${trial.department}`)}</Badge>
            {trial.planName && <Badge variant="violet">{t("trialsTab.fieldPackage")}: {trial.planName}</Badge>}
            {trial.leadId && <Badge variant="info">{t("trialsTab.linkedLead")}</Badge>}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] font-semibold text-subtle">{t("trialsTab.startDate")}</p>
              <p dir="ltr" className="tabnum">{trial.startDate} ↔ {trial.endDate}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-subtle">{t("trialsTab.endDate")}</p>
              <p dir="ltr" className="tabnum">{trial.endDate}</p>
            </div>
          </div>

          {trial.notes && <p dir="auto" className="rounded-lg bg-panel px-3 py-2 text-sm text-subtle">{trial.notes}</p>}

          {canManage && editable && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" onClick={openConvert}>
                <UserPlus className="size-3.5" />{t("trialsTab.convert")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void expire()}>
                <Hourglass className="size-3.5" />{t("trialsTab.expire")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void cancel()}>
                <XCircle className="size-3.5" />{t("trialsTab.cancelAction")}
              </Button>
            </div>
          )}
          {trial.effectiveStatus === "converted" && (
            <div className="flex items-center gap-2 border-t border-line pt-3 text-sm text-subtle">
              <CheckCircle2 className="size-4 text-neon" />
              {t("trialsTab.converted")}: <span dir="ltr" className="tabnum">{trial.memberCode ?? trial.convertedMemberId}</span>
            </div>
          )}
        </div>
      </Modal>
      <ConvertModal trial={trial} open={convertOpen} onClose={() => setConvertOpen(false)} onSaved={() => { onChanged(); }} />
    </>
  );
}

// ------------------------------ convert ------------------------------------

function ConvertModal({ trial, open, onClose, onSaved }: { trial: Trial; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [existing, setExisting] = useState<PublicMember | null>(null);
  const [picker, setPicker] = useState(false);
  const [plan, setPlan] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setExisting(null); setPlan(""); setPrice(""); setError("");
    api.plans.list().then(setPlans).catch(() => setPlans([]));
  }, [open]);

  const save = async () => {
    setBusy(true); setError("");
    try {
      const res = await api.trials.convert({
        trialId: trial.id,
        existingMemberId: existing?.id ?? undefined,
        planId: plan || undefined,
        price: price ? Number(price) * 100 : undefined,
      });
      toast(
        "success",
        existing || trial.memberId ? t("trialsTab.convertLinked", { name: res.memberName }) : t("trialsTab.convertDone", { code: res.memberCode }),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t("trialsTab.convertTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t("trialsTab.cancel")}</Button>
            <Button onClick={() => void save()} loading={busy}>{t("trialsTab.convert")}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-xs font-semibold text-red">{error}</p>}
          <div>
            <p className="mb-1 text-xs font-semibold text-subtle">{t("trialsTab.convertMemberLabel")}</p>
            {existing ? (
              <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm">
                <span className="truncate">{existing.fullName}</span>
                <button type="button" className="text-xs font-bold text-red" onClick={() => setExisting(null)}>{t("trialsTab.cancel")}</button>
              </div>
            ) : trial.memberId ? (
              <p className="rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-subtle">
                {trial.memberName ?? trial.memberCode}
              </p>
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setPicker(true)}>
                <UserPlus className="size-3.5" />{t("trialsTab.convertExisting")}
              </Button>
            )}
            {!existing && !trial.memberId && (
              <p className="mt-1 text-[11px] text-faint">{t("trialsTab.convertNeedsPermission")}</p>
            )}
          </div>
          <Select label={t("trialsTab.convertPlan") + ` (${t("trialsTab.convertNoPlan")})`} value={plan} onChange={(e) => setPlan(e.target.value)}
            options={[{ value: "", label: t("trialsTab.convertNoPlan") }, ...planOptions(plans)]} />
          <Input label={t("trialsTab.fieldPrice")} dir="ltr" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </Modal>
      <MemberPickerModal open={picker} onClose={() => setPicker(false)} onSelect={(m) => { setExisting(m); setPicker(false); }} />
    </>
  );
}
