import { useState } from "react";
import { KeyRound, Copy, MessageSquare, ShieldCheck, RefreshCw, Wrench, ShieldAlert } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useLicense } from "@/contexts/license-context";
import { api } from "@/api";
import { describeError } from "@/utils/app-error";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";

export function LicenseSettingsCard() {
  const t = useT();
  const { toast } = useToast();
  const { status, refresh } = useLicense();

  // Renew / Activate Modal
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [pastedLic, setPastedLic] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [renewSubmitting, setRenewSubmitting] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);

  // Dev Action Modal
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [devToken, setDevToken] = useState("");
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  const copyHwid = async () => {
    if (!status?.hwid) return;
    try {
      await navigator.clipboard.writeText(status.hwid);
      toast("success", t("license.copied"));
    } catch {
      toast("error", t("errors.unexpected"));
    }
  };

  const openWhatsAppSupport = () => {
    if (!status?.hwid) return;
    const msg = `السلام عليكم، أحتاج تجديد/تفعيل رخصة نظام GymSystem:\nكود الجهاز (HWID): ${status.hwid}`;
    const url = buildWhatsAppDirectUrl("01288536381", msg);
    if (url) window.open(url, "_blank");
  };

  const onFile = (file: File) => {
    setFileName(file.name);
    setRenewError(null);
    const reader = new FileReader();
    reader.onload = () => setPastedLic(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const onRenewActivate = async () => {
    setRenewError(null);
    if (!pastedLic.trim()) {
      setRenewError(t("errors.license.empty"));
      return;
    }
    setRenewSubmitting(true);
    try {
      await api.license.activate(pastedLic.trim());
      toast("success", t("license.statusActiveDesc"));
      setRenewModalOpen(false);
      setPastedLic("");
      setFileName(null);
      refresh();
    } catch (err) {
      setRenewError(describeError(err, t));
    } finally {
      setRenewSubmitting(false);
    }
  };

  const onExecuteDevToken = async () => {
    setDevError(null);
    if (!devToken.trim()) {
      setDevError(t("license.devTokenEmpty"));
      return;
    }
    setDevSubmitting(true);
    try {
      const result = await api.license.executeDeveloperAction(devToken.trim());
      toast("success", t(result.messageKey as never, result.params));
      setDevModalOpen(false);
      setDevToken("");
      refresh();
    } catch (err) {
      setDevError(describeError(err, t));
    } finally {
      setDevSubmitting(false);
    }
  };

  const stateKey = status ? (`license.states.${status.state}` as const) : "license.states.unlicensed";
  const isActive = status?.state === "active";
  const isExpiringSoon = status?.daysRemaining != null && status.daysRemaining <= 30;

  return (
    <>
      <Card>
        <CardHeader
          title={t("license.settingsCardTitle")}
          description={t("license.settingsCardDesc")}
          action={
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                status?.tampered
                  ? "border-red/40 bg-red/10 text-red"
                  : status?.readOnly
                    ? "border-amber/40 bg-amber/10 text-amber"
                    : isActive
                      ? isExpiringSoon
                        ? "border-amber/40 bg-amber/10 text-amber"
                        : "border-emerald/40 bg-emerald/10 text-emerald"
                      : "border-neon/30 bg-neon/10 text-neon"
              }`}
            >
              {status?.tampered ? (
                <ShieldAlert className="size-3" />
              ) : (
                <ShieldCheck className="size-3" />
              )}
              {t(stateKey)}
            </span>
          }
        />

        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-base p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-subtle">{t("license.hwidLabel")}</span>
              <div className="flex items-center gap-2">
                <code dir="ltr" className="font-mono font-bold text-neon text-xs">
                  {status?.hwid ?? "-"}
                </code>
                <Button variant="secondary" size="sm" onClick={() => void copyHwid()}>
                  <Copy className="size-3" />
                  {t("license.btnCopy")}
                </Button>
                <Button variant="secondary" size="sm" onClick={openWhatsAppSupport} title={t("license.whatsappSupport")}>
                  <MessageSquare className="size-3 text-emerald" />
                  <span className="text-[11px]">{t("license.whatsappSupportBtn")}</span>
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-subtle">{t("license.gymLabel")}</span>
              <span className="font-semibold">{status?.gym || "-"}</span>
            </div>

            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-subtle">{t("license.expiresLabel")}</span>
              <span className="font-semibold">
                {status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString("ar-EG") : "-"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-subtle">{t("license.daysRemainingLabel")}</span>
              <span className={`font-bold ${isExpiringSoon ? "text-amber" : "text-emerald"}`}>
                {status?.daysRemaining != null ? `${status.daysRemaining} يوم` : "-"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={() => setRenewModalOpen(true)}>
              <RefreshCw className="size-3.5" />
              {t("license.btnRenew")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDevModalOpen(true)}>
              <Wrench className="size-3.5" />
              {t("license.devActionOpenBtn")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Renew / Activate Modal */}
      <Modal
        open={renewModalOpen}
        onClose={() => setRenewModalOpen(false)}
        title={t("license.renewModalTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRenewModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={renewSubmitting}
              onClick={() => void onRenewActivate()}
            >
              <KeyRound className="size-3.5" />
              {t("license.btnActivate")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 p-2">
          <p className="text-xs leading-relaxed text-subtle">
            {t("license.renewModalDesc")}
          </p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-base px-3 py-4 text-xs font-semibold text-subtle hover:border-neon/50">
            {fileName ?? t("license.filePlaceholder")}
            <input
              type="file"
              accept=".lic,.json,text/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          <textarea
            dir="ltr"
            rows={3}
            disabled={renewSubmitting}
            placeholder='{"payload":"...","signature":"..."}'
            value={pastedLic}
            onChange={(e) => setPastedLic(e.target.value)}
            className="w-full rounded-xl border border-line bg-base px-3 py-2 text-xs font-mono text-ink placeholder:text-faint outline-none transition-colors focus:border-neon/60 focus:ring-2 focus:ring-neon/15 disabled:opacity-50"
          />
          {renewError && (
            <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs font-semibold text-red">
              {renewError}
            </div>
          )}
        </div>
      </Modal>

      {/* Developer Emergency Token Modal */}
      <Modal
        open={devModalOpen}
        onClose={() => setDevModalOpen(false)}
        title={t("license.devActionTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDevModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={devSubmitting}
              onClick={() => void onExecuteDevToken()}
            >
              <KeyRound className="size-3.5" />
              {t("license.devActionExecuteBtn")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 p-2">
          <p className="text-xs leading-relaxed text-subtle">
            {t("license.devActionDesc")}
          </p>
          <textarea
            dir="ltr"
            rows={4}
            disabled={devSubmitting}
            placeholder='{"payload":"{\"type\":\"developer_action\",...}","signature":"..."}'
            value={devToken}
            onChange={(e) => setDevToken(e.target.value)}
            className="w-full rounded-xl border border-line bg-base px-3 py-2 text-xs font-mono text-ink placeholder:text-faint outline-none transition-colors focus:border-neon/60 focus:ring-2 focus:ring-neon/15 disabled:opacity-50"
          />
          {devError && (
            <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs font-semibold text-red">
              {devError}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
