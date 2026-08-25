import crypto from "node:crypto";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbContext, adoptDatabaseFile, logLine } from "./context";
import { NodeSqliteDriver } from "./driver";
import { errValidation } from "../src/core/errors";
import { requirePermission } from "../src/core/permissions";
import type { ServiceActor } from "../src/core/permissions";
import {
  buildBackupFileName,
  pruneBackupsForActor,
  recordBackupEntry,
  type BackupKind,
} from "../src/core/services/backup.service";

const SNAPSHOT_NAME_RE = /^[A-Za-z0-9._-]+$/;

function snapshotPath(fileName: string): string {
  if (!SNAPSHOT_NAME_RE.test(fileName) || fileName.includes("..")) {
    throw errValidation("errors.backupInvalidFile");
  }
  const { dirs } = getDbContext();
  return path.join(dirs.backupsDir, fileName);
}

/** Server-side consistent snapshot: verify on disk, then record + prune. */
export async function createServerBackup(
  actor: ServiceActor,
  kind: BackupKind,
): Promise<{ fileName: string; sizeBytes: number }> {
  requirePermission(actor, "backup.create");
  const { db, driver, dirs } = getDbContext();
  const bytes = driver.exportBytes();
  if (!bytes || bytes.length < 100) throw errValidation("errors.backupExportFailed");

  const fileName = buildBackupFileName();
  const target = path.join(dirs.backupsDir, fileName);
  writeFileSync(target, bytes);

  // verify the written file opens and passes integrity check
  const probe = NodeSqliteDriver.probeFile(target);
  if (probe.integrity !== "ok") {
    try {
      unlinkSync(target);
    } catch {
      /* best effort */
    }
    throw errValidation("errors.backupVerifyFailed");
  }

  await recordBackupEntry(db, actor, {
    kind,
    fileName,
    sizeBytes: bytes.length,
    checksum: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    verified: true,
  });

  try {
    const removed = await pruneBackupsForActor(db, actor);
    for (const name of removed) {
      try {
        unlinkSync(path.join(dirs.backupsDir, name));
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* retention pruning is best-effort */
  }

  logLine(`snapshot created: ${fileName} (${bytes.length} bytes)`);
  return { fileName, sizeBytes: bytes.length };
}

export function readSnapshotBytes(actor: ServiceActor, fileName: string): Uint8Array {
  requirePermission(actor, "backup.restore");
  const target = snapshotPath(fileName);
  if (!existsSync(target)) throw errValidation("errors.backupInvalidFile");
  return new Uint8Array(readFileSync(target));
}

function tableCounts(file: string): Record<string, number> {
  const probe = new DatabaseSync(file);
  const tables = [
    "members",
    "member_subscriptions",
    "cards",
    "attendance",
    "payments",
    "expenses",
    "products",
    "store_sales",
    "classes",
    "trainers",
    "employees",
    "audit_logs",
    "settings",
    "users",
  ];
  const counts: Record<string, number> = {};
  try {
    for (const table of tables) {
      try {
        counts[table] = Number(
          (probe.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number | bigint }).c,
        );
      } catch {
        counts[table] = -1; // table absent in legacy file
      }
    }
    try {
      const fk = probe.prepare("PRAGMA foreign_key_check").all();
      counts.foreignKeyViolations = fk.length;
    } catch {
      counts.foreignKeyViolations = -1;
    }
  } finally {
    probe.close();
  }
  return counts;
}

/**
 * Validate candidate database bytes (restore or one-time legacy import),
 * swap them in atomically after taking a protective snapshot, and return a
 * verification report (spec sections 17/19).
 */
export async function importDatabaseBytes(
  actor: ServiceActor,
  bytes: Uint8Array,
  options: { kind: "restore" | "legacy_import" },
): Promise<Record<string, unknown>> {
  requirePermission(actor, "backup.restore");
  if (bytes.length < 100 || bytes[0] === 0) throw errValidation("errors.backupInvalidFile");
  const header = Buffer.from(bytes.slice(0, 16)).toString("latin1");
  if (!header.startsWith("SQLite format 3")) throw errValidation("errors.backupInvalidFile");

  const { dirs } = getDbContext();

  // write candidate to temp file inside our data area (same volume → atomic rename)
  const tmpCandidate = path.join(dirs.databaseDir, `candidate-${Date.now()}.db`);
  writeFileSync(tmpCandidate, bytes);
  try {
    const probe = NodeSqliteDriver.probeFile(tmpCandidate);
    if (probe.integrity !== "ok") throw errValidation("errors.backupIntegrityFailed", { result: probe.integrity });
    if (probe.users === 0) throw errValidation("errors.restoreNoUsers");
    if (options.kind === "legacy_import" && probe.version > 0 && probe.version > 5) {
      throw errValidation("errors.backupInvalidFile");
    }

    const beforeCounts =
      existsSync(dirs.dbFile) ? tableCounts(dirs.dbFile) : null;

    // protective snapshot of current state first
    let protective: string | null = null;
    if (existsSync(dirs.dbFile)) {
      const outcome = await createServerBackup(actor, "pre_restore");
      protective = outcome.fileName;
    }

    adoptDatabaseFile(tmpCandidate);

    const afterCounts = tableCounts(dirs.dbFile);
    logLine(`${options.kind} completed; protective=${protective ?? "none"}`);
    return {
      schemaVersion: probe.version,
      protectedBackupFileName: protective,
      before: beforeCounts,
      after: afterCounts,
    };
  } catch (error) {
    try {
      unlinkSync(tmpCandidate);
    } catch {
      /* best effort */
    }
    throw error;
  }
}
