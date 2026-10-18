import { useEffect, useState } from "react";
import {
  Cloud,
  CloudCheck,
  RefreshCw,
  Server,
  WifiOff,
  Building2,
} from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { api, type SyncStatus, type RegisteredBranch } from "@/api";
import { cn } from "@/utils/cn";
import { formatTime } from "@/services/format";
import { Dropdown } from "@/components/ui/dropdown";

export function SyncStatusIndicator() {
  const t = useT();
  const { toast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [branches, setBranches] = useState<RegisteredBranch[]>([]);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = async () => {
    try {
      const st = await api.sync.getStatus();
      setStatus(st);
      if (st?.branchRole === "primary") {
        const bl = await api.sync.listBranches().catch(() => []);
        setBranches(bl);
      }
    } catch {
      // Offline or network error
    }
  };

  useEffect(() => {
    void fetchStatus();
    const timer = setInterval(() => {
      void fetchStatus();
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const handleManualSync = async () => {
    if (syncing) return;
    try {
      setSyncing(true);
      const res = await api.sync.triggerSync();
      await fetchStatus();
      if (res.ok) {
        toast(
          "success",
          t("sync.cycleSuccessToast", {
            pushed: res.pushedCount,
            pulled: res.pulledCount,
          }),
        );
      } else {
        toast("error", res.error || t("sync.cycleFailedToast"));
      }
    } catch {
      toast("error", t("sync.cycleFailedToast"));
    } finally {
      setSyncing(false);
    }
  };

  if (!status) return null;

  const isPrimary = status.branchRole === "primary";
  const isOffline = status.state === "offline" || !!status.lastError;
  const hasPending = status.pendingCount > 0;
  const replicaBranches = branches.filter((b) => b.branchRole === "replica");
  const onlineReplicasCount = replicaBranches.filter((b) => b.isOnline).length;

  return (
    <Dropdown
      widthClass="w-[310px]"
      trigger={
        <button
          type="button"
          aria-label={t("sync.cardTitle")}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition-all",
            isPrimary
              ? "border-white/[0.08] bg-panel-elevated/60 text-subtle hover:border-white/20 hover:text-ink"
              : syncing
              ? "border-neon/40 bg-neon/10 text-neon"
              : isOffline
              ? "border-amber/40 bg-amber/10 text-amber animate-pulse"
              : "border-neon/30 bg-neon/5 text-neon hover:bg-neon/10",
          )}
        >
          {isPrimary ? (
            <>
              <Server className="size-3.5 text-cyan" />
              <span className="hidden sm:inline">{status.branchName}</span>
              {replicaBranches.length > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono font-bold",
                    onlineReplicasCount > 0
                      ? "bg-cyan/15 text-cyan"
                      : "bg-white/10 text-subtle",
                  )}
                >
                  {onlineReplicasCount}/{replicaBranches.length}
                </span>
              )}
            </>
          ) : syncing ? (
            <>
              <RefreshCw className="size-3.5 animate-spin text-neon" />
              <span className="hidden sm:inline">{t("sync.syncing")}</span>
            </>
          ) : isOffline ? (
            <>
              <WifiOff className="size-3.5 text-amber" />
              <span className="hidden sm:inline">{t("sync.offlineShort")}</span>
              {hasPending && (
                <span className="rounded-full bg-amber/20 px-1.5 py-0.2 text-[10px] text-amber font-mono">
                  {status.pendingCount}
                </span>
              )}
            </>
          ) : (
            <>
              <CloudCheck className="size-3.5 text-neon" />
              <span className="hidden sm:inline">{t("sync.syncedShort")}</span>
              {hasPending && (
                <span className="rounded-full bg-neon/20 px-1.5 py-0.2 text-[10px] text-neon font-mono">
                  {status.pendingCount}
                </span>
              )}
            </>
          )}
        </button>
      }
    >
      <div className="p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            {isPrimary ? (
              <Server className="size-4 text-cyan" />
            ) : isOffline ? (
              <WifiOff className="size-4 text-amber" />
            ) : (
              <Cloud className="size-4 text-neon" />
            )}
            <span className="text-xs font-bold text-ink">{status.branchName}</span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-faint">
            {isPrimary ? t("sync.rolePrimaryBadge") : t("sync.roleReplicaBadge")}
          </span>
        </div>

        <div className="space-y-1.5 text-xs text-subtle">
          <div className="flex justify-between">
            <span>{t("sync.pendingOperations")}:</span>
            <span className="font-bold text-ink tabnum">{status.pendingCount}</span>
          </div>

          {!isPrimary && (
            <>
              <div className="flex justify-between">
                <span>{t("sync.connectionStatus")}:</span>
                <span className={cn("font-bold", isOffline ? "text-amber" : "text-neon")}>
                  {isOffline ? t("sync.statusOfflineBadge") : t("sync.statusOnlineBadge")}
                </span>
              </div>

              {status.lastPullAt && (
                <div className="text-[11px] text-faint pt-1">
                  <span>{t("sync.lastSyncedAt")}: </span>
                  <span className="tabnum">{formatTime(status.lastPullAt)}</span>
                </div>
              )}

              {status.lastError && (
                <p className="text-[11px] text-amber leading-tight pt-1">
                  {status.lastError}
                </p>
              )}
            </>
          )}
        </div>

        {/* Primary Server View: List of connected replica branches */}
        {isPrimary && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between text-[11px] text-faint">
              <span className="font-semibold flex items-center gap-1.5">
                <Building2 className="size-3.5 text-cyan" />
                <span>{t("sync.connectedBranchesCount", { count: replicaBranches.length })}</span>
              </span>
              <span className="text-[10px] text-emerald font-bold">
                {onlineReplicasCount} متصل الآن
              </span>
            </div>
            {replicaBranches.length === 0 ? (
              <p className="text-[11px] text-faint py-1 leading-relaxed">
                {t("sync.noConnectedBranches")}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {replicaBranches.map((b) => (
                  <div
                    key={b.branchId}
                    className="flex items-center justify-between p-2 rounded-lg bg-base/60 border border-white/5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-1.5 rounded-full shrink-0",
                            b.isOnline ? "bg-emerald animate-pulse" : "bg-zinc-500",
                          )}
                        />
                        <span className="font-bold text-ink text-[12px]">{b.branchName}</span>
                      </div>
                      <p className="text-[10px] text-faint">
                        {t("sync.branchMembersCount", { count: b.membersCount ?? 0 })}
                      </p>
                    </div>
                    <div className="text-end">
                      <span
                        className={cn(
                          "text-[10px] font-bold block",
                          b.isOnline ? "text-emerald" : "text-subtle",
                        )}
                      >
                        {b.isOnline ? "متصل" : "أوفلاين"}
                      </span>
                      {b.lastSeenAt && (
                        <span className="text-[9px] text-faint">
                          {formatTime(b.lastSeenAt)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isPrimary && (
          <button
            type="button"
            onClick={() => void handleManualSync()}
            disabled={syncing || !status.remoteUrl}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-neon/30 bg-neon/10 py-1.5 text-xs font-bold text-neon transition-colors hover:bg-neon/20 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
            {syncing ? t("sync.syncing") : t("sync.triggerSyncBtn")}
          </button>
        )}
      </div>
    </Dropdown>
  );
}
