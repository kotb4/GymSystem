import { useEffect, useState } from "react";
import { ExternalLink, Send, Sparkles } from "lucide-react";
import { useT } from "@/i18n";
import { api, type MemberMessageData, type MessagesConfig } from "@/api";
import { buildWhatsAppDirectUrl, fillMessagePlaceholders } from "@/core/whatsapp";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export type QuickTemplateType = "welcome" | "payment" | "expiry" | "absent" | "birthday" | "custom";

interface QuickWhatsAppModalProps {
  open: boolean;
  onClose: () => void;
  memberId: string;
  defaultTemplateType?: QuickTemplateType;
  customData?: {
    amountPaid?: number;
    amountRemaining?: number;
    planName?: string;
    endDate?: string;
  };
}

export function QuickWhatsAppModal({
  open,
  onClose,
  memberId,
  defaultTemplateType = "custom",
  customData,
}: QuickWhatsAppModalProps) {
  const t = useT();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [memberData, setMemberData] = useState<MemberMessageData | null>(null);
  const [config, setConfig] = useState<MessagesConfig | null>(null);
  const [templateType, setTemplateType] = useState<QuickTemplateType>(defaultTemplateType);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open || !memberId) return;
    let alive = true;
    setLoading(true);

    Promise.all([api.messages.getMemberMessageData(memberId), api.messages.getConfig()])
      .then(([mData, mCfg]) => {
        if (!alive) return;
        setMemberData(mData);
        setConfig(mCfg);
        applyTemplate(defaultTemplateType, mData, mCfg);
      })
      .catch((err) => {
        if (!alive) return;
        toast("error", describeError(err, t));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [open, memberId, defaultTemplateType]);

  const applyTemplate = (type: QuickTemplateType, data: MemberMessageData | null, cfg: MessagesConfig | null) => {
    setTemplateType(type);
    if (!data || !cfg || type === "custom") {
      if (type === "custom") setBody("");
      return;
    }

    let tmpl = "";
    switch (type) {
      case "welcome":
        tmpl = cfg.welcomeTemplate;
        break;
      case "payment":
        tmpl = cfg.paymentTemplate;
        break;
      case "expiry":
        tmpl = cfg.expiryTemplate;
        break;
      case "absent":
        tmpl = cfg.absentTemplate;
        break;
      case "birthday":
        tmpl = cfg.birthdayTemplate;
        break;
      default:
        tmpl = "";
    }

    const filled = fillMessagePlaceholders(tmpl, {
      memberName: data.memberName,
      memberCode: data.memberCode,
      gymName: data.gymName,
      planName: customData?.planName ?? data.planName,
      startDate: data.startDate,
      endDate: customData?.endDate ?? data.endDate,
      daysUntilExpiry: data.daysUntilExpiry,
      remainingSessions: data.remainingSessions,
      daysSinceLastVisit: data.daysSinceLastVisit,
      amountPaid: customData?.amountPaid ?? data.latestPaymentPaid ?? 0,
      amountRemaining: customData?.amountRemaining ?? data.latestPaymentRemaining ?? 0,
    });
    setBody(filled);
  };

  const handleTemplateChange = (val: string) => {
    applyTemplate(val as QuickTemplateType, memberData, config);
  };

  const handleSendGateway = async () => {
    if (!memberData) return;
    if (!body.trim()) {
      toast("error", t("errors.messageBodyRequired"));
      return;
    }
    setSending(true);
    try {
      const res = await api.messages.send({
        memberId: memberData.memberId,
        segment: templateType === "custom" ? "custom" : templateType,
        body: body.trim(),
      });
      if (res.status === "sent") {
        toast("success", t("messages.msgSent"));
        onClose();
      } else if (res.status === "skipped_no_phone") {
        toast("error", t("messages.msgNoPhone"));
      } else if (res.status === "not_configured") {
        toast("error", t("messages.msgNotConfigured"));
      } else {
        toast("error", res.error ?? t("messages.statusFailed"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSending(false);
    }
  };

  const handleOpenDirect = () => {
    if (!memberData?.phone) {
      toast("error", t("messages.msgNoPhone"));
      return;
    }
    const url = buildWhatsAppDirectUrl(memberData.phone, body);
    if (!url) {
      toast("error", t("messages.msgNoPhone"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const templateOptions = [
    { value: "custom", label: t("messages.templateCustom") },
    { value: "welcome", label: t("messages.templateWelcome") },
    { value: "payment", label: t("messages.templatePayment") },
    { value: "expiry", label: t("messages.templateExpiry") },
    { value: "absent", label: t("messages.templateAbsent") },
    { value: "birthday", label: t("messages.templateBirthday") },
  ];

  return (
    <Modal open={open} onClose={onClose} title={t("messages.quickWhatsAppTitle")} widthClass="max-w-lg">
      <div className="space-y-4">
        {loading ? (
          <div className="py-8 text-center text-sm text-subtle">{t("common.loading")}</div>
        ) : memberData ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel p-3">
              <div>
                <p className="text-sm font-bold text-ink">{memberData.memberName}</p>
                <p dir="ltr" className="tabnum text-xs text-subtle">
                  {memberData.phone ?? t("messages.msgNoPhone")}
                </p>
              </div>
              {memberData.planName && (
                <div className="text-end text-xs text-subtle">
                  <span className="font-semibold text-ink">{memberData.planName}</span>
                  {memberData.endDate && (
                    <span className="ms-2 tabnum">({memberData.endDate})</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-subtle">
                {t("messages.quickWhatsAppSelectTemplate")}
              </label>
              <Select
                value={templateType}
                onChange={(e) => handleTemplateChange(e.target.value)}
                options={templateOptions}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-subtle">
                <label className="font-semibold">{t("messages.composeBodyLabel")}</label>
                <span className="tabnum text-[11px] text-faint">{body.length} / 2000</span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("messages.composeBodyPlaceholder")}
                rows={5}
                className="w-full rounded-xl border bg-panel px-3.5 py-3 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
              />
              <p className="text-[11px] text-faint flex items-center gap-1">
                <Sparkles className="size-3 text-neon" />
                {t("messages.placeholdersGuide")}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between border-t border-line pt-4">
              <Button variant="ghost" onClick={onClose} disabled={sending}>
                {t("common.cancel")}
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleOpenDirect}
                  disabled={!memberData.phone || sending}
                  icon={<ExternalLink className="size-4" />}
                  title={t("messages.directHint")}
                >
                  {t("messages.btnOpenDirect")}
                </Button>
                <Button
                  type="button"
                  onClick={handleSendGateway}
                  loading={sending}
                  disabled={!memberData.phone}
                  icon={<Send className="size-4" />}
                  title={t("messages.gatewayHint")}
                >
                  {t("messages.btnSendGateway")}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
