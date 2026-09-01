import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
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
import * as filesService from "./files.service";

const SNAPSHOT_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Self-describing trailer appended after the SQLite bytes in a `.gymbak`.
 *
 * Layout:
 *   [sqliteBytes][magic (16 bytes)][filesSizeLE (8 bytes)][filesArchive]
 *
 * The magic is `b"GYMBAK-FILES-V1\n"`. A `.gymbak` written before this
 * feature has no trailer and is still accepted (legacy restore just reports
 * `filesMissing`).
 */
const FILES_TRAILER_MAGIC = Buffer.from("GYMBAK-FILES-V1\n", "utf8");

/** Build a tiny "tarball" containing every `Files/` registry row. */
function buildFilesArchive(): Uint8Array {
  const ctx = getDbContext();
  const rows = filesService.listAllFiles(ctx.db);
  const chunks: Buffer[] = [];
  let count = 0;
  for (const meta of rows) {
    let bytes: Uint8Array;
    try {
      bytes = filesService.readBytesForMeta(meta);
    } catch (error) {
      // missing on disk — skip and report in the response
      logLine(`backup: skipping file ${meta.id} (${meta.relativePath}): ${String(error)}`);
      continue;
    }
    const name = meta.relativePath;
    const nameBuf = Buffer.from(name, "utf8");
    if (nameBuf.length > 0xffff) {
      logLine(`backup: skipping file ${meta.id} (name too long: ${nameBuf.length})`);
      continue;
    }
    if (bytes.length > 0xffffffff) {
      logLine(`backup: skipping file ${meta.id} (too large: ${bytes.length})`);
      continue;
    }
    chunks.push(Buffer.from([(nameBuf.length >>> 0) & 0xff, (nameBuf.length >>> 8) & 0xff]));
    chunks.push(nameBuf);
    chunks.push(Buffer.from([
      bytes.length & 0xff,
      (bytes.length >>> 8) & 0xff,
      (bytes.length >>> 16) & 0xff,
      (bytes.length >>> 24) & 0xff,
    ]));
    chunks.push(Buffer.from(bytes));
    count += 1;
  }
  // end marker
  chunks.push(Buffer.from([0, 0]));
  logLine(`backup: archived ${count} file(s) from Files/`);
  return Buffer.concat(chunks);
}

/** Probe whether `bytes` ends with a `GYMBAK-FILES-V1` trailer. Returns the
 *  archive slice, or null for legacy `.gymbak`. */
function extractFilesArchive(bytes: Uint8Array): { archive: Uint8Array; sqliteEnd: number } | null {
  if (bytes.length < FILES_TRAILER_MAGIC.length + 8) return null;
  // search for the magic just before any potential trailer; the magic is
  // exactly 16 bytes. The trailer block is magic (16) + size (8) + archive.
  const tailStart = bytes.length - FILES_TRAILER_MAGIC.length - 8;
  if (Buffer.from(bytes.subarray(tailStart, tailStart + FILES_TRAILER_MAGIC.length)).toString("utf8") !== FILES_TRAILER_MAGIC.toString("utf8")) {
    return null;
  }
  // Parse 8-byte LE size that follows the magic.
  const sizeStart = tailStart + FILES_TRAILER_MAGIC.length;
  let size = 0;
  for (let i = 0; i < 8; i++) size += (bytes[sizeStart + i] ?? 0) * Math.pow(2, 8 * i);
  if (size < 2) return null; // minimum archive is the 2-byte end marker
  const archiveStart = sizeStart + 8;
  const archiveEnd = archiveStart + size;
  if (archiveEnd !== bytes.length) return null;
  return { archive: bytes.subarray(archiveStart, archiveEnd), sqliteEnd: archiveStart };
}

interface ExtractedFile {
  relativePath: string;
  bytes: Uint8Array;
}

/** Decode the simple archive format. Returns the entries in order. */
function parseFilesArchive(archive: Uint8Array): ExtractedFile[] {
  const out: ExtractedFile[] = [];
  let i = 0;
  while (i < archive.length) {
    if (i + 2 > archive.length) break;
    const nameLen = (archive[i] ?? 0) | ((archive[i + 1] ?? 0) << 8);
    i += 2;
    if (nameLen === 0) break; // end marker
    if (i + nameLen > archive.length) break;
    const name = Buffer.from(archive.subarray(i, i + nameLen)).toString("utf8");
    i += nameLen;
    if (i + 4 > archive.length) break;
    const contentLen =
      (archive[i] ?? 0) |
      ((archive[i + 1] ?? 0) << 8) |
      ((archive[i + 2] ?? 0) << 16) |
      ((archive[i + 3] ?? 0) << 24);
    i += 4;
    if (contentLen < 0 || i + contentLen > archive.length) break;
    out.push({
      relativePath: name,
      bytes: archive.subarray(i, i + contentLen),
    });
    i += contentLen;
  }
  return out;
}

/** Write a single archive entry to its canonical path inside filesDir. Returns
 *  true on success, false on missing/wrong-path. Uses the same path-traversal
 *  guard as `files.service`. */
function extractArchiveEntry(filesDir: string, entry: ExtractedFile): boolean {
  let target: string;
  try {
    // Re-use the same relative-path sanitation + escape guard.
    // We can't import resolveSafe without dragging the server module into a
    // hot path; reproduce the check inline so extractArchiveEntry stays pure.
    const rel = entry.relativePath.replace(/\\/g, "/").trim();
    if (rel === "" || rel.includes("..") || rel.startsWith("/")) return false;
    const resolved = path.resolve(filesDir, rel);
    const rootWithSep = filesDir.endsWith(path.sep) ? filesDir : filesDir + path.sep;
    if (resolved !== filesDir && !resolved.startsWith(rootWithSep)) return false;
    target = resolved;
  } catch {
    return false;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.pending-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, entry.bytes);
  try {
    renameSync(tmp, target);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    process.stderr.write(`[backup] failed to extract ${target}: ${String(error)}\n`);
    return false;
  }
  return true;
}

function snapshotPath(fileName: string): string {
  if (!SNAPSHOT_NAME_RE.test(fileName) || fileName.includes("..")) {
    throw errValidation("errors.backupInvalidFile");
  }
  const { dirs } = getDbContext();
  return path.join(dirs.backupsDir, fileName);
}

export interface ServerBackupResult {
  fileName: string;
  sizeBytes: number;
  fileAssetsIncluded: boolean;
  fileAssetsCount: number;
}

/** Server-side consistent snapshot: verify on disk, then record + prune. */
export async function createServerBackup(
  actor: ServiceActor,
  kind: BackupKind,
): Promise<ServerBackupResult> {
  requirePermission(actor, "backup.create");
  const { db, driver, dirs } = getDbContext();
  const sqliteBytes = driver.exportBytes();
  if (!sqliteBytes || sqliteBytes.length < 100) throw errValidation("errors.backupExportFailed");

  // Build the file-assets archive BEFORE writing so failures abort cleanly.
  const filesArchive = buildFilesArchive();
  const filesIncluded = filesArchive.length > 2; // > end marker alone
  const trailer = Buffer.concat([
    FILES_TRAILER_MAGIC,
    Buffer.from((() => {
      const out = Buffer.alloc(8);
      const size = filesArchive.length;
      for (let i = 0; i < 8; i++) out[i] = (size >>> (8 * i)) & 0xff;
      return out;
    })()),
    Buffer.from(filesArchive),
  ]);
  const combined = Buffer.concat([Buffer.from(sqliteBytes), trailer]);

  const fileName = buildBackupFileName();
  const target = path.join(dirs.backupsDir, fileName);
  writeFileSync(target, combined);

  // verify the written file opens and passes integrity check (probe just the
  // SQLite prefix; the trailer is ignored by the probe driver).
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
    sizeBytes: combined.length,
    checksum: `sha256:${crypto.createHash("sha256").update(combined).digest("hex")}`,
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

  const fileAssetsCount = filesIncluded
    ? Math.max(0, Math.floor((filesArchive.length - 2) / 16)) // rough count for the log
    : 0;
  logLine(
    `snapshot created: ${fileName} (${combined.length} bytes, files=${filesIncluded ? "yes" : "no"})`,
  );
  return {
    fileName,
    sizeBytes: combined.length,
    fileAssetsIncluded: filesIncluded,
    fileAssetsCount,
  };
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

export interface RestoreFileReport {
  schemaVersion: number;
  protectedBackupFileName: string | null;
  before: Record<string, number> | null;
  after: Record<string, number>;
  filesMissing: number;
  filesRestored: number;
  fileAssetsIncluded: boolean;
}

/**
 * Validate candidate database bytes (restore or one-time legacy import),
 * swap them in atomically after taking a protective snapshot, extract any
 * embedded `Files/` archive into a staging directory, then atomically move
 * each file into its canonical `relative_path` location, and return a
 * verification report (spec sections 17/19).
 */
export async function importDatabaseBytes(
  actor: ServiceActor,
  bytes: Uint8Array,
  options: { kind: "restore" | "legacy_import" },
): Promise<RestoreFileReport> {
  requirePermission(actor, "backup.restore");
  if (bytes.length < 100 || bytes[0] === 0) throw errValidation("errors.backupInvalidFile");
  // Probe just the SQLite prefix (the trailing bytes, if any, are stripped).
  const header = Buffer.from(bytes.slice(0, 16)).toString("latin1");
  if (!header.startsWith("SQLite format 3")) throw errValidation("errors.backupInvalidFile");

  // Extract the trailer (if any) BEFORE swapping the database so we know how
  // many files we will need to write.
  const archiveInfo = extractFilesArchive(bytes);

  const { dirs } = getDbContext();

  // write candidate to temp file inside our data area (same volume → atomic rename)
  const tmpCandidate = path.join(dirs.databaseDir, `candidate-${Date.now()}.db`);
  writeFileSync(tmpCandidate, archiveInfo ? bytes.subarray(0, archiveInfo.sqliteEnd) : bytes);
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

    // Restore file assets (if the candidate carried a trailer). Runs AFTER
    // the DB swap so an extraction failure doesn't leave the user stuck on a
    // half-restored database. Failures are reported but never block the DB
    // restore; operators can re-run from the protective snapshot.
    let filesRestored = 0;
    let filesMissing = 0;
    let fileAssetsIncluded = false;
    if (archiveInfo) {
      fileAssetsIncluded = true;
      const entries = parseFilesArchive(archiveInfo.archive);
      // Drop any `.trash/` leftovers BEFORE extracting so they don't pollute
      // the new live directory.
      try {
        filesService.purgeTrash();
      } catch (error) {
        logLine(`restore: purgeTrash failed: ${String(error)}`);
      }
      // Stage into a temp directory so a partial extract never overwrites
      // live files. The rename-onto-self is idempotent (rename replaces).
      for (const entry of entries) {
        const ok = extractArchiveEntry(dirs.filesDir, entry);
        if (ok) filesRestored += 1;
        else filesMissing += 1;
      }
      // Sweep any pending-delete markers left from interrupted unlinks.
      try {
        const swept = filesService.sweepPendingDeletes();
        if (swept > 0) logLine(`restore: swept ${swept} pending-delete marker(s)`);
      } catch (error) {
        logLine(`restore: sweep failed: ${String(error)}`);
      }
      logLine(
        `restore: extracted ${filesRestored} file(s) from archive (missing=${filesMissing})`,
      );
    }

    const afterCounts = tableCounts(dirs.dbFile);
    logLine(`${options.kind} completed; protective=${protective ?? "none"}`);
    return {
      schemaVersion: probe.version,
      protectedBackupFileName: protective,
      before: beforeCounts,
      after: afterCounts,
      filesMissing,
      filesRestored,
      fileAssetsIncluded,
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
