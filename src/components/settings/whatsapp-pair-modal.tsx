import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n";
import { api } from "@/api";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, LogOut, Play, RefreshCw, Smartphone } from "lucide-react";

/**
 * One-time WhatsApp Web pairing inside the app. Polls the local gateway,
 * shows the live QR until the phone scans it; session then persists on disk.
 * If the gateway is down, offers to start it on demand.
 */
export function WhatsAppPairModal({
  open,
  onClose,
  gatewayUrl,
  onStart,
  starting,
}: {
  open: boolean;
  onClose: () => void;
  gatewayUrl: string;
  onStart?: (restart?: boolean) => void | Promise<void | boolean>;
  starting?: boolean;
}) {
  const t = useT();
  const { toast } = useToast();
  const [state, setState] = useState<"down" | "ready" | "paired" | "error">("down");
  const [qr, setQr] = useState<string | null>(null);
  const [engineMissing, setEngineMissing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (!window.confirm(t("settings.whatsappDisconnectConfirm"))) return;
    setDisconnecting(true);
    try {
      await api.gateway.disconnect(gatewayUrl);
      toast("success", t("settings.whatsappDisconnectedToast"));
      setState("ready");
      void tick();
    } catch {
      try {
        await api.system.disconnectWhatsApp();
        toast("success", t("settings.whatsappDisconnectedToast"));
        setState("ready");
        void tick();
      } catch (err) {
        toast("error", err instanceof Error ? err.message : "فشل إلغاء ربط الحساب");
      }
    } finally {
      setDisconnecting(false);
    }
  };

  const tick = useCallback(async () => {
    try {
      const health = await api.gateway.health(gatewayUrl);
      if (!health.ok) {
        setState("down");
        return setQr(null);
      }
      if (health.paired) {
        setState("paired");
        return setQr(null);
      }
    } catch {
      setState("down");
      return setQr(null);
    }
    try {
      const pair = await api.gateway.pair(gatewayUrl);
      if (!pair.paired) {
        setState("ready");
        setQr(pair.qrPngBase64 ?? null);
      } else {
        setState("paired");
        setQr(null);
      }
    } catch (err) {
      // The gateway answered /health but could not serve the QR (its in-gateway
      // browser failed to launch, or the wppconnect engine is not installed
      // yet) — surface that instead of bouncing back to "gateway down".
      const msg = err instanceof Error ? err.message : "";
      setEngineMissing(/engine not installed/i.test(msg));
      setState("error");
      setQr(null);
    }
  }, [gatewayUrl]);

  useEffect(() => {
    if (!open) return;
    setState("down");
    setQr(null);
    setEngineMissing(false);
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    return () => clearInterval(timer);
  }, [open, tick]);

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title={t("settings.whatsappPairTitle")} widthClass="max-w-sm">
      <div className="space-y-4">
        {state === "paired" && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Badge variant="success">{t("settings.whatsappPairedDesc")}</Badge>
            <p className="text-[13px] text-subtle">{t("settings.whatsappPairedNote")}</p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="mt-2 flex items-center gap-1.5"
            >
              {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              <span>{disconnecting ? t("settings.whatsappDisconnecting") : t("settings.whatsappDisconnectButton")}</span>
            </Button>
          </div>
        )}

        {state === "ready" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-subtle">
              <Loader2 className="size-4 animate-spin" />
              {t("settings.whatsappPairWaiting")}
            </div>
            {qr ? (
              <img
                src={`data:image/png;base64,${qr}`}
                alt={t("settings.whatsappPairTitle")}
                className="size-56 rounded-xl border border-line bg-white p-2"
              />
            ) : (
              <p className="text-[12px] text-faint">{t("settings.whatsappPairNoQr")}</p>
            )}
            <ol className="text-start text-[12px] leading-relaxed text-subtle">
              <li>1. {t("settings.whatsappPairStep1")}</li>
              <li>2. {t("settings.whatsappPairStep2")}</li>
              <li>3. {t("settings.whatsappPairStep3")}</li>
            </ol>
          </div>
        )}

        {state === "down" && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Smartphone className="size-8 text-faint" />
            <p className="text-[13px] leading-relaxed text-subtle">{t("settings.whatsappGatewayDown")}</p>
            {onStart && (
              <Button type="button" variant="secondary" size="sm" onClick={() => onStart(false)} disabled={starting}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {starting ? t("settings.whatsappStarting") : t("settings.whatsappStartButton")}
              </Button>
            )}
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <p className="text-center text-[13px] font-semibold text-danger">
              {engineMissing
                ? t("settings.whatsappEngineNotInstalled")
                : t("settings.whatsappBrowserFailed")}
            </p>
            <p className="text-[12px] leading-relaxed text-subtle">
              تأكد من وجود متصفح Google Chrome أو Microsoft Edge على الجهاز. سيقوم النظام بفك أقفال المتصفح وإعادة المحاولة تلقائياً.
            </p>
            {onStart && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={async () => {
                  await onStart(true);
                  void tick();
                }}
                disabled={starting}
              >
                {starting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {starting ? t("settings.whatsappRestarting") : t("settings.whatsappRestartButton")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </Modal>
  );
}