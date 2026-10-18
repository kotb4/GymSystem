import { useEffect, useState, useCallback } from "react";
import { Bot, Download, Loader2, LogOut, MessageSquare, Play, RefreshCw, Save, ShieldCheck, Smartphone } from "lucide-react";
import { useT } from "@/i18n";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type SystemEngineStatus } from "@/api";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WhatsAppPairModal } from "@/components/settings/whatsapp-pair-modal";
import { cn } from "@/utils/cn";

/** Default local gateway URL written when WhatsApp delivery is enabled. */
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8891";

export function WhatsAppSettingsCard() {
  const t = useT();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEditSettings = hasPermission("settings.edit");
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [ownerAlertPhone, setOwnerAlertPhone] = useState("");
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingGateway, setSavingGateway] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [engine, setEngine] = useState<SystemEngineStatus | null>(null);
  const [installingEngine, setInstallingEngine] = useState(false);

  const checkGatewayHealth = useCallback(async () => {
    try {
      const h = await api.gateway.health(gatewayUrl.trim() || DEFAULT_GATEWAY_URL);
      setGatewayRunning(Boolean(h && h.ok));
      setIsPaired(Boolean(h && h.paired));
    } catch {
      setGatewayRunning(false);
      setIsPaired(false);
    }
  }, [gatewayUrl]);

  useEffect(() => {
    if (!canEditSettings) return;
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        setGatewayUrl(all[SETTING_KEYS.whatsappApiUrl] ?? "");
        setOwnerAlertPhone(all[SETTING_KEYS.ownerAlertPhone] ?? "");
        setGatewayEnabled(all[SETTING_KEYS.whatsappEnabled] === "1");
        setBotEnabled((all[SETTING_KEYS.whatsappBotEnabled] ?? "1") === "1");
      })
      .catch(() => {
        /* settings unreadable (permission/offline) — keep the defaults */
      });
    return () => {
      alive = false;
    };
  }, [canEditSettings]);

  useEffect(() => {
    void checkGatewayHealth();
    const timer = setInterval(() => void checkGatewayHealth(), 6000);
    return () => clearInterval(timer);
  }, [checkGatewayHealth]);

  const refreshEngine = useCallback(async () => {
    try {
      setEngine(await api.system.whatsAppEngineStatus());
    } catch {
      /* backend offline — keep the last known state */
    }
  }, []);

  useEffect(() => {
    if (!canEditSettings) return;
    void refreshEngine();
    // Poll while an install is running so the progress bar advances live.
    const interval = setInterval(() => {
      void refreshEngine();
    }, 2500);
    return () => clearInterval(interval);
  }, [canEditSettings, refreshEngine]);

  const handleInstallEngine = async () => {
    if (installingEngine) return;
    setInstallingEngine(true);
    try {
      await api.system.installWhatsAppEngine();
      toast("info", t("settings.whatsappEngineInstalling"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setInstallingEngine(false);
      void refreshEngine();
    }
  };

  /** Start the local gateway on demand (idempotent, or forces restart when requested). */
  const ensureGatewayRunning = async (restart = false) => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await api.system.ensureWhatsAppGateway({ restart });
      if (!res.running) throw new Error("gateway ensure returned running=false");
      toast("success", restart ? t("settings.whatsappRestarting") : t("settings.whatsappRunning"));
      await checkGatewayHealth();
      return true;
    } catch (err) {
      toast("error", describeError(err, t));
      return false;
    } finally {
      setStarting(false);
    }
  };

  /** Run the library then open the pairing modal (QR shows only until first scan). */
  const handlePair = async () => {
    if (await ensureGatewayRunning()) {
      setPairOpen(true);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(t("settings.whatsappDisconnectConfirm"))) return;
    setDisconnecting(true);
    try {
      await api.gateway.disconnect(gatewayUrl.trim() || DEFAULT_GATEWAY_URL);
      toast("success", t("settings.whatsappDisconnectedToast"));
      await checkGatewayHealth();
    } catch {
      try {
        await api.system.disconnectWhatsApp();
        toast("success", t("settings.whatsappDisconnectedToast"));
        await checkGatewayHealth();
      } catch (err) {
        toast("error", describeError(err, t));
      }
    } finally {
      setDisconnecting(false);
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
      if (next) void handlePair();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingGateway(false);
    }
  };

  const toggleBot = async (next: boolean) => {
    if (!canEditSettings || savingGateway) return;
    setSavingGateway(true);
    try {
      await api.settings.update(SETTING_KEYS.whatsappBotEnabled, next ? "1" : "0");
      setBotEnabled(next);
      toast("success", t("settings.savedToast"));
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
      await api.settings.update(SETTING_KEYS.ownerAlertPhone, ownerAlertPhone.trim());
      toast("success", t("settings.savedToast"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingGateway(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <MessageSquare className="size-4 text-emerald" />
            {t("settings.whatsappTitle")}
          </span>
        }
      />
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
          <span>{t("settings.whatsappEnabled")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={gatewayEnabled}
            disabled={savingGateway}
            onClick={() => void toggleGateway(!gatewayEnabled)}
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors",
              !savingGateway && "cursor-pointer",
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
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
          <div className="me-2">
            <span className="flex items-center gap-1.5 font-medium">
              <Bot className="size-4 text-neon" />
              {t("settings.whatsappBotEnabled")}
            </span>
            <p className="mt-0.5 text-[11px] text-faint">
              {t("settings.whatsappBotEnabledHint")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={botEnabled}
            disabled={savingGateway}
            onClick={() => void toggleBot(!botEnabled)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              !savingGateway && "cursor-pointer",
              botEnabled ? "bg-neon/70" : "bg-white/10",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                botEnabled ? "start-0.5" : "start-[22px]",
              )}
            />
          </button>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-400" />
            <p className="text-[13px] font-semibold text-emerald-400">
              {t("settings.whatsappAntiBanSection")}
            </p>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-subtle">
            {t("settings.whatsappAntiBanDesc")}
          </p>
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-line/60 bg-surface/50 p-2">
              <span className="font-semibold text-neon block">{t("settings.whatsappPacingRange")}:</span>
              <span className="text-faint">{t("settings.whatsappPacingRangeHint")}</span>
            </div>
            <div className="rounded-lg border border-line/60 bg-surface/50 p-2">
              <span className="font-semibold text-emerald-400 block">الإرسال متاح 24/7:</span>
              <span className="text-faint">يمكن إرسال الرسائل الفردية والجماعية في أي وقت بأمان</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-faint">
            <span className="rounded bg-line/40 px-2 py-0.5">{t("settings.whatsappHourlyCap")}</span>
            <span className="rounded bg-line/40 px-2 py-0.5">{t("settings.whatsappDailyCap")}</span>
          </div>
        </div>

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

        <div>
          <Input
            label={t("settings.ownerAlertPhone")}
            dir="ltr"
            placeholder="01xxxxxxxxx"
            value={ownerAlertPhone}
            onChange={(e) => setOwnerAlertPhone(e.target.value)}
            disabled={savingGateway}
          />
          <p className="-mt-1 text-[11px] text-faint">{t("settings.ownerAlertPhoneHint")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handlePair()}
            disabled={starting || gatewayUrl.trim() === ""}
          >
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
            {t("settings.whatsappPairButton")}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void ensureGatewayRunning(gatewayRunning)}
            disabled={starting}
          >
            {starting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : gatewayRunning ? (
              <RefreshCw className="size-4 text-emerald" />
            ) : (
              <Play className="size-4 text-neon" />
            )}
            {starting
              ? (gatewayRunning ? t("settings.whatsappRestarting") : t("settings.whatsappStarting"))
              : (gatewayRunning ? t("settings.whatsappRestartButton") : t("settings.whatsappStartButton"))}
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

          {gatewayRunning && isPaired && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="flex items-center gap-1.5"
            >
              {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              {disconnecting ? t("settings.whatsappDisconnecting") : t("settings.whatsappDisconnectButton")}
            </Button>
          )}

          <span className="ms-auto flex items-center gap-1.5 text-xs font-semibold text-subtle">
            <span
              className={cn(
                "size-2 rounded-full",
                gatewayRunning ? "bg-emerald-400 animate-pulse" : "bg-faint",
              )}
            />
            {gatewayRunning ? t("settings.whatsappRunning") : t("settings.whatsappGatewayDown")}
          </span>
        </div>

        <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
          <p className="text-[13px] font-semibold text-subtle">{t("settings.whatsappEngineTitle")}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">{t("settings.whatsappEngineHint")}</p>
          {engine?.installed ? (
            <p className="mt-2 text-[12px] font-semibold text-emerald-400">
              {t("settings.whatsappEngineInstalled", { version: engine.version ?? "—" })}
            </p>
          ) : (
            <p className="mt-2 text-[12px] font-semibold text-amber">
              {t("settings.whatsappEngineNotInstalled")}
            </p>
          )}
          {(engine?.installing || installingEngine) && (
            <p className="mt-1 flex items-center gap-2 text-[12px] text-subtle">
              <Loader2 className="size-4 animate-spin" />
              {t("settings.whatsappEngineInstalling")}
            </p>
          )}
          {engine?.lastError && (
            <p className="mt-1 text-[11px] font-semibold text-red">
              {t("settings.whatsappEngineInstallFailed")}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void handleInstallEngine()}
            disabled={engine?.installing || installingEngine || engine?.installed === true}
          >
            {installingEngine || engine?.installing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {installingEngine || engine?.installing
              ? t("settings.whatsappEngineInstalling")
              : engine?.installed
                ? t("settings.whatsappEngineInstalledBtn")
                : t("settings.whatsappEngineInstall")}
          </Button>
          {engine?.lastError && <p className="mt-1 text-[10px] text-faint" dir="ltr">{engine.engineDir}</p>}
        </div>
      </div>

      <WhatsAppPairModal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        gatewayUrl={gatewayUrl.trim() || DEFAULT_GATEWAY_URL}
        starting={starting}
        onStart={(restart) => void ensureGatewayRunning(Boolean(restart))}
      />
    </Card>
  );
}