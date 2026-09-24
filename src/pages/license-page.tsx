import { useEffect, useState } from "react";
import { KeyRound, Copy, FileUp, ShieldAlert, Info, MessageSquare, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api } from "@/api";
import { useLicense } from "@/contexts/license-context";
import { describeError } from "@/utils/app-error";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";

/**
 * Activation + status screen for the offline license. Shown in place of the
 * app when the license is unlicensed / invalid / expired (read-only) / tampered.
 * Displays the HWID and accepts a signed .lic file (or pasted content).
 */
export function LicensePage() {
  const t = useT();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { status, refresh } = useLicense();

  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Developer action modal
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [devToken, setDevToken] = useState("");
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${t("license.title")} — ${t("app.name")}`;
  }, [t]);

  const state = status?.state ?? "unlicensed";
  const needsActivation = status?.needsActivation ?? true;
  const readOnly = status?.readOnly ?? false;
  const tampered = status?.tampered ?? false;

  const copyHwid = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.hwid);
      toast("success", t("license.copied"));
    } catch {
      toast("error", t("errors.unexpected"));
    }
  };

  const openWhatsAppSupport = () => {
    if (!status) return;
    const msg = `السلام عليكم، أحتاج تفعيل كود الجهاز لنظام GymSystem:\nكود الجهاز (HWID): ${status.hwid}`;
    const url = buildWhatsAppDirectUrl("01288536381", msg);
    if (url) window.open(url, "_blank");
  };

  const onFile = (file: File) => {
    setFileName(file.name);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setPasted(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFile(file);
    }
  };

  const onActivate = async () => {
    setError(null);
    if (!pasted.trim()) {
      setError(t("errors.license.empty"));
      return;
    }
    setSubmitting(true);
    try {
      await api.license.activate(pasted.trim());
      toast("success", t("license.statusActiveDesc"));
      refresh();
    } catch (err) {
      const msg = describeError(err, t);
      setError(msg === t("errors.license.blocked") ? t("errors.license.invalid") : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onDeactivate = async () => {
    if (!window.confirm(t("license.confirmDeactivate"))) return;
    setError(null);
    try {
      await api.license.deactivate();
      toast("success", t("license.deactivated"));
      refresh();
    } catch (err) {
      setError(describeError(err, t));
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

  const stateKey = `license.states.${state}` as const;

  return (
    <div className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-base px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 start-1/2 size-[560px] -translate-x-1/2 rounded-full bg-neon/[0.07] blur-[140px]" />
        <div className="absolute -bottom-40 -start-24 size-[420px] rounded-full bg-cyan/[0.05] blur-[130px]" />
      </div>

      <div className="w-full max-w-[540px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-extrabold">{t("license.title")}</h1>
          <p className="mt-1 text-xs text-subtle">{t("license.subtitle")}</p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${
              tampered
                ? "border-red/40 bg-red/10 text-red"
                : readOnly
                  ? "border-amber/40 bg-amber/10 text-amber"
                  : state === "active"
                    ? "border-emerald/40 bg-emerald/10 text-emerald"
                    : "border-neon/30 bg-neon/10 text-neon"
            }`}
          >
            {tampered ? <ShieldAlert className="size-3" /> : <Info className="size-3" />}
            {t(stateKey)}
          </span>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-6 shadow-card">
          {(needsActivation || readOnly || tampered) && (
            <>
              <p className="rounded-xl border border-line bg-base px-3.5 py-2.5 text-[13px] leading-relaxed text-subtle">
                {tampered
                  ? t("license.bannerTampered")
                  : readOnly
                    ? t("license.bannerExpired")
                    : t("license.hwidDesc")}
              </p>

              {status && (
                <div className="mt-4 rounded-xl border border-line bg-base p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-faint">{t("license.hwidLabel")}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code dir="ltr" className="text-sm font-mono font-bold text-neon">
                      {status.hwid}
                    </code>
                    <div className="flex items-center gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => void copyHwid()}>
                        <Copy className="size-3.5" />
                        {t("license.btnCopy")}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={openWhatsAppSupport} title={t("license.whatsappSupport")}>
                        <MessageSquare className="size-3.5 text-emerald" />
                        <span className="text-[11px]">{t("license.whatsappSupportBtn")}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-5 space-y-4">
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-[13px] font-semibold transition-colors ${
                    isDragging
                      ? "border-neon bg-neon/10 text-neon"
                      : "border-line-strong bg-base text-subtle hover:border-neon/50"
                  }`}
                >
                  <FileUp className="size-4 text-neon" />
                  {fileName ?? t("license.filePlaceholder")}
                  <input
                    type="file"
                    accept=".lic,.json,text/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                  />
                </label>
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-semibold text-subtle">{t("license.pasteLabel")}</span>
                  <textarea
                    dir="ltr"
                    rows={3}
                    disabled={submitting}
                    placeholder='{"payload":"...","signature":"..."}'
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm font-mono text-ink placeholder:text-faint outline-none transition-colors focus:border-neon/60 focus:ring-2 focus:ring-neon/15 disabled:opacity-50"
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red"
                >
                  {error}
                </div>
              )}

              <Button
                type="button"
                size="lg"
                fullWidth
                loading={submitting}
                disabled={submitting}
                className="mt-5"
                onClick={() => void onActivate()}
              >
                <KeyRound className="size-4" />
                {submitting ? t("license.activating") : t("license.btnActivate")}
              </Button>
            </>
          )}

          {!needsActivation && !readOnly && !tampered && (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed text-subtle">{t("license.statusActiveDesc")}</p>
              <div className="rounded-xl border border-line bg-base p-4 text-[13px]">
                <Row label={t("license.gymLabel")} value={status?.gym ?? "-"} />
                <Row label={t("license.hwidLabel")} value={status?.hwid ?? "-"} mono />
                <Row label={t("license.expiresLabel")} value={status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString("ar-EG") : "-"} />
                <Row label={t("license.tierLabel")} value={status?.tier ?? "-"} />
              </div>
              <Button variant="secondary" fullWidth onClick={() => void onDeactivate()}>
                {t("license.btnDeactivate")}
              </Button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
            <button
              type="button"
              onClick={() => setDevModalOpen(true)}
              className="flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-neon"
            >
              <Wrench className="size-3" />
              <span>{t("license.devActionOpenBtn")}</span>
            </button>
            {!needsActivation && !readOnly && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/", { replace: true })}>
                {t("license.goBack")}
              </Button>
            )}
          </div>
        </div>
      </div>

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
            className="w-full rounded-xl border border-line bg-base px-3.5 py-2.5 text-xs font-mono text-ink placeholder:text-faint outline-none transition-colors focus:border-neon/60 focus:ring-2 focus:ring-neon/15 disabled:opacity-50"
          />
          {devError && (
            <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs font-semibold text-red">
              {devError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 last:border-0">
      <span className="text-faint">{label}</span>
      <span className={mono ? "font-mono text-neon" : "font-semibold"} dir={mono ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}