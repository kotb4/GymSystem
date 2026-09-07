import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n";
import { api } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Smartphone } from "lucide-react";

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
  onStart?: () => void;
  starting?: boolean;
}) {
  const t = useT();
  const [state, setState] = useState<"down" | "ready" | "paired" | "error">("down");
  const [qr, setQr] = useState<string | null>(null);

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
    } catch {
      // The gateway answered /health but could not serve the QR (e.g. its
      // in-gateway browser failed to launch) — surface that instead of
      // bouncing back to the "gateway down" state.
      setState("error");
      setQr(null);
    }
  }, [gatewayUrl]);

  useEffect(() => {
    if (!open) return;
    setState("down");
    setQr(null);
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
              <Button type="button" variant="secondary" size="sm" onClick={onStart} disabled={starting}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {starting ? t("settings.whatsappStarting") : t("settings.whatsappStartButton")}
              </Button>
            )}
          </div>
        )}

        {state === "error" && (
          <p className="text-center text-[13px] text-danger">{t("settings.whatsappBrowserFailed")}</p>
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