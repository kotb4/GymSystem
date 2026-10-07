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
import { api, type NetworkInfo, type TailscaleStatus, type SyncStatus, type RegisteredBranch } from "@/api";
import { formatMinor } from "@/core/money";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { cn } from "@/utils/cn";

export function SimpleNetworkCard() {
  const t = useT();
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [registeredBranches, setRegisteredBranches] = useState<RegisteredBranch[]>([]);
  const [tunnelUrl, setTunnelUrl] = useState<string>("");

  const [wifiQrUrl, setWifiQrUrl] = useState<string | null>(null);
  const [remoteQrUrl, setRemoteQrUrl] = useState<string | null>(null);

  const [copiedWifi, setCopiedWifi] = useState(false);
  const [copiedRemote, setCopiedRemote] = useState(false);
  const [launchingTunnel, setLaunchingTunnel] = useState(false);
  const [refreshingBranches, setRefreshingBranches] = useState(false);

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
      const [net, ts, syncSt, settings, branchesList] = await Promise.all([
        api.system.networkInfo().catch(() => null),
        api.system.tailscaleStatus().catch(() => null),
        api.sync.getStatus().catch(() => null),
        api.settings.readAll().catch(() => ({} as Record<string, string>)),
        api.sync.listBranches().catch(() => []),
      ]);

      setNetworkInfo(net);
      setTailscaleStatus(ts);
      setSyncStatus(syncSt);
      setRegisteredBranches(branchesList || []);
      const savedTunnel = (settings && settings[SETTING_KEYS.tunnelUrl]) || "";
      setTunnelUrl(savedTunnel);

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
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLaunchingTunnel(false);
    }
  };

  const port = networkInfo?.port || 8890;
  const primaryLocalIp = networkInfo?.localAddresses?.[0];
  const localWifiUrl = primaryLocalIp ? `http://${primaryLocalIp}:${port}` : `http://127.0.0.1:${port}`;

  const effectiveRemoteUrl =
    tunnelUrl || (tailscaleStatus?.ip ? `http://${tailscaleStatus.ip}:${port}` : null);

  const isDeveloper = user?.isDeveloper === true || user?.username?.toLowerCase() === "kotb";

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

      {/* 2. Remote Internet Access (Cloudflare / Tailscale) */}
      <Card>
        <CardHeader
          title={t("settings.remoteAccessTitle")}
          action={
            <div className="flex items-center gap-2">
              <Badge variant={effectiveRemoteUrl ? "success" : "neutral"}>
                {effectiveRemoteUrl
                  ? t("settings.remoteAccessActive")
                  : t("settings.remoteAccessInactive")}
              </Badge>
              {effectiveRemoteUrl && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={launchingTunnel}
                  onClick={() => void handleStartTunnel(true)}
                  className="gap-1.5 text-xs"
                  title={t("settings.restartRemoteAccessBtn")}
                >
                  <RefreshCw className={`size-3.5 ${launchingTunnel ? "animate-spin text-neon" : ""}`} />
                  <span>
                    {launchingTunnel
                      ? t("settings.startingRemoteAccess")
                      : t("settings.restartRemoteAccessBtn")}
                  </span>
                </Button>
              )}
            </div>
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

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan/20 bg-cyan/[0.03] p-3 text-xs text-subtle">
                  <div className="space-y-0.5">
                    <p className="font-bold text-ink">متابعة الصالة الرياضية من أي مكان في العالم</p>
                    <p className="text-[11px] text-faint">
                      {t("settings.remoteAccessDescActive")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={launchingTunnel}
                    onClick={() => void handleStartTunnel(true)}
                    className="gap-1.5 text-xs text-cyan hover:text-ink shrink-0"
                  >
                    <RefreshCw className={`size-3 ${launchingTunnel ? "animate-spin" : ""}`} />
                    <span>{t("settings.restartRemoteAccessBtn")}</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-surface/40 p-8 text-center space-y-4">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-cyan/10 text-cyan">
                <Globe className="size-7" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <p className="text-sm font-bold text-ink">{t("settings.remoteAccessInactive")}</p>
                <p className="text-xs text-subtle leading-relaxed">
                  {t("settings.remoteAccessDescInactive")}
                </p>
              </div>
              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  disabled={launchingTunnel}
                  onClick={() => void handleStartTunnel(false)}
                  className="gap-2 shadow-lg shadow-neon/10"
                >
                  <Play className={`size-4 ${launchingTunnel ? "animate-spin" : ""}`} />
                  <span>
                    {launchingTunnel
                      ? t("settings.startingRemoteAccess")
                      : t("settings.startRemoteAccessBtn")}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 3. Branch Sync Status (Read-Only Status Badge & Connected Branches) */}
      <Card>
        <CardHeader
          title={t("settings.branchSyncStatusTitle")}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadData()}
              className="gap-1.5 text-xs text-subtle hover:text-ink"
            >
              <RefreshCw className="size-3.5" />
              <span>{t("sync.refreshBranchesBtn")}</span>
            </Button>
          }
        />
        <div className="p-5 space-y-4">
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
                  <p className="text-xs font-bold text-ink">
                    {syncStatus?.branchName || "الفرع الحالي"}
                  </p>
                  <Badge variant={syncStatus?.branchRole === "primary" ? "info" : "neutral"}>
                    {syncStatus?.branchRole === "primary" ? t("sync.primaryBadgeText") : t("sync.replicaBadgeText")}
                  </Badge>
                </div>
                <p className="text-[11px] text-subtle mt-0.5">
                  {syncStatus?.branchRole === "primary"
                    ? t("settings.branchSyncPrimaryStatus")
                    : t("settings.branchSyncReplicaStatus")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={syncStatus?.lastError ? "danger" : "success"}>
                {syncStatus?.branchRole === "primary"
                  ? (syncStatus?.lastError ? t("sync.primaryServerOffline") : t("sync.primaryServerActive"))
                  : (syncStatus?.lastError ? t("sync.statusOfflineBadge") : t("sync.statusOnlineBadge"))}
              </Badge>
            </div>
          </div>

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
                            <span>{t("sync.lastActivityAt", { time: b.lastSeenAt.slice(11, 19) })}</span>
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
    </div>
  );
}
