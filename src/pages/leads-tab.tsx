import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  CalendarCheck,
  CalendarClock,
  Check,
  Columns3,
  MessageCircle,
  Pencil,
  Plus,
  Table2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type Lead,
  type LeadActivity,
  type LeadFollowup,
  type LeadSource,
  type LeadStatus,
  type LeadStats,
} from "@/api";
import type { PublicMember } from "@/api";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

const STATUSES: LeadStatus[] = ["new", "contacted", "interested", "trial", "joined", "lost"];
const SOURCES: LeadSource[] = [
  "facebook",
  "instagram",
  "whatsapp",
  "referral",
  "walk_in",
  "existing_member",
  "other",
];
const DEPTS = ["general", "men", "women"] as const;

function statusVariant(s: LeadStatus): BadgeVariant {
  switch (s) {
    case "joined":
      return "success";
    case "lost":
      return "danger";
    case "trial":
      return "warning";
    case "interested":
      return "violet";
    case "contacted":
      return "info";
    default:
      return "neutral";
  }
}

type ViewMode = "kanban" | "table" | "today";

export function LeadsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("leads.manage");

  const [view, setView] = useState<ViewMode>("kanban");
  const [newOpen, setNewOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <Card>
      <CardHeader
        title={t("leadsTab.title")}
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-line bg-panel p-0.5">
              {(
                [
                  { v: "kanban", label: t("leadsTab.viewKanban"), Icon: Columns3 },
                  { v: "table", label: t("leadsTab.viewTable"), Icon: Table2 },
                  { v: "today", label: t("leadsTab.viewToday"), Icon: CalendarCheck },
                ] as const
              ).map(({ v, label, Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors ${
                    view === v ? "bg-neon/15 text-neon" : "text-subtle hover:text-ink"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setNewOpen(true)}>
                <Plus className="size-3.5" />
                {t("leadsTab.add")}
              </Button>
            )}
          </div>
        }
      />
      <div className="p-5">
        {view === "kanban" && <KanbanView refreshKey={refreshKey} onOpen={setDetailLead} />}
        {view === "table" && <TableView refreshKey={refreshKey} onOpen={setDetailLead} />}
        {view === "today" && <TodayView refreshKey={refreshKey} onOpen={setDetailLead} />}
      </div>

      <NewLeadModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={reload} />
      <LeadDetailModal
        leadId={detailLead?.id ?? null}
        onClose={() => setDetailLead(null)}
        onChanged={reload}
      />
    </Card>
  );
}

// ------------------------------- Kanban -----------------------------------

function KanbanView({ refreshKey, onOpen }: { refreshKey: number; onOpen: (l: Lead) => void }) {
  const t = useT();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);

  const load = useCallback(() => {
    api.lead
      .list({ status: "all", pageSize: 200 })
      .then((r) => setLeads(r.items))
      .catch(console.error);
    api.lead.stats().then(setStats).catch(console.error);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const grouped = useMemo(() => {
    const map: Record<LeadStatus, Lead[]> = { new: [], contacted: [], interested: [], trial: [], joined: [], lost: [] };
    for (const l of leads) map[l.status]?.push(l);
    return map;
  }, [leads]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatChip label={t("leadsTab.st_total")} value={stats?.total ?? 0} />
        <StatChip label={t("leadsTab.st_newThisMonth")} value={stats?.newThisMonth ?? 0} />
        <StatChip label={t("leadsTab.st_joined")} value={stats?.joined ?? 0} />
        <StatChip label={t("leadsTab.st_lost")} value={stats?.lost ?? 0} />
        <StatChip label={t("leadsTab.st_conversion")} value={`${stats?.conversionRate ?? 0}%`} />
        <StatChip label={t("leadsTab.st_dueFollowups")} value={stats?.dueFollowups ?? 0} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-line bg-panel/60 p-2.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <Badge variant={statusVariant(s)} dot>{t(`leadsTab.status_${s}`)}</Badge>
              <span className="text-xs font-bold text-subtle">{grouped[s].length}</span>
            </div>
            <div className="space-y-2">
              {grouped[s].length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-faint">{t("leadsTab.columnEmpty")}</p>
              )}
              {grouped[s].map((l) => (
                <KanbanCard key={l.id} lead={l} onOpen={() => onOpen(l)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <p className="text-[11px] font-semibold text-subtle">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold tabnum">{value}</p>
    </div>
  );
}

function KanbanCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("leads.manage");

  const move = (e: ChangeEvent<HTMLSelectElement>) => {
    const to = e.target.value as LeadStatus;
    if (to === lead.status) return;
    api.lead
      .update(lead.id, { status: to })
      .then(() => onOpen())
      .catch((err) => toast("error", describeError(err, t)));
  };

  return (
    <div className="group rounded-lg border border-line bg-raised p-2.5 shadow-sm">
      <button type="button" onClick={onOpen} className="w-full text-start">
        <p className="truncate text-sm font-bold">{lead.fullName}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-faint">
          <Badge variant="neutral">{t(`leadsTab.source_${lead.source}`)}</Badge>
          {lead.assignedEmployeeName && (
            <span className="truncate">{t("leadsTab.assignedTo")}: {lead.assignedEmployeeName}</span>
          )}
        </p>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span dir="ltr" className="truncate text-[11px] tabnum text-subtle">{lead.phone ?? "—"}</span>
        {canManage && lead.status !== "lost" && lead.status !== "joined" && (
          <select
            value={lead.status}
            onChange={move}
            onClick={(e) => e.stopPropagation()}
            className="h-6 cursor-pointer rounded-md border border-line bg-panel px-1 text-[10px] font-bold text-subtle outline-none"
          >
            {STATUSES.filter((s) => s !== "joined").map((s) => (
              <option key={s} value={s}>{t(`leadsTab.status_${s}`)}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// -------------------------------- Table -----------------------------------

function TableView({ refreshKey, onOpen }: { refreshKey: number; onOpen: (l: Lead) => void }) {
  const t = useT();
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [dept, setDept] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const load = useCallback(() => {
    api.lead
      .list({
        status: status as LeadStatus | "all",
        source: source as LeadSource | "all",
        department: dept as "general" | "men" | "women" | "all",
        search: search || undefined,
        page,
        pageSize,
      })
      .then((r) => { setRows(r.items); setTotal(r.total); })
      .catch(console.error);
  }, [status, source, dept, search, page, refreshKey]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const columns: Column<Lead>[] = [
    { key: "name", header: t("leadsTab.fieldName"), render: (r) => (
      <button type="button" onClick={() => onOpen(r)} className="font-bold hover:text-neon">{r.fullName}</button>
    ) },
    { key: "phone", header: t("leadsTab.fieldPhone"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.phone ?? "—"}</span> },
    { key: "source", header: t("leadsTab.source"), render: (r) => <Badge variant="neutral">{t(`leadsTab.source_${r.source}`)}</Badge> },
    { key: "status", header: t("leadsTab.status"), render: (r) => <Badge variant={statusVariant(r.status)} dot>{t(`leadsTab.status_${r.status}`)}</Badge> },
    { key: "assigned", header: t("leadsTab.assignedTo"), render: (r) => r.assignedEmployeeName ?? "—" },
    { key: "created", header: t("common.date"), render: (r) => (
      <span dir="ltr" className="tabnum text-subtle">{formatDateShort(new Date(r.createdAt.slice(0, 10) + "T00:00:00"))}</span>
    ) },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Input label="" placeholder={t("leadsTab.searchPh")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="w-40">
          <Select label="" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            options={[{ value: "all", label: t("leadsTab.statusAll") }, ...STATUSES.map((s) => ({ value: s, label: t(`leadsTab.status_${s}`) }))]} />
        </div>
        <div className="w-40">
          <Select label="" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}
            options={[{ value: "all", label: t("leadsTab.sourceAll") }, ...SOURCES.map((s) => ({ value: s, label: t(`leadsTab.source_${s}`) }))]} />
        </div>
        <div className="w-40">
          <Select label="" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }}
            options={[{ value: "all", label: t("leadsTab.departmentAll") }, ...DEPTS.map((d) => ({ value: d, label: t(`leadsTab.department_${d}`) }))]} />
        </div>
      </div>
      {rows.length === 0
        ? <EmptyState icon={<UserPlus />} title={t("leadsTab.empty")} />
        : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-subtle">
          <span>{t("leadsTab.pageCount", { page, total: totalPages })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------- Today -----------------------------------

function TodayView({ refreshKey, onOpen }: { refreshKey: number; onOpen: (l: Lead) => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [followups, setFollowups] = useState<LeadFollowup[]>([]);
  const canManage = hasPermission("leads.manage");

  const load = useCallback(() => {
    api.lead.todayFollowups().then(setFollowups).catch(console.error);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const markDone = (id: string) => {
    api.lead
      .completeFollowup(id, true)
      .then(() => { toast("success", t("toast.saved")); load(); })
      .catch((err) => toast("error", describeError(err, t)));
  };

  return (
    <div className="space-y-3">
      {followups.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title={t("leadsTab.noFollowups")} />
      ) : (
        followups.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-line bg-panel p-3">
            <div>
              <p className="font-bold">
                <button type="button" onClick={() => onOpen({ id: f.leadId } as Lead)} className="text-neon">{f.leadName}</button>
              </p>
              <p className="text-xs text-subtle">{t("leadsTab.dueOn")} <span dir="ltr" className="tabnum">{formatDateShort(new Date(f.dueDate + "T00:00:00"))}{f.dueTime ? ` · ${f.dueTime}` : ""}</span></p>
              {f.note && <p dir="auto" className="mt-1 text-xs text-subtle">{f.note}</p>}
            </div>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => markDone(f.id)}>
                <Check className="size-3.5" />{t("leadsTab.markDone")}
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// -------------------------------- New Lead --------------------------------

function NewLeadModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<LeadSource>("facebook");
  const [department, setDepartment] = useState<"general" | "men" | "women">("general");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setFullName(""); setPhone(""); setEmail(""); setSource("facebook"); setDepartment("general"); setNotes(""); setError("");
    }
  }, [open]);

  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.lead.create({ fullName, phone: phone.trim() || null, email: email.trim() || null, source, department, notes: notes.trim() || null });
      toast("success", t("leadsTab.created"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("leadsTab.newTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("leadsTab.cancel")}</Button>
          <Button onClick={() => void save()} loading={busy}>{t("leadsTab.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-xs font-semibold text-red">{error}</p>}
        <Input label={t("leadsTab.fieldName") + " *"} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("leadsTab.fieldPhone")} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={t("leadsTab.fieldEmail")} dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label={t("leadsTab.fieldSource")} value={source} onChange={(e) => setSource(e.target.value as LeadSource)}
            options={SOURCES.map((s) => ({ value: s, label: t(`leadsTab.source_${s}`) }))} />
          <Select label={t("leadsTab.fieldDepartment")} value={department} onChange={(e) => setDepartment(e.target.value as "general" | "men" | "women")}
            options={DEPTS.map((d) => ({ value: d, label: t(`leadsTab.department_${d}`) }))} />
        </div>
        <textarea
          dir="auto"
          rows={3}
          placeholder={t("leadsTab.fieldNotes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm outline-none focus:border-neon/60"
        />
      </div>
    </Modal>
  );
}

// ------------------------------ Detail Modal -------------------------------

function LeadDetailModal({ leadId, onClose, onChanged }: { leadId: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("leads.manage");
  const [lead, setLead] = useState<Lead | null>(null);
  const [followups, setFollowups] = useState<LeadFollowup[]>([]);
  const [activity, setActivity] = useState<LeadActivity[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [convertPicker, setConvertPicker] = useState(false);
  const [addFollowupOpen, setAddFollowupOpen] = useState(false);

  const load = useCallback(() => {
    if (!leadId) return;
    api.lead.get(leadId).then(setLead).catch(console.error);
    api.lead.listFollowups(leadId).then(setFollowups).catch(console.error);
    api.lead.listActivity(leadId).then(setActivity).catch(console.error);
  }, [leadId]);
  useEffect(() => {
    if (!leadId) { setLead(null); setFollowups([]); setActivity([]); return; }
    load();
  }, [leadId, load]);

  if (!lead) return null;

  const convertToMember = async () => {
    if (!lead) return;
    try {
      const res = await api.lead.convert(lead.id);
      toast("success", t("leadsTab.convertDone", { code: res.memberCode }));
      onChanged();
      load();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const convertToExisting = async (member: PublicMember) => {
    if (!lead) return;
    setConvertPicker(false);
    try {
      await api.lead.convert(lead.id, member.id);
      toast("success", t("leadsTab.convertLinked", { name: member.fullName }));
      onChanged();
      load();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const remove = async () => {
    if (!lead) return;
    try {
      await api.lead.remove(lead.id);
      toast("success", t("leadsTab.deleted"));
      onChanged();
      onClose();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const didConvert = !!lead.convertedMemberId;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t("leadsTab.detailTitle")}
        widthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold">{lead.fullName}</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-subtle">
                <span dir="ltr" className="tabnum">{lead.phone ?? "—"}</span>
                {lead.email && <span dir="ltr" className="text-faint">{lead.email}</span>}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant={statusVariant(lead.status)} dot>{t(`leadsTab.status_${lead.status}`)}</Badge>
              <Badge variant="neutral">{t(`leadsTab.source_${lead.source}`)}</Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{t("leadsTab.fieldDepartment")}: {t(`leadsTab.department_${lead.department}`)}</Badge>
            {lead.assignedEmployeeName && <Badge variant="neutral">{t("leadsTab.assignedTo")}: {lead.assignedEmployeeName}</Badge>}
            {lead.interestedPlanName && <Badge variant="violet">{t("leadsTab.fieldPackage")}: {lead.interestedPlanName}</Badge>}
            {didConvert && <Badge variant="success">{t("leadsTab.converted")}</Badge>}
            {lead.phone && (
              <a
                href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs font-bold text-neon ring-1 ring-neon/25 hover:bg-neon/10"
              >
                <MessageCircle className="size-3.5" />{t("leadsTab.whatsapp")}
              </a>
            )}
          </div>

          {lead.notes && <p dir="auto" className="rounded-lg bg-panel px-3 py-2 text-sm text-subtle">{lead.notes}</p>}
          {lead.lostReason && lead.status === "lost" && (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-xs font-semibold text-red">{t("leadsTab.lostReason")}: {lead.lostReason}</p>
          )}

          {!didConvert && canManage && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" onClick={() => void convertToMember()}>
                <UserPlus className="size-3.5" />{t("leadsTab.convertToMember")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConvertPicker(true)}>
                {t("leadsTab.convertLink")}
              </Button>
              <div className="ms-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-3.5" />{t("leadsTab.edit")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => { if (confirm(t("leadsTab.deleteConfirm"))) void remove(); }}>
                  <Trash2 className="size-3.5" />{t("leadsTab.delete")}
                </Button>
              </div>
            </div>
          )}
          {didConvert && (
            <div className="flex items-center justify-between border-t border-line pt-3">
              <p className="text-xs text-subtle">{t("leadsTab.convertedToMember")}: {lead.convertedMemberId}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-3.5" />{t("leadsTab.edit")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => { if (confirm(t("leadsTab.deleteConfirm"))) void remove(); }}>
                  <Trash2 className="size-3.5" />{t("leadsTab.delete")}
                </Button>
              </div>
            </div>
          )}

          <div className="border-t border-line pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold">{t("leadsTab.followups")}</p>
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setAddFollowupOpen(true)}>
                  <Plus className="size-3.5" />{t("leadsTab.addFollowup")}
                </Button>
              )}
            </div>
            {followups.length === 0 ? (
              <p className="text-xs text-faint">{t("leadsTab.noFollowups")}</p>
            ) : (
              <ul className="space-y-1.5">
                {followups.map((f) => (
                  <li key={f.id} className="flex items-center justify-between rounded-lg bg-panel px-3 py-2">
                    <div>
                      <p className={`text-xs font-bold ${f.done ? "text-faint line-through" : ""}`}>
                        <span dir="ltr" className="tabnum">{formatDateShort(new Date(f.dueDate + "T00:00:00"))}{f.dueTime ? ` · ${f.dueTime}` : ""}</span>
                      </p>
                      {f.note && <p dir="auto" className="text-xs text-subtle">{f.note}</p>}
                    </div>
                    {canManage && !f.done && (
                      <Button size="sm" variant="ghost" onClick={() => api.lead.completeFollowup(f.id, true).then(() => { toast("success", t("toast.saved")); load(); }).catch((e) => toast("error", describeError(e, t)))}>
                        <Check className="size-3" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-sm font-bold">{t("leadsTab.activity")}</p>
            {activity.length === 0 ? (
              <p className="text-xs text-faint">{t("leadsTab.noActivity")}</p>
            ) : (
              <ul className="space-y-1.5">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 text-xs">
                    <span className="text-subtle">{a.note || a.action}</span>
                    <span dir="ltr" className="shrink-0 text-faint tabnum">{a.createdAt.slice(0, 16)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>

      <EditLeadModal lead={lead} open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => { onChanged(); load(); }} />
      <AddFollowupModal leadId={lead.id} open={addFollowupOpen} onClose={() => setAddFollowupOpen(false)} onSaved={() => { onChanged(); load(); }} />
      <MemberPickerModal open={convertPicker} onClose={() => setConvertPicker(false)} onSelect={(m) => void convertToExisting(m)} />
    </>
  );
}

// ------------------------------- Edit Lead --------------------------------

function EditLeadModal({ lead, open, onClose, onSaved }: { lead: Lead; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [fullName, setFullName] = useState(lead.fullName);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [source, setSource] = useState<LeadSource>(lead.source);
  const [department, setDepartment] = useState<"general" | "men" | "women">(lead.department);
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [lostReason, setLostReason] = useState(lead.lostReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setFullName(lead.fullName); setPhone(lead.phone ?? ""); setEmail(lead.email ?? "");
      setSource(lead.source); setDepartment(lead.department); setStatus(lead.status);
      setNotes(lead.notes ?? ""); setLostReason(lead.lostReason ?? ""); setError("");
    }
  }, [open, lead]);

  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.lead.update(lead.id, {
        fullName, phone: phone.trim() || null, email: email.trim() || null,
        source, department, status, notes: notes.trim() || null,
        lostReason: lostReason.trim() || (status === "lost" ? undefined : null),
      });
      toast("success", t("leadsTab.saved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("leadsTab.editTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("leadsTab.cancel")}</Button>
          <Button onClick={() => void save()} loading={busy}>{t("leadsTab.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-xs font-semibold text-red">{error}</p>}
        <Input label={t("leadsTab.fieldName") + " *"} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("leadsTab.fieldPhone")} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={t("leadsTab.fieldEmail")} dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label={t("leadsTab.fieldSource")} value={source} onChange={(e) => setSource(e.target.value as LeadSource)}
            options={SOURCES.map((s) => ({ value: s, label: t(`leadsTab.source_${s}`) }))} />
          <Select label={t("leadsTab.fieldDepartment")} value={department} onChange={(e) => setDepartment(e.target.value as "general" | "men" | "women")}
            options={DEPTS.map((d) => ({ value: d, label: t(`leadsTab.department_${d}`) }))} />
        </div>
        <Select label={t("leadsTab.status")} value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}
          options={STATUSES.map((s) => ({ value: s, label: t(`leadsTab.status_${s}`) }))} />
        {status === "lost" && (
          <Input label={t("leadsTab.lostReason")} value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
        )}
        <textarea
          dir="auto"
          rows={3}
          placeholder={t("leadsTab.fieldNotes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm outline-none focus:border-neon/60"
        />
      </div>
    </Modal>
  );
}

// ----------------------------- Add Followup -------------------------------

function AddFollowupModal({ leadId, open, onClose, onSaved }: { leadId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setDueDate(""); setDueTime(""); setNote(""); setError(""); }
  }, [open]);

  const save = async () => {
    if (!dueDate) { setError(t("leadsTab.dueDateRequired")); return; }
    setBusy(true); setError("");
    try {
      await api.lead.addFollowup(leadId, { dueDate, dueTime: dueTime || null, note: note.trim() || null });
      toast("success", t("leadsTab.saved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("leadsTab.addFollowup")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("leadsTab.cancel")}</Button>
          <Button onClick={() => void save()} loading={busy}>{t("leadsTab.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-xs font-semibold text-red">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-subtle">{t("leadsTab.dueDate")} *</label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-subtle">{t("leadsTab.dueTime")}</label>
            <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
        </div>
        <Input label={t("leadsTab.followupNote")} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
