import { useEffect, useState, useCallback } from "react";
import { Loader2, LogOut, QrCode, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import type { WhatsAppSessionInfo } from "../../../server/whatsapp/types.js";

const STATUS_LABELS: Record<string, string> = {
  DISCONNECTED: "whatsapp.disconnected",
  CONNECTING: "whatsapp.connecting",
  QR_REQUIRED: "whatsapp.qrRequired",
  READY: "whatsapp.ready",
  AUTHENTICATED: "whatsapp.authenticated",
  AUTH_FAILURE: "whatsapp.authFailure",
  DISCONNECTED_ERROR: "whatsapp.disconnectedError",
  SENDING: "whatsapp.sending",
  ERROR: "whatsapp.error",
};

const STATUS_COLORS: Record<string, string> = {
  DISCONNECTED: "text-subtle",
  CONNECTING: "text-amber",
  QR_REQUIRED: "text-amber",
  READY: "text-emerald-400",
  AUTHENTICATED: "text-emerald-400",
  AUTH_FAILURE: "text-red-400",
  DISCONNECTED_ERROR: "text-red-400",
  SENDING: "text-amber",
  ERROR: "text-red-400",
};

export function WhatsAppSettingsCard() {
  const t = useT();
  const { toast } = useToast();
  const [info, setInfo] = useState<WhatsAppSessionInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await api.whatsapp.status();
      setInfo(status);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshQr = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.whatsapp.getQr();
      setQr(res.qr);
    } catch {
      setQr(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (info?.status === "QR_REQUIRED") {
      void refreshQr();
    }
  }, [info?.status, refreshQr]);

  const handleConnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.whatsapp.connect();
      await refresh();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleReconnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.whatsapp.reconnect();
      toast("success", t("whatsapp.reconnectSuccess"));
      await refresh();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.whatsapp.logout();
      toast("success", t("whatsapp.logoutSuccess"));
      setQr(null);
      await refresh();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = info ? t(STATUS_LABELS[info.status] ?? "whatsapp.disconnected") : "...";
  const statusColor = info ? STATUS_COLORS[info.status] ?? "text-subtle" : "text-subtle";
  const isReady = info?.status === "READY" || info?.status === "AUTHENTICATED";

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {isReady ? <Wifi className="size-4 text-emerald-400" /> : <WifiOff className="size-4 text-subtle" />}
            {t("settings.whatsappTitle")}
          </span>
        }
      />
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
          <span className="text-[13px] font-semibold">{t("whatsapp.status")}</span>
          <span className={cn("text-[13px] font-semibold", statusColor)}>{statusLabel}</span>
        </div>

        {info?.connectedNumber && (
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
            <span className="text-[13px] font-semibold">{t("whatsapp.connectedNumber")}</span>
            <span className="text-[13px] font-mono text-subtle" dir="ltr">{info.connectedNumber}</span>
          </div>
        )}

        {info?.status === "QR_REQUIRED" && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-4">
            {qr ? (
              <img src={qr} alt={t("whatsapp.qrImageAlt")} className="size-48" />
            ) : (
              <div className="flex size-48 items-center justify-center">
                {loading ? <Loader2 className="size-6 animate-spin" /> : <QrCode className="size-12 text-subtle" />}
              </div>
            )}
            <p className="text-[12px] text-subtle">{t("whatsapp.qrRequired")}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void refreshQr()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t("whatsapp.qrRefresh")}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!isReady && info?.status !== "CONNECTING" && info?.status !== "QR_REQUIRED" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleConnect()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
              {t("whatsapp.connect")}
            </Button>
          )}
          {isReady && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleReconnect()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t("whatsapp.reconnect")}
            </Button>
          )}
          {info?.status !== "DISCONNECTED" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleLogout()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              {t("whatsapp.logout")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}