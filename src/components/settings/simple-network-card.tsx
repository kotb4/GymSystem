import { useEffect, useState, useCallback } from "react";
import {
  Wifi,
  Globe,
  Copy,
  ExternalLink,
  ShieldAlert,
  Server,
  Layers,
  Building2,
  RefreshCw,
  Smartphone,
  Check,
  Play,
  Settings2,
  KeyRound,
  Activity,
  Eye,
  EyeOff,
  Trash2,
  Lock,
} from "lucide-react";
import QRCode from "qrcode";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  api,
  type NetworkInfo,
  type TailscaleStatus,
  type SyncStatus,
  type RegisteredBranch,
  type TunnelStatus,
} from "@/api";
import type { BranchConfig, BranchRole } from "@/core/services/sync.service";
import { formatMinor } from "@/core/money";
import { formatTime } from "@/services/format";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { extractTunnelToken } from "@/core/tunnel-token";
import { cn } from "@/utils/cn";

export function SimpleNetworkCard() {
  const t = useT();
  const { user, actor } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [branchConfig, setBranchConfig] = useState<BranchConfig | null>(null);
  const [registeredBranches, setRegisteredBranches] = useState<RegisteredBranch[]>([]);
  const [tunnelUrl, setTunnelUrl] = useState<string>("");
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);

  // Developer Permanent Tunnel state
  const [customDomain, setCustomDomain] = useState<string>("");
  const [tunnelToken, setTunnelToken] = useState<string>("");
  const [savingPermanentTunnel, setSavingPermanentTunnel] = useState(false);
  const [stoppingTunnel, setStoppingTunnel] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);

  const [wifiQrUrl, setWifiQrUrl] = useState<string | null>(null);
  const [remoteQrUrl, setRemoteQrUrl] = useState<string | null>(null);

  const [copiedWifi, setCopiedWifi] = useState(false);
  const [copiedRemote, setCopiedRemote] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [launchingTunnel, setLaunchingTunnel] = useState(false);
  const [refreshingBranches, setRefreshingBranches] = useState(false);
  const [triggeringSync, setTriggeringSync] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Edit Branch Config Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [modalRole, setModalRole] = useState<BranchRole>("primary");
  const [modalName, setModalName] = useState("");
  const [modalPrefix, setModalPrefix] = useState("");
  const [modalRemoteUrl, setModalRemoteUrl] = useState("");
  const [modalSecret, setModalSecret] = useState("");
  const [modalAutoSync, setModalAutoSync] = useState(true);

  const refreshBranches = useCallback(async () => {
    try {
      const branchesList = await api.sync.listBranches().catch(() => []);
      setRegisteredBranches(branchesList || []);
      const syncSt = await api.sync.getStatus().catch(() => null);
      if (syncSt) setSyncStatus(syncSt);
    } catch {
      // ignore
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [net, ts, syncSt, cfg, settings, branchesList, tunSt] = await Promise.all([
        api.system.networkInfo().catch(() => null),
        api.system.tailscaleStatus().catch(() => null),
        api.sync.getStatus().catch(() => null),
        api.sync.getConfig().catch(() => null),
        api.settings.readAll().catch(() => ({} as Record<string, string>)),
        api.sync.listBranches().catch(() => []),
        api.system.tunnelStatus().catch(() => null),
      ]);

      setNetworkInfo(net);
      setTailscaleStatus(ts);
      setSyncStatus(syncSt);
      setBranchConfig(cfg);
      setRegisteredBranches(branchesList || []);
      setTunnelStatus(tunSt);

      const savedTunnel = (settings && settings[SETTING_KEYS.tunnelUrl]) || tunSt?.url || "";
      const savedToken = (settings && settings[SETTING_KEYS.tunnelToken]) || tunSt?.token || "";
      setTunnelUrl(savedTunnel);
      setCustomDomain(savedTunnel);
      setTunnelToken(savedToken);

      // Generate Wi-Fi URL QR
      const port = net?.port || 8890;
      const primaryLocalIp = net?.localAddresses?.[0];
      if (primaryLocalIp) {
        const localUrl = `http://${primaryLocalIp}:${port}`;
        QRCode.toDataURL(localUrl, {
          width: 180,
          margin: 1.5,
          color: { dark: "#090d16", light: "#ffffff" },
        })
          .then(setWifiQrUrl)
          .catch(() => setWifiQrUrl(null));
      }

      // Generate Remote URL QR (Tunnel or Tailscale)
      const effectiveRemote = savedTunnel || (ts?.ip ? `http://${ts.ip}:${port}` : "");
      if (effectiveRemote) {
        QRCode.toDataURL(effectiveRemote, {
          width: 180,
          margin: 1.5,
          color: { dark: "#090d16", light: "#ffffff" },
        })
          .then(setRemoteQrUrl)
          .catch(() => setRemoteQrUrl(null));
      } else {
        setRemoteQrUrl(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => {
      void refreshBranches();
    }, 8_000);
    return () => clearInterval(interval);
  }, [loadData, refreshBranches]);

  const copyToClipboard = async (text: string, onSuccess: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      onSuccess();
    } catch {
      toast("error", t("common.copyFailed"));
    }
  };

  const handleStartTunnel = async (forceRestart = false) => {
    setLaunchingTunnel(true);
    try {
      const res = await api.system.startCloudflareTunnel(forceRestart);
      if (res && res.url) {
        setTunnelUrl(res.url);
        QRCode.toDataURL(res.url, {
          width: 180,
          margin: 1.5,
          color: { dark: "#090d16", light: "#ffffff" },
        })
          .then(setRemoteQrUrl)
          .catch(() => setRemoteQrUrl(null));
        toast("success", t("settings.remoteAccessStartedToast"));
      } else {
        toast("info", t("settings.startingRemoteAccess"));
      }
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLaunchingTunnel(false);
    }
  };

  const handleSavePermanentTunnel = async () => {
    const rawToken = tunnelToken.trim();
    if (!rawToken) {
      toast("error", "يرجى إدخال رمز النفق (Tunnel Token)");
      return;
    }
    const cleanToken = extractTunnelToken(rawToken);
    setSavingPermanentTunnel(true);
    try {
      const res = await api.system.configurePermanentTunnel({
        token: cleanToken,
        url: customDomain.trim() || undefined,
      });
      if (res && res.url) {
        setTunnelUrl(res.url);
      }
      toast("success", t("settings.tunnelConfigSavedToast"));
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingPermanentTunnel(false);
    }
  };

  const handleStopTunnel = async (clearToken = false) => {
    setStoppingTunnel(true);
    try {
      await api.system.stopTunnel(clearToken);
      if (clearToken) {
        setTunnelToken("");
        setCustomDomain("");
        toast("success", t("settings.tunnelResetToast"));
      } else {
        toast("success", t("settings.tunnelStoppedToast"));
      }
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setStoppingTunnel(false);
    }
  };

  const handleTriggerSync = async () => {
    setTriggeringSync(true);
    try {
      const res = await api.sync.triggerSync();
      if (res.ok) {
        toast(
          "success",
          t("sync.cycleSuccessToast", {
            pushed: res.pushedCount,
            pulled: res.pulledCount,
          }),
        );
        await loadData();
      } else {
        toast("error", res.error || t("sync.cycleFailedToast"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setTriggeringSync(false);
    }
  };

  const handleTestConnection = async (targetUrl?: string, targetSecret?: string) => {
    setTestingConnection(true);
    try {
      const res = await api.sync.testConnection({
        remoteUrl: targetUrl || branchConfig?.remoteUrl || undefined,
        syncSecret: targetSecret || branchConfig?.syncSecret || undefined,
      });
      if (res.ok) {
        toast("success", t("sync.testSuccessToast", { ms: res.latencyMs ?? 50 }));
      } else {
        toast("error", t("sync.testFailedToast", { error: res.error || "غير متاح" }));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setTestingConnection(false);
    }
  };

  const openConfigModal = () => {
    if (branchConfig) {
      setModalRole(branchConfig.branchRole);
      setModalName(branchConfig.branchName);
      setModalPrefix(branchConfig.branchPrefix || "");
      setModalRemoteUrl(branchConfig.remoteUrl || "");
      setModalSecret(branchConfig.syncSecret || "");
      setModalAutoSync(branchConfig.autoSyncEnabled);
    }
    setEditModalOpen(true);
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const updated = await api.sync.updateConfig({
        branchRole: modalRole,
        branchName: modalName.trim(),
        branchPrefix: modalPrefix.trim().toUpperCase(),
        remoteUrl: modalRole === "replica" ? modalRemoteUrl.trim() : null,
        syncSecret: modalSecret.trim(),
        autoSyncEnabled: modalAutoSync,
      });
      setBranchConfig(updated);
      setEditModalOpen(false);
      toast("success", t("sync.saveConfigSuccess"));
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingConfig(false);
    }
  };

  const generateRandomSecret = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let res = "gym-sec-";
    for (let i = 0; i < 16; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setModalSecret(res);
  };

  const port = networkInfo?.port || 8890;
  const primaryLocalIp = networkInfo?.localAddresses?.[0];
  const localWifiUrl = primaryLocalIp ? `http://${primaryLocalIp}:${port}` : `http://127.0.0.1:${port}`;

  const effectiveRemoteUrl =
    tunnelUrl || (tailscaleStatus?.ip ? `http://${tailscaleStatus.ip}:${port}` : null);

  const isDeveloper =
    user?.isDeveloper === true ||
    user?.username?.toLowerCase() === "kotb" ||
    (actor as any)?.isDeveloper === true ||
    actor?.username?.toLowerCase() === "kotb";

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-subtle">
        <RefreshCw className="mx-auto mb-2 size-6 animate-spin text-neon" />
        {t("common.loading")}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Developer Redirection Banner */}
      {isDeveloper && (
        <div className="flex flex-col gap-3 rounded-2xl border border-neon/30 bg-neon/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-neon/15 text-neon shrink-0">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-ink">{t("settings.devNetworkBanner")}</p>
              <p className="text-[11px] text-subtle">
                Tailscale Mesh VPN • Cloudflare Tunnels • Multi-Branch Sync Architecture
              </p>
            </div>
          </div>
          <Link to="/developer">
            <Button variant="primary" size="sm" className="gap-2 shrink-0">
              <span>{t("settings.goToDevConsole")}</span>
            </Button>
          </Link>
        </div>
      )}

      {/* 1. Wi-Fi Local Connection Card (QR & Easy Access for Mobile) */}
      <Card className="overflow-hidden">
        <CardHeader
          title={t("settings.wifiAccessTitle")}
          description={t("settings.wifiAccessDesc")}
        />
        <div className="grid gap-6 p-5 md:grid-cols-12 md:items-center">
          {/* QR Code Preview */}
          <div className="flex flex-col items-center justify-center gap-2 md:col-span-4">
            {wifiQrUrl ? (
              <div className="rounded-2xl border border-line bg-white p-2.5 shadow-sm">
                <img
                  src={wifiQrUrl}
                  alt="Wi-Fi QR Code"
                  className="size-36 rounded-lg object-contain"
                />
              </div>
            ) : (
              <div className="grid size-36 place-items-center rounded-2xl border border-line bg-surface text-faint">
                <Smartphone className="size-10" />
              </div>
            )}
            <span className="text-[11px] font-semibold text-subtle">
              امسح الكود بكاميرا الموبايل
            </span>
          </div>

          {/* Connection Link & Details */}
          <div className="space-y-4 md:col-span-8">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-subtle">
                رابط الشبكة المحلية (Wi-Fi):
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  dir="ltr"
                  value={localWifiUrl}
                  className="w-full rounded-xl border border-line bg-base px-3.5 py-2.5 font-mono text-xs text-ink outline-none"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void copyToClipboard(localWifiUrl, () => {
                      setCopiedWifi(true);
                      toast("success", t("common.copied"));
                      setTimeout(() => setCopiedWifi(false), 2000);
                    });
                  }}
                  className="shrink-0 gap-1.5"
                >
                  {copiedWifi ? (
                    <Check className="size-3.5 text-neon" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  <span>{t("common.copy")}</span>
                </Button>
                <a
                  href={localWifiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-subtle transition-colors hover:text-ink"
                  title={t("settings.openUrl")}
                >
                  <ExternalLink className="size-4" />
                </a>
              </div>
            </div>

            {/* Network addresses badge list if multiple IPs exist */}
            {networkInfo && networkInfo.localAddresses.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-faint">العناوين المكتشفة:</span>
                {networkInfo.localAddresses.map((ip) => (
                  <Badge key={ip} variant="neutral" className="font-mono text-[10px]">
                    {ip}
                  </Badge>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-white/5 bg-panel-elevated/40 p-3 text-xs leading-relaxed text-subtle">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                <Wifi className="size-3.5 text-neon" />
                <span>{t("settings.wifiTip")}</span>
              </p>
              <p className="mt-1 text-[11px] text-faint">
                يعمل هذا الرابط على أي هاتف ذكي، تابلت، أو جهاز كمبيوتر آخر طالما أنه متصل بنفس الراوتر أو شبكة الواي فاي الخاصة بالصالة.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Non-developer Protection Notice */}
      {!isDeveloper && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber/20 bg-amber/[0.04] p-4 text-xs text-subtle">
          <ShieldAlert className="size-5 text-amber shrink-0" />
          <p className="font-semibold text-amber">
            {t("settings.devOnlyNetworkNotice")}
          </p>
        </div>
      )}

      {/* 2. Developer Cloudflare Tunnel & Custom Domain Card (Exclusive to Developer) */}
      {isDeveloper && (
        <Card className="border-neon/20 bg-neon/[0.01]">
          <CardHeader
            title={t("settings.tunnelManagementTitle")}
            description={t("settings.tunnelManagementDesc")}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    tunnelStatus?.active
                      ? "success"
                      : "neutral"
                  }
                >
                  {tunnelStatus?.active
                    ? (tunnelStatus.mode === "permanent"
                        ? t("settings.tunnelModePermanent")
                        : t("settings.tunnelModeEphemeral"))
                    : t("settings.tunnelModeStopped")}
                </Badge>
                <Badge variant={tunnelStatus?.installed ? "neutral" : "danger"}>
                  {tunnelStatus?.installed
                    ? t("settings.engineInstalled")
                    : t("settings.engineNotInstalled")}
                </Badge>
              </div>
            }
          />
          <div className="p-5 space-y-5">
            {/* Live Tunnel URL and QR Preview if active */}
            {effectiveRemoteUrl && (
              <div className="grid gap-6 rounded-2xl border border-line bg-surface/40 p-4 md:grid-cols-12 md:items-center">
                <div className="flex flex-col items-center justify-center gap-2 md:col-span-4">
                  {remoteQrUrl ? (
                    <div className="rounded-2xl border border-line bg-white p-2.5 shadow-sm">
                      <img
                        src={remoteQrUrl}
                        alt="Remote Access QR Code"
                        className="size-36 rounded-lg object-contain"
                      />
                    </div>
                  ) : (
                    <div className="grid size-36 place-items-center rounded-2xl border border-line bg-surface text-faint">
                      <Globe className="size-10" />
                    </div>
                  )}
                  <span className="text-[11px] font-semibold text-subtle">
                    الرابط المباشر النشط حالياً
                  </span>
                </div>

                <div className="space-y-3 md:col-span-8">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-subtle">
                      الرابط العام للنظام عبر الإنترنت:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        dir="ltr"
                        value={effectiveRemoteUrl}
                        className="w-full rounded-xl border border-line bg-base px-3.5 py-2.5 font-mono text-xs text-ink outline-none"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void copyToClipboard(effectiveRemoteUrl, () => {
                            setCopiedRemote(true);
                            toast("success", t("common.copied"));
                            setTimeout(() => setCopiedRemote(false), 2000);
                          });
                        }}
                        className="shrink-0 gap-1.5"
                      >
                        {copiedRemote ? (
                          <Check className="size-3.5 text-neon" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        <span>{t("common.copy")}</span>
                      </Button>
                      <a
                        href={effectiveRemoteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-subtle transition-colors hover:text-ink"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-subtle">
                    <span className="text-[11px] text-faint">
                      النوع: {tunnelStatus?.mode === "permanent" ? "دومين ثابت مخصص" : "رابط مؤقت (TryCloudflare)"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={launchingTunnel}
                      onClick={() => void handleStartTunnel(true)}
                      className="gap-1 text-xs text-cyan hover:text-ink h-7"
                    >
                      <RefreshCw className={cn("size-3", launchingTunnel && "animate-spin")} />
                      <span>{t("settings.restartRemoteAccessBtn")}</span>
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Permanent Custom Domain & Token Configuration Form */}
            <div className="space-y-4 rounded-xl border border-line bg-panel-elevated/40 p-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink">
                    {t("settings.tunnelPermanentDomainLabel")}
                  </label>
                  <span className="text-[11px] text-faint font-mono">مثال: https://gym.mybrand.com</span>
                </div>
                <Input
                  dir="ltr"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder={t("settings.tunnelPermanentDomainPh")}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-faint">
                  {t("settings.tunnelPermanentDomainHint")}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink">
                    {t("settings.tunnelTokenLabel")}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTokenInput((v) => !v)}
                    className="flex items-center gap-1 text-[11px] text-subtle hover:text-ink"
                  >
                    {showTokenInput ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    <span>{showTokenInput ? "إخفاء الرمز" : "إظهار الرمز"}</span>
                  </button>
                </div>
                <Input
                  type={showTokenInput ? "text" : "password"}
                  dir="ltr"
                  value={tunnelToken}
                  onChange={(e) => setTunnelToken(e.target.value)}
                  placeholder={t("settings.tunnelTokenPh")}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-faint">
                  {t("settings.tunnelTokenHint")}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line/60">
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingPermanentTunnel}
                  onClick={() => void handleSavePermanentTunnel()}
                  className="gap-1.5 text-xs shadow-sm"
                >
                  <Server className="size-3.5" />
                  <span>{t("settings.saveAndStartPermanentTunnel")}</span>
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  disabled={launchingTunnel}
                  onClick={() => void handleStartTunnel(true)}
                  className="gap-1.5 text-xs"
                >
                  <Play className={cn("size-3.5", launchingTunnel && "animate-spin text-neon")} />
                  <span>{t("settings.startTryCloudflareTunnel")}</span>
                </Button>

                {tunnelStatus?.active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={stoppingTunnel}
                    onClick={() => void handleStopTunnel(false)}
                    className="gap-1.5 text-xs text-amber hover:text-ink"
                  >
                    <RefreshCw className={cn("size-3.5", stoppingTunnel && "animate-spin")} />
                    <span>{t("settings.stopTunnelBtn")}</span>
                  </Button>
                )}

                {tunnelToken && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={stoppingTunnel}
                    onClick={() => void handleStopTunnel(true)}
                    className="gap-1.5 text-xs text-danger hover:text-ink ms-auto"
                  >
                    <Trash2 className="size-3.5" />
                    <span>{t("settings.resetTunnelBtn")}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Quick guide for developer */}
            <div className="rounded-xl border border-white/5 bg-panel p-3.5 text-xs leading-relaxed text-subtle space-y-1">
              <p className="font-bold text-ink">خطوات ربط الدومين الثابت المخصص بنفق Cloudflare:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-faint">
                <li>من لوحة تحكم Cloudflare Zero Trust: توجه إلى <b>Networks</b> ثم <b>Tunnels</b> واضغط <b>Create a tunnel</b>.</li>
                <li>اختر <b>Cloudflared</b> ثم انسخ التوكن أو انسخ أمر التثبيت والصقه كاملاً في الحقل أعلاه.</li>
                <li>في تبويب <b>Public Hostname</b>: أضف الدومين الخاص بك (مثلاً gym.domain.com) واجعله يوجه إلى <b>HTTP</b> و <b>127.0.0.1:8890</b> ثم اضغط حفظ.</li>
              </ol>
            </div>
          </div>
        </Card>
      )}

      {/* 2. Remote Internet Access (Read-only status card for non-developers) */}
      {!isDeveloper && (
        <Card>
          <CardHeader
            title={t("settings.remoteAccessTitle")}
            action={
              <Badge variant={effectiveRemoteUrl ? "success" : "neutral"}>
                {effectiveRemoteUrl
                  ? t("settings.remoteAccessActive")
                  : t("settings.remoteAccessInactive")}
              </Badge>
            }
          />
          <div className="p-5">
            {effectiveRemoteUrl ? (
              <div className="grid gap-6 md:grid-cols-12 md:items-center">
                <div className="flex flex-col items-center justify-center gap-2 md:col-span-4">
                  {remoteQrUrl ? (
                    <div className="rounded-2xl border border-line bg-white p-2.5 shadow-sm">
                      <img
                        src={remoteQrUrl}
                        alt="Remote Access QR Code"
                        className="size-36 rounded-lg object-contain"
                      />
                    </div>
                  ) : (
                    <div className="grid size-36 place-items-center rounded-2xl border border-line bg-surface text-faint">
                      <Globe className="size-10" />
                    </div>
                  )}
                  <span className="text-[11px] font-semibold text-subtle">
                    فتح من خارج الصالة الرياضية
                  </span>
                </div>

                <div className="space-y-4 md:col-span-8">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-subtle">
                      رابط الوصول عن بُعد عبر الإنترنت:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        dir="ltr"
                        value={effectiveRemoteUrl}
                        className="w-full rounded-xl border border-line bg-base px-3.5 py-2.5 font-mono text-xs text-ink outline-none"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void copyToClipboard(effectiveRemoteUrl, () => {
                            setCopiedRemote(true);
                            toast("success", t("common.copied"));
                            setTimeout(() => setCopiedRemote(false), 2000);
                          });
                        }}
                        className="shrink-0 gap-1.5"
                      >
                        {copiedRemote ? (
                          <Check className="size-3.5 text-neon" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        <span>{t("common.copy")}</span>
                      </Button>
                      <a
                        href={effectiveRemoteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-subtle transition-colors hover:text-ink"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    </div>
                  </div>

                  <p className="text-[11px] text-faint">
                    {t("settings.remoteAccessDescActive")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-surface/40 p-6 text-center space-y-2">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-cyan/10 text-cyan">
                  <Globe className="size-6" />
                </div>
                <p className="text-sm font-bold text-ink">{t("settings.remoteAccessInactive")}</p>
                <p className="text-xs text-subtle max-w-md mx-auto">
                  رابط الوصول عن بُعد غير مشغّل حالياً. يرجى التواصل مع مطور النظام لتفعيل الربط السحابي والدومين الخارجي.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 3. Branch Sync Status & Configuration */}
      <Card>
        <CardHeader
          title={t("settings.branchSyncStatusTitle")}
          action={
            <div className="flex items-center gap-2">
              {isDeveloper ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openConfigModal}
                  className="gap-1.5 text-xs"
                >
                  <Settings2 className="size-3.5" />
                  <span>{t("sync.editConfigBtn")}</span>
                </Button>
              ) : (
                <Badge variant="neutral" className="gap-1 text-[11px] text-faint border-line">
                  <Lock className="size-3 text-amber" />
                  <span>إعدادات الفروع مقفولة للمطور</span>
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadData()}
                className="gap-1.5 text-xs text-subtle hover:text-ink"
              >
                <RefreshCw className="size-3.5" />
                <span>{t("sync.refreshBranchesBtn")}</span>
              </Button>
            </div>
          }
        />
        <div className="p-5 space-y-4">
          {/* Main Status Panel */}
          <div className="flex flex-col gap-3 rounded-xl border border-white/5 bg-panel-elevated/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-neon/10 text-neon shrink-0">
                {syncStatus?.branchRole === "primary" ? (
                  <Server className="size-5" />
                ) : (
                  <Layers className="size-5" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-ink">
                    {syncStatus?.branchName || "الفرع الحالي"}
                  </p>
                  <Badge variant={syncStatus?.branchRole === "primary" ? "info" : "neutral"}>
                    {syncStatus?.branchRole === "primary"
                      ? t("sync.primaryBadgeText")
                      : t("sync.replicaBadgeText")}
                  </Badge>
                  {syncStatus?.branchPrefix && (
                    <Badge variant="neutral" className="text-[10px]">
                      {t("sync.branchPrefixBadge", { prefix: syncStatus.branchPrefix })}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-subtle mt-0.5">
                  {syncStatus?.branchRole === "primary"
                    ? t("settings.branchSyncPrimaryStatus")
                    : t("settings.branchSyncReplicaStatus")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {syncStatus?.branchRole === "replica" && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={testingConnection}
                    onClick={() => void handleTestConnection()}
                    className="gap-1.5 text-xs"
                  >
                    <Activity className={cn("size-3.5", testingConnection && "animate-spin text-cyan")} />
                    <span>{t("sync.testConnectionBtn")}</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={triggeringSync}
                    onClick={() => void handleTriggerSync()}
                    className="gap-1.5 text-xs shadow-sm"
                  >
                    <RefreshCw className={cn("size-3.5", triggeringSync && "animate-spin")} />
                    <span>{t("sync.triggerSyncBtn")}</span>
                  </Button>
                </>
              )}
              <Badge variant={syncStatus?.lastError ? "danger" : "success"}>
                {syncStatus?.branchRole === "primary"
                  ? (syncStatus?.lastError ? t("sync.primaryServerOffline") : t("sync.primaryServerActive"))
                  : (syncStatus?.lastError ? t("sync.statusOfflineBadge") : t("sync.statusOnlineBadge"))}
              </Badge>
            </div>
          </div>

          {/* Details / Hub Address bar for Replica */}
          {syncStatus?.branchRole === "replica" && (
            <div className="rounded-xl border border-line bg-base/50 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-subtle">عنوان الخادم الرئيسي (Hub):</span>
                <span className="font-mono text-ink text-xs" dir="ltr">
                  {syncStatus.remoteUrl || "غير محدد — اضغط تعديل لضبط الرابط"}
                </span>
              </div>
              {syncStatus.pendingCount > 0 && (
                <div className="flex items-center justify-between text-amber">
                  <span>العمليات المعلقة بانتظار المزامنة:</span>
                  <span className="font-bold font-mono">{syncStatus.pendingCount} حركة</span>
                </div>
              )}
              {syncStatus.lastPushAt && (
                <div className="flex items-center justify-between text-faint text-[11px]">
                  <span>آخر رفع للبيانات (Push):</span>
                  <span dir="ltr">{syncStatus.lastPushAt.replace("T", " ").slice(0, 19)}</span>
                </div>
              )}
              {syncStatus.lastPullAt && (
                <div className="flex items-center justify-between text-faint text-[11px]">
                  <span>آخر جلب للبيانات (Pull):</span>
                  <span dir="ltr">{syncStatus.lastPullAt.replace("T", " ").slice(0, 19)}</span>
                </div>
              )}
            </div>
          )}

          {/* Sync Secret display (for copying to replica) */}
          {syncStatus?.branchRole === "primary" && branchConfig?.syncSecret && (
            <div className="rounded-xl border border-line bg-base/40 p-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
              <div>
                <p className="font-bold text-ink flex items-center gap-1.5">
                  <KeyRound className="size-3.5 text-neon" />
                  <span>رمز أمان المزامنة (Secret Key) لهذا الفرع الرئيسي:</span>
                </p>
                <p className="text-[11px] text-faint mt-0.5">
                  انسخ هذا الرمز وضعه في إعدادات الفرع الفرعي للربط التلقائي الآمن.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="rounded bg-panel px-2.5 py-1 font-mono text-xs text-neon border border-line" dir="ltr">
                  {branchConfig.syncSecret}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void copyToClipboard(branchConfig.syncSecret, () => {
                      setCopiedSecret(true);
                      toast("success", t("common.copied"));
                      setTimeout(() => setCopiedSecret(false), 2000);
                    });
                  }}
                  className="gap-1 text-xs shrink-0"
                >
                  {copiedSecret ? <Check className="size-3 text-neon" /> : <Copy className="size-3" />}
                  <span>{t("common.copy")}</span>
                </Button>
              </div>
            </div>
          )}

          {/* Connected Replica Branches (Visible on Primary Server) */}
          {syncStatus?.branchRole === "primary" && (
            <div className="pt-2 border-t border-line/60 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-ink flex items-center gap-2">
                    <Building2 className="size-4 text-cyan" />
                    <span>{t("sync.connectedBranchesTitle")}</span>
                  </h4>
                  <p className="text-[11px] text-faint">
                    {t("sync.connectedBranchesSubtitle")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={refreshingBranches}
                  onClick={async () => {
                    setRefreshingBranches(true);
                    await refreshBranches();
                    setTimeout(() => setRefreshingBranches(false), 400);
                  }}
                  className="gap-1.5 text-xs text-subtle hover:text-ink shrink-0 h-7 px-2.5"
                >
                  <RefreshCw className={cn("size-3.5", refreshingBranches && "animate-spin text-cyan")} />
                  <span>{t("common.reload")}</span>
                </Button>
              </div>

              {registeredBranches.filter((b) => b.branchRole === "replica").length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface/30 p-6 text-center space-y-2">
                  <div className="mx-auto grid size-10 place-items-center rounded-xl bg-cyan/10 text-cyan">
                    <Layers className="size-5" />
                  </div>
                  <p className="text-xs font-bold text-ink">{t("sync.noConnectedBranches")}</p>
                  <p className="text-[11px] text-subtle max-w-md mx-auto leading-relaxed">
                    {t("sync.noConnectedBranchesHint")}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {registeredBranches
                    .filter((b) => b.branchRole === "replica")
                    .map((b) => (
                      <div
                        key={b.branchId}
                        className="rounded-xl border border-line bg-base/60 p-4 space-y-3 transition-colors hover:border-line-strong"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-ink text-sm">{b.branchName}</span>
                              {b.branchPrefix && (
                                <Badge variant="neutral" className="text-[10px]">
                                  {t("sync.branchPrefixBadge", { prefix: b.branchPrefix })}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-faint mt-0.5" dir="ltr">
                              {b.branchId}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-block size-2 rounded-full",
                                b.isOnline ? "bg-emerald animate-pulse" : "bg-zinc-500",
                              )}
                            />
                            <span
                              className={cn(
                                "text-[11px] font-bold",
                                b.isOnline ? "text-emerald" : "text-subtle",
                              )}
                            >
                              {b.isOnline ? t("sync.branchActiveNow") : t("sync.branchOffline")}
                            </span>
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 text-center text-xs">
                          <div className="rounded-lg bg-panel p-2 border border-line/60">
                            <p className="text-[10px] text-faint font-semibold">الأعضاء</p>
                            <p className="font-bold text-ink text-sm tabnum">{b.membersCount ?? 0}</p>
                          </div>
                          <div className="rounded-lg bg-panel p-2 border border-line/60">
                            <p className="text-[10px] text-faint font-semibold">الاشتراكات النشطة</p>
                            <p className="font-bold text-neon text-sm tabnum">{b.activeSubscriptionsCount ?? 0}</p>
                          </div>
                          <div className="rounded-lg bg-panel p-2 border border-line/60">
                            <p className="text-[10px] text-faint font-semibold">حضور اليوم</p>
                            <p className="font-bold text-cyan text-sm tabnum">{b.todayAttendanceCount ?? 0}</p>
                          </div>
                          <div className="rounded-lg bg-panel p-2 border border-line/60">
                            <p className="text-[10px] text-faint font-semibold">إجمالي التحصيل</p>
                            <p className="font-bold text-emerald text-sm tabnum">
                              {formatMinor(b.totalPaymentsMinor ?? 0)} ج.م
                            </p>
                          </div>
                        </div>

                        {b.lastSeenAt && (
                          <p className="text-[10px] text-faint pt-1 border-t border-line/40 flex justify-between">
                            <span>{t("sync.lastActivityAt", { time: formatTime(b.lastSeenAt) })}</span>
                            <span dir="ltr">{b.lastSeenAt.slice(0, 10)}</span>
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-faint">
            {t("settings.branchSyncNotice")}
          </p>
        </div>
      </Card>

      {/* Edit Branch Configuration Modal */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={t("sync.modalTitle")}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button
              variant="ghost"
              size="sm"
              disabled={savingConfig}
              onClick={() => setEditModalOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            {modalRole === "replica" && (
              <Button
                variant="secondary"
                size="sm"
                disabled={testingConnection || savingConfig}
                onClick={() => void handleTestConnection(modalRemoteUrl, modalSecret)}
                className="gap-1.5"
              >
                <Activity className={cn("size-3.5", testingConnection && "animate-spin text-cyan")} />
                <span>{t("sync.testConnectionBtn")}</span>
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              loading={savingConfig}
              onClick={() => void handleSaveConfig()}
              className="gap-1.5"
            >
              <Check className="size-3.5" />
              <span>{t("common.save")}</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          {/* Branch Role Selection */}
          <div className="space-y-1.5">
            <label className="font-bold text-ink">{t("sync.branchRoleLabel")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setModalRole("primary")}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border p-3 text-start transition-colors",
                  modalRole === "primary"
                    ? "border-neon bg-neon/[0.08] text-ink font-bold"
                    : "border-line bg-surface/40 text-subtle hover:text-ink",
                )}
              >
                <Server className="size-4 shrink-0 text-neon" />
                <div>
                  <p className="text-xs">{t("sync.rolePrimary")}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setModalRole("replica")}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border p-3 text-start transition-colors",
                  modalRole === "replica"
                    ? "border-cyan bg-cyan/[0.08] text-ink font-bold"
                    : "border-line bg-surface/40 text-subtle hover:text-ink",
                )}
              >
                <Layers className="size-4 shrink-0 text-cyan" />
                <div>
                  <p className="text-xs">{t("sync.roleReplica")}</p>
                </div>
              </button>
            </div>
          </div>

          {/* Branch Name */}
          <div className="space-y-1.5">
            <label className="font-bold text-ink">{t("sync.branchNameLabel")}</label>
            <Input
              value={modalName}
              onChange={(e) => setModalName(e.target.value)}
              placeholder={t("sync.branchNamePh")}
            />
          </div>

          {/* Branch Prefix */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-ink">{t("sync.branchPrefixLabel")}</label>
              <span className="text-[11px] text-faint">{t("sync.branchPrefixHint")}</span>
            </div>
            <Input
              value={modalPrefix}
              onChange={(e) => setModalPrefix(e.target.value.toUpperCase())}
              placeholder="B1 أو B2..."
              maxLength={6}
              className="font-mono uppercase font-bold"
            />
          </div>

          {/* Remote URL (for replica only) */}
          {modalRole === "replica" && (
            <div className="space-y-1.5">
              <label className="font-bold text-ink">{t("sync.remoteUrlLabel")}</label>
              <Input
                value={modalRemoteUrl}
                onChange={(e) => setModalRemoteUrl(e.target.value)}
                placeholder={t("sync.remoteUrlPh")}
                dir="ltr"
                className="font-mono text-xs"
              />
            </div>
          )}

          {/* Sync Secret */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-ink">{t("sync.syncSecretLabel")}</label>
              <button
                type="button"
                onClick={generateRandomSecret}
                className="text-[11px] text-neon hover:underline"
              >
                {t("sync.generateSecretBtn")}
              </button>
            </div>
            <Input
              value={modalSecret}
              onChange={(e) => setModalSecret(e.target.value)}
              placeholder="gym-sec-..."
              dir="ltr"
              className="font-mono text-xs text-neon"
            />
            <p className="text-[11px] text-faint">{t("sync.syncSecretHint")}</p>
          </div>

          {/* Auto-Sync Toggle */}
          <div className="pt-2 border-t border-line">
            <Checkbox
              checked={modalAutoSync}
              onCheckedChange={(checked) => setModalAutoSync(Boolean(checked))}
            >
              <span>{t("sync.autoSyncLabel")}</span>
            </Checkbox>
          </div>
        </div>
      </Modal>
    </div>
  );
}
