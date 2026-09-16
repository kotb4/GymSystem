import { useEffect, useState, useCallback } from "react";
import { Loader2, LogOut, Play, QrCode, RefreshCw, Save, Smartphone, Wifi, WifiOff } from "lucide-react";
import { useT } from "@/i18n";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WhatsAppPairModal } from "@/components/settings/whatsapp-pair-modal";
import { cn } from "@/utils/cn";
import type { WhatsAppSessionInfo } from "../../../server/whatsapp/types.js";

/** Default local gateway URL written when WhatsApp delivery is enabled. */
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8891";

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
  const { hasPermission } = useAuth();
  // Session actions mirror the RPC gates (server/rpc/whatsapp.rpc.ts); the
  // gateway/send settings mirror the settings gates.
  const canManageSession = hasPermission("whatsapp.manage");
  const canViewSession = hasPermission("whatsapp.view");
  const canEditSettings = hasPermission("settings.edit");
  const [info, setInfo] = useState<WhatsAppSessionInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [savingGateway, setSavingGateway] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

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
    if (!canViewSession) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [canViewSession, refresh]);

  useEffect(() => {
    if (!canEditSettings) return;
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        setGatewayUrl(all[SETTING_KEYS.whatsappApiUrl] ?? "");
        setGatewayEnabled(all[SETTING_KEYS.whatsappEnabled] === "1");
      })
      .catch(() => {
        /* settings unreadable (permission/offline) — keep the defaults */
      });
    return () => {
      alive = false;
    };
  }, [canEditSettings]);

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

  /** Start the local gateway on demand (idempotent; gated by `settings.edit`). */
  const ensureGatewayRunning = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await api.system.ensureWhatsAppGateway();
      if (!res.running) throw new Error("gateway ensure returned running=false");
      toast("success", t("settings.whatsappRunning"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setStarting(false);
    }
  };

  /** Persist the enable flag; first enable also writes the default URL. */
  const toggleGateway = async (next: boolean) => {
    if (!canEditSettings || savingGateway) return;
    const entries: Array<{ key: string; value: string }> = [
      { key: SETTING_KEYS.whatsappEnabled, value: next ? "1" : "0" },
    ];
    const needsDefaultUrl = next && gatewayUrl.trim() === "";
    if (needsDefaultUrl) entries.push({ key: SETTING_KEYS.whatsappApiUrl, value: DEFAULT_GATEWAY_URL });
    setSavingGateway(true);
    try {
      for (const entry of entries) await api.settings.update(entry.key, entry.value);
      setGatewayEnabled(next);
      if (needsDefaultUrl) setGatewayUrl(DEFAULT_GATEWAY_URL);
      toast("success", next ? t("settings.whatsappOn") : t("settings.whatsappOff"));
      if (next) void ensureGatewayRunning();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingGateway(false);
    }
  };

  const saveGatewayUrl = async () => {
    if (!canEditSettings || savingGateway) return;
    setSavingGateway(true);
    try {
      await api.settings.update(SETTING_KEYS.whatsappApiUrl, gatewayUrl.trim());
      toast("success", t("settings.savedToast"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingGateway(false);
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

        {!isReady && info?.lastError && (
          <p className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[12px] font-semibold text-red">
            {t(info.lastError)}
          </p>
        )}

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
          {canManageSession && !isReady && info?.status !== "CONNECTING" && info?.status !== "QR_REQUIRED" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleConnect()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
              {t("whatsapp.connect")}
            </Button>
          )}
          {canManageSession && isReady && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleReconnect()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t("whatsapp.reconnect")}
            </Button>
          )}
          {canManageSession && info?.status !== "DISCONNECTED" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleLogout()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              {t("whatsapp.logout")}
            </Button>
          )}
        </div>

        {canEditSettings && (
          <div className="space-y-3 border-t border-line pt-4">
            <p className="text-[13px] font-semibold text-subtle">{t("settings.whatsappGatewayTitle")}</p>
            <button
              type="button"
              role="switch"
              aria-checked={gatewayEnabled}
              disabled={savingGateway}
              onClick={() => void toggleGateway(!gatewayEnabled)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] font-semibold transition-colors",
                !savingGateway && "hover:border-line-strong",
              )}
            >
              <span>{t("settings.whatsappEnabled")}</span>
              <span
                aria-hidden
                className={cn(
                  "relative h-6 w-11 rounded-full transition-colors",
                  gatewayEnabled ? "bg-neon/70" : "bg-white/10",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                    gatewayEnabled ? "start-0.5" : "start-[22px]",
                  )}
                />
              </span>
            </button>
            <div>
              <Input
                label={t("settings.whatsappApiUrl")}
                dir="ltr"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                disabled={savingGateway}
              />
              <p className="-mt-1 text-[11px] text-faint">{t("settings.whatsappApiUrlHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void ensureGatewayRunning()}
                disabled={starting}
              >
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {starting ? t("settings.whatsappStarting") : t("settings.whatsappStartButton")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={gatewayUrl.trim() === ""}
                onClick={() => setPairOpen(true)}
              >
                <Smartphone className="size-4" />
                {t("settings.whatsappPairButton")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void saveGatewayUrl()}
                disabled={savingGateway || gatewayUrl.trim() === ""}
              >
                {savingGateway ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <WhatsAppPairModal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        gatewayUrl={gatewayUrl.trim() || DEFAULT_GATEWAY_URL}
        starting={starting}
        onStart={() => void ensureGatewayRunning()}
      />
    </Card>
  );
}