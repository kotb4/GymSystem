import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  DatabaseBackup,
  Download,
  HardDriveDownload,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type DiagnosticsReport, type PublicBackupEntry } from "@/api";
import type { RestoreMetadata } from "@/core/services/backup.service";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable, type Column } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function HealthPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canBackup = hasPermission("backup.create");
  const canRestore = hasPermission("backup.restore");

  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [backups, setBackups] = useState<PublicBackupEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; bytes: Uint8Array; meta: RestoreMetadata | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runDiagnostics = useCallback(() => {
    if (!actor || !hasPermission("diagnostics.view")) return;
    void api.backup
      .diagnostics()
      .then((r) => setReport(r as unknown as DiagnosticsReport))
      .catch(console.error);
    if (hasPermission("settings.view")) {
      api.backup
        .entries()
        .then((entries) => setBackups(entries as PublicBackupEntry[]))
        .catch(console.error);
    }
  }, [actor, hasPermission]);

  useEffect(() => {
    runDiagnostics();
  }, [runDiagnostics]);

  const onCreateBackup = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      const result = await api.backup.createSnapshot("manual");
      toast("success", t("health.backupDone", { name: result.fileName }));
      runDiagnostics();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // light client-side check; full validation happens in the backend
      const header = new TextDecoder("latin1").decode(bytes.slice(0, 16));
      if (bytes.length < 100 || !header.startsWith("SQLite format 3")) {
        toast("error", t("errors.backupInvalidFile"));
        return;
      }
      setPendingFile({ name: file.name, bytes, meta: null });
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const onConfirmRestore = async () => {
    if (!actor || !pendingFile) return;
    setBusy(true);
    try {
      await api.backup.restoreBytes(pendingFile.bytes);
      toast("success", t("health.restoreDone"));
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast("error", describeError(err, t));
      setBusy(false);
    }
  };

  const backupColumns: Column<PublicBackupEntry>[] = [
    {
      key: "file",
      header: t("health.colFile"),
      render: (row) => (
        <span dir="ltr" className="block max-w-[240px] truncate font-bold">
          {row.fileName}
        </span>
      ),
    },
    {
      key: "kind",
      header: t("health.colKind"),
      render: (row) => <Badge variant={row.kind === "manual" ? "info" : "neutral"}>{t(`health.kind_${row.kind}`)}</Badge>,
    },
    {
      key: "size",
      header: t("health.colSize"),
      render: (row) => <span className="tabnum text-subtle">{formatBytes(row.sizeBytes)}</span>,
    },
    {
      key: "verified",
      header: t("health.colVerified"),
      render: (row) => (
        <Badge variant={row.verified ? "success" : "warning"} dot>
          {row.verified ? t("scanner.valid") : t("status.pending")}
        </Badge>
      ),
    },
  ];

  const healthy = report?.integrity.toLowerCase() === "ok";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-subtle">{t("health.subtitle")}</h2>
        <Button variant="secondary" size="sm" onClick={runDiagnostics}>
          <RefreshCw className="size-4" />
          {t("health.rerun")}
        </Button>
      </div>

      {report && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title={t("health.integrity")}
            value={healthy ? t("health.integrityOk") : String(report.integrity)}
            icon={<ShieldCheck />}
            accent={healthy ? "neon" : "red"}
            subtitle={t("health.integrityHint")}
          />
          <StatCard
            title={t("health.dbSize")}
            value={report.dbSizeBytes > 0 ? formatBytes(report.dbSizeBytes) : "—"}
            icon={<DatabaseBackup />}
            accent="cyan"
            subtitle={t("health.dbSizeHint")}
          />
          <StatCard
            title={t("health.membersCount")}
            value={String(report.memberCount)}
            icon={<Activity />}
            accent="violet"
            subtitle={`${report.attendanceCount} ${t("health.checkins")}`}
          />
          <StatCard
            title={t("health.lastBackup")}
            value={report.lastBackupAt ? report.lastBackupAt.slice(0, 16) : t("health.never")}
            icon={<HardDriveDownload />}
            accent="amber"
            subtitle={`${t("health.autoHours")} ${report.autoBackupHours}`}
          />
        </div>
      )}

      {backups.length > 0 && hasPermission("settings.view") && (
        <Card>
          <CardHeader title={t("health.backupsTitle")} />
          <DataTable columns={backupColumns} data={backups} rowKey={(r) => String(r.id)} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("health.backupCardTitle")} description={t("health.backupCardDesc")} />
          <div className="space-y-3 p-5">
            <p className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12px] leading-relaxed text-subtle">
              {t("health.backupNote")}
            </p>
            <Button onClick={() => void onCreateBackup()} loading={busy} disabled={!canBackup || busy}>
              <Download className="size-4" />
              {canBackup ? t("health.backupNow") : t("health.noPermission")}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("health.restoreCardTitle")} description={t("health.restoreCardDesc")} />
          <div className="space-y-3 p-5">
            <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-amber">
              {t("health.restoreWarning")}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gymbak,.sqlite,.db,.sqlite3"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onPickFile(file);
              }}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canRestore || busy}
            >
              <Upload className="size-4" />
              {canRestore ? t("health.restorePick") : t("health.noPermission")}
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingFile !== null}
        onClose={() => setPendingFile(null)}
        onConfirm={() => void onConfirmRestore()}
        title={t("health.confirmTitle")}
        message={t("health.confirmMessage", {
          name: pendingFile?.name ?? "",
          members: pendingFile?.meta?.members ?? "—",
        })}
        confirmLabel={t("health.confirmRestore")}
        loading={busy}
        tone="danger"
      />

      {!report && (
        <p className="p-6 text-center text-sm text-faint">{t("common.loading")}</p>
      )}
    </div>
  );
}
