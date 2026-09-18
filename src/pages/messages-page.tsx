import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Send, Settings2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type MessageRecipient,
  type MessageSegment,
  type PublicMessageRow,
} from "@/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";

const SEGMENTS: MessageSegment[] = ["absent", "birthday", "expiry"];

const TAB_KEY: Record<MessageSegment, string> = {
  absent: "messages.tabAbsent",
  birthday: "messages.tabBirthday",
  expiry: "messages.tabExpiry",
};

const EMPTY_KEY: Record<MessageSegment, string> = {
  absent: "messages.emptyAbsent",
  birthday: "messages.emptyBirthday",
  expiry: "messages.emptyExpiry",
};

function statusBadge(status: PublicMessageRow["status"]): BadgeVariant {
  switch (status) {
    case "sent":
      return "success";
    case "failed":
      return "danger";
    case "skipped_no_phone":
    case "not_configured":
      return "warning";
    default:
      return "neutral";
  }
}

function statusKey(status: PublicMessageRow["status"]): string {
  switch (status) {
    case "sent":
      return "messages.statusSent";
    case "failed":
      return "messages.statusFailed";
    case "skipped_no_phone":
      return "messages.statusSkippedNoPhone";
    case "not_configured":
      return "messages.statusNotConfigured";
    default:
      return "messages.statusPending";
  }
}

export function MessagesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canSend = hasPermission("messages.send");
  const canEditSettings = hasPermission("settings.edit");

  const [segment, setSegment] = useState<MessageSegment>("absent");
  const [rows, setRows] = useState<MessageRecipient[]>([]);
  const [history, setHistory] = useState<PublicMessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [composeTarget, setComposeTarget] = useState<MessageRecipient | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [batchSending, setBatchSending] = useState(false);

  const [absentDays, setAbsentDays] = useState("14");
  const [birthdayDays, setBirthdayDays] = useState("7");
  const [expiryDays, setExpiryDays] = useState("7");
  const [savingConfig, setSavingConfig] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.messages.getConfig();
      setAbsentDays(String(cfg.absentDays));
      setBirthdayDays(String(cfg.birthdayDays));
      setExpiryDays(String(cfg.expiryDays));
    } catch {
      // config is best-effort; defaults are shown regardless
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRows = useCallback(async (seg: MessageSegment) => {
    try {
      const items = await api.messages.listRecipients(seg);
      setRows(items);
    } catch (error) {
      toast("error", describeError(error, t));
    }
  }, [toast, t]);

  const loadHistory = useCallback(async () => {
    if (!canSend) return;
    try {
      setHistory(await api.messages.listHistory(30));
    } catch {
      // history is informational; silent failure
    }
  }, [canSend]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setRows([]); setLoading(true); void loadRows(segment).finally(() => setLoading(false)); }, [segment, loadRows]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const tabs = SEGMENTS.map((s) => ({ value: s, label: t(TAB_KEY[s]) }));
  const visible = rows;

  const openCompose = (target: MessageRecipient) => {
    setComposeTarget(target);
    setBody("");
  };

  const handleSend = async () => {
    if (!composeTarget) return;
    if (!body.trim()) {
      toast("error", t("errors.messageBodyRequired"));
      return;
    }
    setSending(true);
    try {
      const result = await api.messages.send({
        memberId: composeTarget.memberId,
        segment: composeTarget.segment,
        body,
      });
      if (result.status === "sent") {
        toast("success", t("messages.msgSent"));
      } else if (result.status === "skipped_no_phone") {
        toast("error", t("messages.msgNoPhone"));
      } else if (result.status === "not_configured") {
        toast("error", t("messages.msgNotConfigured"));
      } else {
        toast("error", t("messages.statusFailed"));
      }
      setComposeTarget(null);
      await loadRows(segment);
      await loadHistory();
    } catch (error) {
      toast("error", describeError(error, t));
    } finally {
      setSending(false);
    }
  };

  const handleSendAll = async () => {
    if (!body.trim()) {
      toast("error", t("errors.messageBodyRequired"));
      return;
    }
    setBatchSending(true);
    try {
      const summary = await api.messages.sendSegment({ segment, body });
      toast("success", 
        t("messages.msgBatchSent", {
          sent: summary.sent,
          failed: summary.failed,
          noPhone: summary.skippedNoPhone,
          notConfig: summary.notConfigured,
        }),
      );
      setConfirmSendAll(false);
      setComposeTarget(null);
      await loadRows(segment);
      await loadHistory();
    } catch (error) {
      toast("error", describeError(error, t));
    } finally {
      setBatchSending(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await Promise.all([
        api.settings.update("messages_absent_days", absentDays.trim()),
        api.settings.update("messages_birthday_days", birthdayDays.trim()),
        api.settings.update("messages_expiry_days", expiryDays.trim()),
      ]);
      toast("success", t("messages.configSaved"));
      await loadRows(segment);
    } catch (error) {
      toast("error", describeError(error, t));
    } finally {
      setSavingConfig(false);
    }
  };

  const detailText = (r: MessageRecipient): string => {
    if (r.segment === "absent") {
      return r.lastVisitAt && r.daysSinceLastVisit > 0
        ? t("messages.detailAbsent", { days: r.daysSinceLastVisit })
        : t("messages.detailAbsentNoVisit");
    }
    if (r.segment === "birthday") {
      return r.daysUntilBirthday === 0
        ? t("messages.detailBirthdayToday")
        : t("messages.detailBirthday", { days: r.daysUntilBirthday ?? 0 });
    }
    return t("messages.detailExpiry", { days: r.daysUntilExpiry ?? 0 });
  };

  const cols: Column<MessageRecipient>[] = [
    {
      key: "member",
      header: t("messages.labelMember"),
      render: (r) => (
        <div>
          <span className="font-semibold">{r.memberName}</span>
          <span dir="ltr" className="mt-0.5 block text-xs text-faint tabnum">{r.memberCode}</span>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("messages.labelPhone"),
      render: (r) =>
        r.phone ? <span dir="ltr" className="tabnum text-[13px]">{r.phone}</span> : <span className="text-faint">—</span>,
    },
    {
      key: "detail",
      header: t("messages.labelDetail"),
      render: (r) => <Badge variant="info">{detailText(r)}</Badge>,
    },
    {
      key: "extra",
      header: segment === "absent" ? t("messages.lastNameColumn") : t("messages.labelEndDate"),
      render: (r) =>
        r.segment === "absent" ? (
          <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.lastVisitAt?.slice(0, 16) ?? "—"}</span>
        ) : (
          <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.subscriptionEndKey ?? "—"}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        canSend ? (
          <Button size="sm" variant="secondary" onClick={() => openCompose(r)}>
            <Send className="size-4" />
            {t("messages.btnSend")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs items={tabs} value={segment} onChange={(v) => setSegment(v as MessageSegment)} />
            {canSend && (
              <Button
                variant="ghost"
                onClick={() => {
                  setBody("");
                  setConfirmSendAll(true);
                }}
                disabled={visible.length === 0 || batchSending}
              >
                <Send className="size-4" />
                {t("messages.btnSendAll")}
              </Button>
            )}
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="grid min-h-48 place-items-center">
                <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-neon" />
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<MessageSquare />}
                title={t(EMPTY_KEY[segment])}
                description={t("messages.emptyDescription")}
              />
            ) : (
              <DataTable
                columns={cols}
                data={visible}
                rowKey={(r) => r.memberId}
                className="rounded-xl border border-line bg-surface"
              />
            )}
          </div>
        </CardBody>
      </Card>

      {canEditSettings && (
        <Card>
          <CardHeader title={t("messages.configTitle")} />
          <CardBody>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                label={t("messages.configAbsentDays")}
                value={absentDays}
                onChange={(e) => setAbsentDays(e.target.value)}
                type="number"
                min={1}
                max={365}
                dir="ltr"
              />
              <Input
                label={t("messages.configBirthdayDays")}
                value={birthdayDays}
                onChange={(e) => setBirthdayDays(e.target.value)}
                type="number"
                min={1}
                max={365}
                dir="ltr"
              />
              <Input
                label={t("messages.configExpiryDays")}
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                type="number"
                min={1}
                max={365}
                dir="ltr"
              />
            </div>
            <div className="mt-4 flex items-center gap-2.5">
              <Button onClick={handleSaveConfig} loading={savingConfig} icon={<Settings2 className="size-4" />}>
                {t("messages.configSave")}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {canSend && (
        <Card>
          <CardHeader title={t("messages.historyTitle")} />
          <CardBody>
            {history.length === 0 ? (
              <p className="py-6 text-center text-sm text-subtle">{t("messages.historyEmpty")}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    key: "member",
                    header: t("messages.labelMember"),
                    render: (r) => (
                      <div>
                        <span className="font-semibold">{r.member_name}</span>
                        <span dir="ltr" className="mt-0.5 block text-xs text-faint tabnum">{r.member_code}</span>
                      </div>
                    ),
                  },
                  {
                    key: "body",
                    header: t("messages.composeBodyLabel"),
                    render: (r) => <span className="line-clamp-1 max-w-72 text-[13px] text-subtle">{r.body}</span>,
                  },
                  {
                    key: "status",
                    header: t("messages.colStatus"),
                    render: (r) => <Badge variant={statusBadge(r.status)}>{t(statusKey(r.status))}</Badge>,
                  },
                  {
                    key: "date",
                    header: t("messages.colDate"),
                    render: (r) => <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.created_at}</span>,
                  },
                ]}
                data={history.slice(0, 10)}
                rowKey={(r) => r.id}
                className="rounded-xl border border-line bg-surface"
              />
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={!!composeTarget}
        onClose={() => setComposeTarget(null)}
        title={t("messages.composeTitle")}
        widthClass="max-w-lg"
      >
        {composeTarget && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-ink">{composeTarget.memberName}</p>
            <p dir="ltr" className="tabnum text-xs text-subtle">{composeTarget.phone ?? "—"}</p>
            <label className="mt-4 block text-[13px] font-semibold text-subtle">
              {t("messages.composeBodyLabel")}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("messages.composeBodyPlaceholder")}
              rows={5}
              className="mt-1.5 w-full rounded-xl border bg-panel px-3.5 py-3 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
            />
          </div>
        )}
        <div className="mt-6 flex items-center gap-2.5">
          <Button onClick={handleSend} loading={sending} disabled={sending}>
            <Send className="size-4" />
            {t("messages.btnSend")}
          </Button>
          <Button variant="secondary" onClick={() => setComposeTarget(null)} disabled={sending}>
            {t("common.cancel")}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmSendAll}
        onClose={() => setConfirmSendAll(false)}
        onConfirm={handleSendAll}
        loading={batchSending}
        tone="primary"
        title={t("messages.btnSendAll")}
        message={t("messages.confirmSendAll", { count: visible.length })}
        confirmLabel={t("messages.btnSendAll")}
      />
    </div>
  );
}
