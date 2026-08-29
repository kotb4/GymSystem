import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type CrmMessageRow,
  type CrmStatus,
  type CrmTemplate,
} from "@/api";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberPickerModal } from "@/components/members/member-picker-modal";
import { LeadsTab } from "@/pages/leads-tab";
import { TrialsTab } from "@/pages/trials-tab";

const STATUS_OPTIONS: Array<{ value: string; key: string }> = [
  { value: "all", key: "common.all" },
  { value: "pending", key: "crmPage.st_pending" },
  { value: "sent", key: "crmPage.st_sent" },
  { value: "manual_opened", key: "crmPage.st_manual_opened" },
  { value: "failed", key: "crmPage.st_failed" },
  { value: "skipped_no_provider", key: "crmPage.st_skipped_no_provider" },
  { value: "skipped_no_phone", key: "crmPage.st_skipped_no_phone" },
];

function statusVariant(s: CrmStatus) {
  if (s === "sent") return "success" as const;
  if (s === "failed") return "danger" as const;
  if (s === "pending") return "warning" as const;
  return "neutral" as const;
}

export function CrmPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [params] = useSearchParams();
  const initial = () => {
    const q = params.get("tab");
    if (q && ["trials", "leads"].includes(q) && !hasPermission("trials.view")) return "leads";
    if (q && ["trials", "leads"].includes(q)) return q;
    return "queue";
  };
  const [tab, setTab] = useState(initial);
  const tabItems = [
    { value: "queue", label: t("crmPage.tabQueue") },
    { value: "compose", label: t("crmPage.tabCompose") },
    { value: "templates", label: t("crmPage.tabTemplates") },
  ];
  if (hasPermission("trials.view")) {
    tabItems.unshift({ value: "trials", label: t("trialsTab.title") });
  }
  if (hasPermission("leads.view")) {
    tabItems.unshift({ value: "leads", label: t("leadsTab.title") });
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("crmPage.title")} />
        <div className="px-5 pb-1">
          <Tabs
            items={tabItems}
            value={tab}
            onChange={setTab}
          />
        </div>
      </Card>
      {tab === "queue" && <QueueTab />}
      {tab === "compose" && <ComposeTab onQueued={() => setTab("queue")} />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "leads" && <LeadsTab />}
      {tab === "trials" && <TrialsTab />}
    </div>
  );
}

// --------------------------------- queue ----------------------------------

function QueueTab() {
  const t = useT();
  const { toast } = useToast();
  const [rows, setRows] = useState<CrmMessageRow[]>([]);
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.crm
      .listMessages({ status: status === "all" ? "all" : (status as CrmStatus), limit: 120 })
      .then(setRows)
      .catch(console.error);
  }, [status]);
  useEffect(() => { reload(); }, [reload]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await api.crm.generateDue();
      toast("success", t("crmPage.generateDoneToast", { queued: res.queued, duplicates: res.duplicates }));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const sendPending = async () => {
    setBusy(true);
    try {
      const res = await api.crm.sendPending(50);
      toast("success", t("crmPage.sendDoneToast", { sent: res.sent, failed: res.failed, skipped: res.skipped }));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CrmMessageRow>[] = [
    { key: "date", header: t("common.date"), render: (r) => (
      <span dir="ltr" className="block tabnum text-subtle">
        {formatDateShort(new Date(`${r.createdAt.slice(0, 10)}T00:00:00`))}
        <span className="text-faint"> · {r.createdAt.slice(11, 16)}</span>
      </span>
    ) },
    { key: "member", header: t("crmPage.member"), render: (r) => <span className="font-bold">{r.memberName}</span> },
    { key: "template", header: t("crmPage.template"), render: (r) => r.templateCode ?? "—" },
    { key: "body", header: t("crmPage.body"), render: (r) => <span dir="auto" className="line-clamp-2 block max-w-[280px] text-[12px] text-subtle">{r.body}</span> },
    { key: "phone", header: t("crmPage.phone"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.phone ?? "—"}</span> },
    { key: "status", header: t("crmPage.status"), render: (r) => (
      <Badge variant={statusVariant(r.status)} dot>{t(`crmPage.st_${r.status}`)}</Badge>
    ) },
    ...(true ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: CrmMessageRow) => r.status === "pending" ? (
        <Button size="sm" variant="ghost" onClick={() => {
          api.crm.markManuallySent(r.id).then(() => { toast("success", t("toast.saved")); reload(); }).catch((e) => toast("error", describeError(e, t)));
        }}>{t("crmPage.markManual")}</Button>
      ) : null,
    }] : []),
  ];

  return (
    <Card>
      <CardHeader
        title={t("crmPage.tabQueue")}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void generate()}>
              <RefreshCw className="size-3.5" />{t("crmPage.generateDue")}
            </Button>
            <Button size="sm" loading={busy} onClick={() => void sendPending()}>
              <Send className="size-3.5" />{t("crmPage.sendPending")}
            </Button>
          </div>
        }
      />
      <div className="w-52 border-b border-line px-5 py-3">
        <Select
          label=""
          value={status}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}
          options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))}
        />
      </div>
      {rows.length === 0 ? <EmptyState icon={<Send />} title={t("audit.empty")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
    </Card>
  );
}

// -------------------------------- compose ---------------------------------

function ComposeTab({ onQueued }: { onQueued: () => void }) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [member, setMember] = useState<{ id: string; fullName: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templates, setTemplates] = useState<CrmTemplate[]>([]);
  const [templateCode, setTemplateCode] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!actor) return;
    api.crm.listTemplates().then(setTemplates).catch(console.error);
  }, [actor]);

  const queue = async () => {
    if (!member) {
      toast("error", t("crmPage.composeTo"));
      return;
    }
    setBusy(true);
    try {
      await api.crm.queueMessage({
        memberId: member.id,
        templateCode: templateCode || undefined,
        customBody: customBody.trim() ? customBody : undefined,
      });
      toast("success", t("crmPage.queuedToast"));
      setCustomBody("");
      setTemplateCode("");
      onQueued();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t("crmPage.tabCompose")} />
      <form onSubmit={(e) => { e.preventDefault(); void queue(); }} className="max-w-xl space-y-3.5 p-5">
        <Button variant="secondary" onClick={() => setPickerOpen(true)}>
          {member?.fullName ?? t("pay.pickMemberPh")}
        </Button>
        <Select
          label={t("crmPage.useTemplate")}
          value={templateCode}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setTemplateCode(e.target.value)}
          options={[{ value: "", label: "—" }, ...templates.filter((tp) => tp.isActive).map((tp) => ({ value: tp.code, label: tp.code }))]}
        />
        <textarea
          dir="auto"
          rows={5}
          placeholder={t("crmPage.customBody")}
          value={customBody}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCustomBody(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-neon/60"
        />
        <p className="text-[11px] text-faint">{t("crmPage.templatesHint")}</p>
        <Button type="submit" loading={busy}>{t("crmPage.sendQueue")}</Button>
      </form>
      <MemberPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(m) => { setMember(m); setPickerOpen(false); }} />
    </Card>
  );
}

// ------------------------------- templates --------------------------------

function TemplatesTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<CrmTemplate[]>([]);
  const canEdit = hasPermission("crm.templates");

  const reload = useCallback(() => {
    api.crm.listTemplates().then(setRows).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const columns: Column<CrmTemplate>[] = [
    { key: "code", header: t("crmPage.templateCode"), render: (r) => <span dir="ltr" className="font-bold">{r.code}</span> },
    { key: "body", header: t("crmPage.body"), render: (r) => (
      canEdit ? (
        <textarea
          dir="auto"
          rows={3}
          defaultValue={r.bodyAr}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== r.bodyAr) {
              api.crm.upsertTemplate({ code: r.code, bodyAr: v })
                .then(() => toast("success", t("toast.saved")))
                .catch((err) => toast("error", describeError(err, t)));
            }
          }}
          className="w-full max-w-md rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-neon/60"
        />
      ) : (
        <span dir="auto" className="block max-w-md whitespace-pre-wrap text-[12px] text-subtle">{r.bodyAr}</span>
      )
    ) },
  ];

  return (
    <Card>
      <CardHeader title={t("crmPage.tabTemplates")} />
      <DataTable columns={columns} data={rows} rowKey={(r) => r.code} />
    </Card>
  );
}
