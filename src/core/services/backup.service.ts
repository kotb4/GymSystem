import { nowStamp } from "@/core/dates";
import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getBackupConfig, readAllSettings, SETTING_KEYS } from "./settings.service";

export const BACKUP_FILE_EXTENSION = ".gymbak";
const SQLITE_HEADER = "SQLite format 3\0";

export type BackupKind = "manual" | "auto" | "pre_restore";

export interface BackupLogRow extends Row {
  id: number;
  kind: BackupKind;
  file_name: string;
  size_bytes: number;
  checksum: string | null;
  verified: number;
  created_by: string | null;
  created_at: string;
}

export interface PublicBackupEntry {
  id: number;
  kind: BackupKind;
  fileName: string;
  sizeBytes: number;
  checksum: string | null;
  verified: boolean;
  createdAt: string;
}

function toEntry(row: BackupLogRow): PublicBackupEntry {
  return {
    id: Number(row.id),
    kind: row.kind,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    verified: row.verified === 1,
    createdAt: row.created_at,
  };
}

export function listBackupEntries(db: Db, actor: ServiceActor, limit = 30): PublicBackupEntry[] {
  requirePermission(actor, "settings.view");
  return db
    .all<BackupLogRow>(
      "SELECT * FROM backups_log ORDER BY id DESC LIMIT ?",
      [Math.min(200, Math.max(1, limit))],
    )
    .map(toEntry);
}

export function getLatestVerifiedBackup(
  db: Db,
): Pick<PublicBackupEntry, "fileName" | "createdAt"> | null {
  const row = db.first<BackupLogRow>(
    "SELECT * FROM backups_log WHERE verified = 1 ORDER BY id DESC LIMIT 1",
  );
  if (!row) return null;
  return { fileName: row.file_name, createdAt: row.created_at };
}

/** FNV-1a checksum over backup bytes — deterministic and dependency-free. */
export function computeChecksum(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, "0")}`;
}

export function buildBackupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `gympro-backup-${stamp}${BACKUP_FILE_EXTENSION}`;
}

export async function recordBackupEntry(
  db: Db,
  actor: ServiceActor,
  input: { kind: BackupKind; fileName: string; sizeBytes: number; checksum: string; verified: boolean },
): Promise<PublicBackupEntry> {
  await db.transaction(async () => {
    const systemless =
      actor.userId === "legacy-import" ? { ...actor, userId: null } : actor;
    db.run(
      "INSERT INTO backups_log (kind, file_name, size_bytes, checksum, verified, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.kind, input.fileName, input.sizeBytes, input.checksum, input.verified ? 1 : 0, systemless.userId, nowStamp()],
    );
    recordAudit(db, systemless, "BACKUP_CREATED", "backup", input.fileName, {
      kind: input.kind,
      sizeBytes: input.sizeBytes,
      verified: input.verified,
    });
  });
  const row = db.first<BackupLogRow>(
    "SELECT * FROM backups_log WHERE file_name = ? ORDER BY id DESC LIMIT 1",
    [input.fileName],
  );
  return toEntry(row!);
}

/** Removes oldest log entries beyond retention; returns their file names for blob cleanup. */
export function pruneBackups(db: Db, retentionCount: number): string[] {
  const stale = db.all<{ file_name: string }>(
    "SELECT file_name FROM backups_log WHERE id NOT IN (\n  SELECT id FROM backups_log ORDER BY id DESC LIMIT ?\n)",
    [Math.max(1, Math.min(50, retentionCount))],
  );
  if (stale.length === 0) return [];
  const names = stale.map((row) => row.file_name);
  const placeholders = names.map(() => "?").join(", ");
  db.run(`DELETE FROM backups_log WHERE file_name IN (${placeholders})`, names);
  return [...new Set(names)];
}

export async function pruneBackupsForActor(
  db: Db,
  actor: ServiceActor,
): Promise<string[]> {
  requirePermission(actor, "settings.view");
  const config = getBackupConfig(db, actor);
  const removed = pruneBackups(db, config.retentionCount);
  for (const name of removed) {
    recordAudit(db, actor, "BACKUP_DELETED", "backup", name, { reason: "retention" });
  }
  return removed;
}

export interface RestoreMetadata {
  migrationVersion: number;
  users: number;
  members: number;
  settings: number;
}

export type OpenFromBytes = (bytes: Uint8Array) => PromiseLike<{
  scalar(sql: string, params?: ReadonlyArray<string | number | bigint | Uint8Array | null>): unknown;
  close(): void;
}>;

/**
 * Validates a candidate database file before restore:
 * header magic, integrity_check, and presence of required tables.
 */
export async function validateRestoreFile(
  bytes: Uint8Array,
  openFromBytes: OpenFromBytes,
): Promise<RestoreMetadata> {
  if (bytes.length < 100 || bytes[0] === 0) {
    throw errValidation("errors.backupInvalidFile");
  }
  const header = String.fromCharCode(...bytes.slice(0, 16));
  if (header !== SQLITE_HEADER) {
    throw errValidation("errors.backupInvalidFile");
  }

  const probe = await openFromBytes(bytes);
  try {
    let integrity: unknown;
    try {
      integrity = probe.scalar("PRAGMA integrity_check");
    } catch {
      throw errValidation("errors.backupIntegrityFailed", { result: "threw" });
    }
    if (String(integrity).toLowerCase() !== "ok") {
      throw errValidation("errors.backupIntegrityFailed", { result: String(integrity) });
    }
    const required = ["users", "members", "cards", "member_subscriptions", "settings", "schema_migrations"];
    for (const table of required) {
      const exists = probe.scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      if (!exists) throw errValidation("errors.backupMissingTables", { table });
    }
    return {
      migrationVersion: Number(probe.scalar("SELECT COALESCE(MAX(version), 0) FROM schema_migrations") ?? 0),
      users: Number(probe.scalar("SELECT COUNT(*) FROM users") ?? 0),
      members: Number(probe.scalar("SELECT COUNT(*) FROM members") ?? 0),
      settings: Number(probe.scalar("SELECT COUNT(*) FROM settings") ?? 0),
    };
  } finally {
    probe.close();
  }
}

export interface DiagnosticsReport {
  gymName: string;
  currencySymbol: string;
  integrity: string;
  userCount: number;
  memberCount: number;
  cardCount: number;
  subscriptionCount: number;
  attendanceCount: number;
  paymentCount: number;
  auditCount: number;
  lastBackupAt: string | null;
  dbSizeBytes: number;
  scannerEnabled: boolean;
  autoBackupHours: number;
}

export function collectDiagnostics(db: Db, actor: ServiceActor): DiagnosticsReport {
  requirePermission(actor, "diagnostics.view");
  const settings = readAllSettings(db, actor);
  const tableCount = (table: string) =>
    db.count(`SELECT COUNT(*) FROM ${table}`);
  const lastBackup = getLatestVerifiedBackup(db);
  return {
    gymName: settings[SETTING_KEYS.gymName] ?? "",
    currencySymbol: settings[SETTING_KEYS.currencySymbol] ?? "",
    integrity: String(db.scalar("PRAGMA quick_check") ?? "unknown"),
    userCount: tableCount("users"),
    memberCount: tableCount("members"),
    cardCount: tableCount("cards"),
    subscriptionCount: tableCount("member_subscriptions"),
    attendanceCount: tableCount("attendance"),
    paymentCount: tableCount("payments"),
    auditCount: tableCount("audit_logs"),
    lastBackupAt: lastBackup?.createdAt ?? null,
    dbSizeBytes:
      Number(db.scalar("PRAGMA page_size") ?? 0) * Number(db.scalar("PRAGMA page_count") ?? 0),
    scannerEnabled: (settings[SETTING_KEYS.scannerEnabled] ?? "1") === "1",
    autoBackupHours: Number(settings[SETTING_KEYS.backupAutoIntervalHours] ?? 24),
  };
}
