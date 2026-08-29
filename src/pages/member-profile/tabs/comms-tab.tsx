import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send, ExternalLink } from "lucide-react";
import { formatDateShort, formatTime } from "@/services/format";
import type { PublicMember } from "@/core/services/members.service";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

interface CrmMessageItem {
  id: string;
  memberId: string;
  templateCode: string;
  channel: string;
  body: string;
  phone: string | null;
  status: string;
  createdAt: string;
  sentAt: string | null;
}

export function CommsTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<CrmMessageItem[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    if (!hasPermission("crm.send")) return;
    let alive = true;
    api.crm
      .listMessages({ memberId: ctx.member.id, limit: 30 } as never)
      .then((rows) => {
        if (!alive) return;
        setItems(rows as CrmMessageItem[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, ctx.member.id, ctx.reloadTick]);

  if (!hasPermission("crm.send")) {
    return permissionDeniedNode(t);
  }

  const phone = (ctx.member as PublicMember & { phone?: string | null }).phone;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("members.commsTitle")}
          action={
            <Button onClick={() => setComposerOpen(true)}>
              <Send className="size-4" />
              {t("members.commsNewMessage")}
            </Button>
          }
        />
        {items.length === 0 ? (
          <EmptyState icon={<MessageCircle />} title={t("members.commsEmpty")} />
        ) : (
          <ul className="divide-y divide-line px-5 pb-4">
            {items.map((m) => (
              <li key={m.id} className="space-y-1.5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="info" dot>{m.templateCode}</Badge>
                  <Badge
                    variant={
                      m.status === "sent" ? "success" : m.status === "pending" ? "warning" : m.status === "failed" ? "danger" : "neutral"
                    }
                  >
                    {m.status}
                  </Badge>
                  <span className="ms-auto text-faint tabnum text-[11px]">
                    {formatDateShort(new Date(m.createdAt))} {formatTime(new Date(m.createdAt))}
                  </span>
                </div>
                <p className="text-subtle text-[12px] leading-relaxed">{m.body}</p>
                {m.phone && (
                  <a
                    href={`https://wa.me/${m.phone.replace(/[^\d+]/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] text-neon hover:underline"
                  >
                    <ExternalLink className="size-3.5" />
                    {t("members.commsOpenWhatsapp")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        member={ctx.member}
        phone={phone ?? null}
        onQueued={() => {
          toast("success", t("crmPage.queuedToast"));
          ctx.reload();
        }}
      />
    </div>
  );
}

function ComposerModal({
  open,
  onClose,
  member,
  phone,
  onQueued,
}: {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  phone: string | null;
  onQueued: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Array<{ code: string; bodyAr: string }>>([]);
  const [templateCode, setTemplateCode] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.crm
      .listTemplates(true)
      .then((rows) => {
        if (!alive) return;
        const typed = rows as Array<{ code: string; bodyAr: string }>;
        setTemplates(typed);
        if (typed[0]) setTemplateCode(typed[0].code);
      })
      .catch(() => undefined);
    setBody("");
    setError(null);
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    const tpl = templates.find((x) => x.code === templateCode);
    if (tpl) setBody(tpl.bodyAr);
  }, [templateCode, templates]);

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.crm.queueMessage({
        memberId: member.id,
        templateCode: templateCode || undefined,
        customBody: body,
        vars: { name: member.fullName },
      } as never);
      toast("success", t("toast.saved"));
      onQueued();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("members.commsNewMessage")} widthClass="max-w-lg">
      <form
        onSubmit={(e) => { e.preventDefault(); void onSubmit(); }}
        noValidate
        className="space-y-3.5"
      >
        <p className="text-[12px] text-faint">{t("members.profileTitle")}: {member.fullName}</p>
        {phone && (
          <p className="text-[12px] text-subtle" dir="ltr">{phone}</p>
        )}
        <Select
          label={t("members.commsTemplate")}
          value={templateCode}
          onChange={(e) => setTemplateCode(e.target.value)}
          options={templates.map((tp) => ({ value: tp.code, label: tp.code }))}
        />
        <Input
          label={t("crmPage.body")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">{error}</p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting} disabled={submitting || !body}>{t("members.commsQueue")}</Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
        </div>
      </form>
    </Modal>
  );
}
