import { useEffect, useState, useCallback } from "react";
import {
  Globe,
  Radio,
  Copy,
  ExternalLink,
  RefreshCw,
  Play,
  Check,
  Settings,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/contexts/auth-context";
import { api, type TunnelStatus } from "@/api";
import { cn } from "@/utils/cn";
import { Dropdown } from "@/components/ui/dropdown";

export function TunnelStatusIndicator() {
  const t = useT();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.system.tunnelStatus();
      setStatus(res);
    } catch {
      // Ignore network errors during polling
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const timer = setInterval(() => {
      void fetchStatus();
    }, 10_000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const canManage =
    user?.roleId === "owner" ||
    user?.isDeveloper === true ||
    user?.username?.toLowerCase() === "kotb" ||
    hasPermission("settings.edit");

  const canViewSettings =
    canManage || hasPermission("settings.view");

  const handleStartOrRestart = async () => {
    if (actionLoading) return;
    try {
      setActionLoading(true);
      const res = await api.system.startCloudflareTunnel(true);
      await fetchStatus();
      if (res?.ok) {
        toast("success", t("settings.remoteAccessStartedToast"));
      } else {
        toast("error", t("errors.unexpected"));
      }
    } catch (err: any) {
      toast("error", err?.message || t("errors.unexpected"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopy = (url: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast("success", t("settings.tunnelUrlCopied"));
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!status) return null;

  const isActive = status.active;
  const isConfigured = Boolean(status.hasToken || status.url);
  const effectiveUrl = status.url;

  return (
    <Dropdown
      widthClass="w-[320px]"
      trigger={
        <button
          type="button"
          aria-label={t("settings.tunnelIndicatorTitle")}
          title={
            isActive
              ? `${t("settings.tunnelStatusOnline")}${effectiveUrl ? `: ${effectiveUrl}` : ""}`
              : isConfigured
              ? t("settings.tunnelStatusOffline")
              : t("settings.tunnelStatusNotConfigured")
          }
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition-all",
            isActive
              ? "border-emerald/40 bg-emerald/10 text-emerald hover:bg-emerald/15"
              : isConfigured
              ? "border-amber/40 bg-amber/10 text-amber hover:bg-amber/15 animate-pulse"
              : "border-white/[0.08] bg-panel-elevated/40 text-subtle hover:border-white/20 hover:text-ink",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              isActive
                ? "bg-emerald shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                : isConfigured
                ? "bg-amber shadow-[0_0_6px_rgba(245,158,11,0.8)]"
                : "bg-zinc-500",
            )}
          />
          <Globe className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">
            {isActive
              ? t("settings.tunnelStatusOnline")
              : isConfigured
              ? t("settings.tunnelStatusOffline")
              : t("settings.tunnelStatusNotConfigured")}
          </span>
        </button>
      }
    >
      <div className="p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            <Radio
              className={cn(
                "size-4 shrink-0",
                isActive ? "text-emerald" : isConfigured ? "text-amber" : "text-subtle",
              )}
            />
            <span className="text-xs font-bold text-ink">
              {t("settings.tunnelIndicatorTitle")}
            </span>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold",
              isActive
                ? "bg-emerald/15 text-emerald"
                : isConfigured
                ? "bg-amber/15 text-amber"
                : "bg-white/10 text-subtle",
            )}
          >
            {isActive
              ? t("settings.tunnelStatusOnline")
              : isConfigured
              ? t("settings.tunnelStatusOffline")
              : t("settings.tunnelStatusNotConfigured")}
          </span>
        </div>

        {/* Status description */}
        <div className="space-y-1 text-xs text-subtle">
          <p className="leading-relaxed">
            {isActive
              ? t("settings.tunnelStatusOnlineDesc")
              : isConfigured
              ? t("settings.tunnelStatusOfflineDesc")
              : t("settings.tunnelStatusNotConfiguredDesc")}
          </p>
          {status.mode !== "none" && (
            <p className="text-[11px] text-faint">
              النوع: {status.mode === "permanent" ? t("settings.tunnelModePermanent") : t("settings.tunnelModeEphemeral")}
            </p>
          )}
        </div>

        {/* URL Box if available */}
        {effectiveUrl && (
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-semibold text-subtle">
              {t("settings.tunnelUrlLabel")}:
            </label>
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-base/80 p-1.5">
              <span
                dir="ltr"
                className="flex-1 truncate font-mono text-[11px] text-ink select-all ps-1"
                title={effectiveUrl}
              >
                {effectiveUrl}
              </span>
              <button
                type="button"
                onClick={() => handleCopy(effectiveUrl)}
                title={t("settings.tunnelCopyUrl")}
                className="grid size-7 place-items-center rounded bg-white/5 text-subtle hover:bg-white/10 hover:text-ink transition-colors shrink-0"
              >
                {copied ? <Check className="size-3.5 text-neon" /> : <Copy className="size-3.5" />}
              </button>
              <a
                href={effectiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={t("settings.tunnelOpenUrl")}
                className="grid size-7 place-items-center rounded bg-white/5 text-subtle hover:bg-white/10 hover:text-ink transition-colors shrink-0"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          {canManage && isConfigured && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleStartOrRestart()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-emerald/30 bg-emerald/10 py-1.5 text-xs font-bold text-emerald transition-colors hover:bg-emerald/20 disabled:opacity-50"
            >
              {actionLoading ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : isActive ? (
                <RefreshCw className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              <span>
                {isActive ? t("settings.tunnelRestartNow") : t("settings.tunnelStartNow")}
              </span>
            </button>
          )}

          {canViewSettings && (
            <Link
              to="/settings"
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-faint hover:text-ink transition-colors py-1"
            >
              <Settings className="size-3" />
              <span>إعدادات النفق والشبكة</span>
            </Link>
          )}
        </div>
      </div>
    </Dropdown>
  );
}
