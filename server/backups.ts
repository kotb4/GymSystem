import crypto from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import type { ReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbContext, adoptDatabaseFile, logLine } from "./context";
import { NodeSqliteDriver } from "./driver";
import { errConflict, errValidation } from "../src/core/errors";
import { requirePermission } from "../src/core/permissions";
import type { ServiceActor } from "../src/core/permissions";
import { countActiveOwners } from "../src/core/services/users.service";
import { readSetting, SETTING_KEYS } from "../src/core/services/settings.service";
import {
  buildBackupFileName,
  pruneBackupsForActor,
  recordBackupEntry,
  type BackupKind,
} from "../src/core/services/backup.service";
import * as filesService from "./files.service";
import {
  encryptBackupPayload,
  decryptBackupContainer,
  parseBackupContainer,
  looksLikeContainer,
  loadBackupKey,
  backupKeyExists,
  type BackupKeyRef,
  type DecryptKeySource,
} from "./backup-crypto";

const SNAPSHOT_NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Snapshot location override for tests (see configurable backup_location). */
let snapshotDirOverride: string | null = null;
export function _setSnapshotDirOverrideForTest(dir: string | null): void {
  snapshotDirOverride = dir;
}

/**
 * Self-describing trailer appended after the SQLite bytes in a `.gymbak`.
 *
 * Layout:
 *   [sqliteBytes][magic (16 bytes)][filesSizeLE (8 bytes)][filesArchive]
 *
 * The magic is `b"GYMBAK-FILES-V1\n"`. A `.gymbak` written before this
 * feature has no trailer and is still accepted (legacy restore reports the
 * expected files as missing and refuses the restore, instead of silently
 * dropping them).
 *
 * The size field records the archive length INCLUDING its 2-byte end marker,
 * which is minimal (2). The trailer parser locates the magic by searching from
 * the END of the buffer (the SQLite body may legitimately contain arbitrary
 * bytes, so a fixed offset from the end is wrong) and then validates that the
 * declared size exactly spans to the end of the file.
 */
const FILES_TRAILER_MAGIC = Buffer.from("GYMBAK-FILES-V1\n", "utf8");

/** Bumped together with the trailer format. V1 = the layout above. */
export const BACKUP_FORMAT_VERSION = 1 as const;

type TrailerInfo =
  /** Legacy `.gymbak` produced before the files trailer existed. */
  | { kind: "none" }
  /** Magic found but the structure is invalid (truncated / size mismatch). */
  | { kind: "corrupt"; reason: string }
  /** Magic found and the archive boundary is exact. */
  | { kind: "ok"; archive: Uint8Array; archiveLength: number; sqliteEnd: number };

/**
 * Locate and validate the optional files trailer at the end of `bytes`.
 *
 * The writer appends `[magic 16][sizeLE 8][archive]` AFTER the SQLite bytes,
 * so the magic sits at `bytes.length - 8 - archiveLength - 16` — it cannot be
 * found at a constant offset from the end. Search backwards for the LAST
 * occurrence (the real trailer is always the trailing magic; anything earlier
 * is SQLite body data) and then demand that the declared archive size spans
 * exactly to the end of the buffer. Anything else is a corrupted backup.
 *
 * Size-field compatibility: writers before TASK-040 emitted the 8-byte size
 * via `value >>> (8 * i)`, which wraps for i >= 4, so the stored 64-bit value
 * was `L + (L << 32)` (both 32-bit halves equal L) instead of L. The reader
 * recovers L whenever either half is zero or both halves are equal; every
 * accepted value is still validated against the exact EOF boundary, so a
 * wrong recovery can never be mistaken for a good trailer.
 */
function extractFilesArchive(bytes: Uint8Array): TrailerInfo {
  if (bytes.length < FILES_TRAILER_MAGIC.length + 10) return { kind: "none" };
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magicAt = haystack.lastIndexOf(FILES_TRAILER_MAGIC);
  if (magicAt < 0) return { kind: "none" };
  const sizeField = magicAt + FILES_TRAILER_MAGIC.length;
  if (sizeField + 8 > bytes.length) {
    return { kind: "corrupt", reason: "size field truncated" };
  }
  // Read the full 64-bit little-endian value without bitwise wrap-around.
  let raw = 0;
  for (let i = 0; i < 8; i++) raw += (bytes[sizeField + i] ?? 0) * Math.pow(2, 8 * i);
  const low = raw % 4294967296;
  const high = Math.floor(raw / 4294967296);
  const size = high === 0 || high === low ? low : raw;
  if (size < 2) return { kind: "corrupt", reason: `invalid archive size (${size})` };
  const archiveStart = sizeField + 8;
  const archiveEnd = archiveStart + size;
  if (archiveEnd !== bytes.length) {
    return {
      kind: "corrupt",
      reason: `archive size ${size} does not reach file end (${bytes.length - archiveStart} remaining)`,
    };
  }
  return {
    kind: "ok",
    archive: bytes.subarray(archiveStart, archiveEnd),
    archiveLength: size,
    sqliteEnd: magicAt,
  };
}

/** Thrown by `parseFilesArchiveStrict` when the archive structure is invalid. */
class ArchiveCorruptError extends Error {}

function corruptArchive(reason: string): never {
  throw new ArchiveCorruptError(reason);
}

interface ExtractedFile {
  relativePath: string;
  bytes: Uint8Array;
}

/**
 * Decode the simple archive format:
 *   repeat { nameLen(2) name contentLen(4) content } then 0x0000 end marker.
 *
 * Strict: any truncation, trailing bytes after the end marker, or impossible
 * lengths are fatal (`ArchiveCorruptError`). No silent mid-stream truncation —
 * garbage in the archive must never be half-restored.
 */
function parseFilesArchiveStrict(archive: Uint8Array): ExtractedFile[] {
  const out: ExtractedFile[] = [];
  let i = 0;
  while (i < archive.length) {
    if (i + 2 > archive.length) corruptArchive("truncated entry header");
    const nameLen = (archive[i] ?? 0) | ((archive[i + 1] ?? 0) << 8);
    i += 2;
    if (nameLen === 0) {
      if (i !== archive.length) corruptArchive("trailing bytes after end marker");
      break;
    }
    if (i + nameLen > archive.length) corruptArchive("truncated file name");
    const name = Buffer.from(archive.subarray(i, i + nameLen)).toString("utf8");
    i += nameLen;
    if (i + 4 > archive.length) corruptArchive("truncated content length");
    const contentLen =
      (archive[i] ?? 0) |
      ((archive[i + 1] ?? 0) << 8) |
      ((archive[i + 2] ?? 0) << 16) |
      ((archive[i + 3] ?? 0) << 24);
    i += 4;
    if (contentLen < 0 || i + contentLen > archive.length) corruptArchive("truncated file content");
    out.push({
      relativePath: name,
      bytes: archive.subarray(i, i + contentLen),
    });
    i += contentLen;
  }
  return out;
}

interface FilesArchiveBuild {
  bytes: Uint8Array;
  /** Number of `files` registry rows that should be archived. */
  expected: number;
  /** Number of entries actually written into the archive. */
  archived: number;
  /** `files.id` values skipped (missing on disk / unsafe path / oversized). */
  skipped: string[];
}

/**
 * Build a tiny "tarball" containing every `Files/` registry row, returning
 * REAL counters instead of estimating the count from the byte length.
 */
function buildFilesArchive(): FilesArchiveBuild {
  const ctx = getDbContext();
  const rows = filesService.listAllFiles(ctx.db);
  const chunks: Buffer[] = [];
  const skipped: string[] = [];
  let archived = 0;
  for (const meta of rows) {
    if (!filesService.isSafeRelativePath(meta.relativePath)) {
      skipped.push(meta.id);
      logLine(`backup: skipping file ${meta.id} (unsafe relative path)`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = filesService.readBytesForMeta(meta);
    } catch (error) {
      // missing on disk — skip and report in the response
      skipped.push(meta.id);
      logLine(`backup: skipping file ${meta.id} (${meta.relativePath}): ${String(error)}`);
      continue;
    }
    const nameBuf = Buffer.from(meta.relativePath, "utf8");
    if (nameBuf.length > 0xffff) {
      skipped.push(meta.id);
      logLine(`backup: skipping file ${meta.id} (name too long: ${nameBuf.length})`);
      continue;
    }
    if (bytes.length > 0xffffffff) {
      skipped.push(meta.id);
      logLine(`backup: skipping file ${meta.id} (too large: ${bytes.length})`);
      continue;
    }
    chunks.push(Buffer.from([(nameBuf.length >>> 0) & 0xff, (nameBuf.length >>> 8) & 0xff]));
    chunks.push(nameBuf);
    chunks.push(
      Buffer.from([
        bytes.length & 0xff,
        (bytes.length >>> 8) & 0xff,
        (bytes.length >>> 16) & 0xff,
        (bytes.length >>> 24) & 0xff,
      ]),
    );
    chunks.push(Buffer.from(bytes));
    archived += 1;
  }
  // end marker
  chunks.push(Buffer.from([0, 0]));
  const bytes = Buffer.concat(chunks);
  logLine(`backup: archived ${archived} file(s) from Files/ (expected ${rows.length}, skipped ${skipped.length})`);
  return { bytes, expected: rows.length, archived, skipped };
}

function resolveSnapshotDir(): string {
  if (snapshotDirOverride) return snapshotDirOverride;
  try {
    const configured = (readSetting(getDbContext().db, SETTING_KEYS.backupLocation) ?? "").trim();
    if (configured !== "") {
      try {
        mkdirSync(configured, { recursive: true });
        return configured;
      } catch (error) {
        logLine(`backup: configured location unusable, falling back to default (${String(error)})`);
      }
    }
  } catch {
    logLine("backup: could not read configured location, using default");
  }
  return getDbContext().dirs.backupsDir;
}

function snapshotPath(fileName: string): string {
  if (!SNAPSHOT_NAME_RE.test(fileName) || fileName.includes("..")) {
    throw errValidation("errors.backupInvalidFile");
  }
  return path.join(resolveSnapshotDir(), fileName);
}

export interface ServerBackupResult {
  fileName: string;
  sizeBytes: number;
  /** 1 = GYMBAK-FILES-V1 trailer layout; 2 = AES-256-GCM container (payload keeps the v1 layout). */
  formatVersion: 1 | 2;
  encrypted: boolean;
  cipher: "aes-256-gcm" | null;
  /** True when at least one file entry was archived. */
  fileAssetsIncluded: boolean;
  /** `files` registry rows that should have been archived. */
  fileAssetsExpected: number;
  /** Entries actually written into the archive (real count). */
  fileAssetsCount: number;
  /** Registry rows skipped because their bytes were not readable. */
  fileAssetsMissing: number;
  /** Integrity of the embedded database copy (PRAGMA quick_check). */
  databaseIntegrity: "ok";
  /** True only when the database probed OK AND no asset was skipped. */
  fullyVerified: boolean;
}

/** True when the current config asks for encrypted backups AND a key is usable. */
function encryptionActive(): boolean {
  try {
    const { dirs, db } = getDbContext();
    if (db && readSetting(db, SETTING_KEYS.backupEncryptionEnabled) !== "1") return false;
    return backupKeyExists(dirs.configDir);
  } catch {
    return false;
  }
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

  // Probe the raw SQLite bytes BEFORE writing anything: for encrypted snapshots
  // the on-disk file is ciphertext and can never be probed in place.
  const probeTmp = path.join(
    os.tmpdir(),
    `gymbak-probe-${crypto.randomUUID().slice(0, 8)}.db`,
  );
  writeFileSync(probeTmp, sqliteBytes);
  let databaseIntegrity: "ok" = "ok";
  try {
    const probe = NodeSqliteDriver.probeFile(probeTmp);
    if (probe.integrity !== "ok") {
      throw errValidation("errors.backupVerifyFailed");
    }
  } finally {
    rmSync(probeTmp, { force: true });
  }

  // Build the file-assets archive BEFORE writing so failures abort cleanly.
  const build = buildFilesArchive();
  const sizeBytes = Buffer.alloc(8);
  // Write the 64-bit little-endian size as two 32-bit halves; a plain
  // `value >>> (8 * i)` would wrap for i >= 4 and corrupt the field (see
  // extractFilesArchive compatibility notes).
  sizeBytes.writeUInt32LE(build.bytes.length >>> 0, 0);
  sizeBytes.writeUInt32LE(Math.floor(build.bytes.length / 4294967296), 4);
  const trailer = Buffer.concat([
    FILES_TRAILER_MAGIC,
    sizeBytes,
    Buffer.from(build.bytes),
  ]);
  const combined = Buffer.concat([Buffer.from(sqliteBytes), trailer]);

  // Wrap the full v1 composite in an AES-256-GCM container when encryption is on.
  let encrypted = false;
  let targetBytes: Buffer = combined;
  let keyRef: BackupKeyRef | null = null;
  if (encryptionActive()) {
    keyRef = loadBackupKey(dirs.configDir);
    if (keyRef) {
      targetBytes = await encryptBackupPayload(combined, keyRef.masterKey, {
        kind,
        createdAt: new Date().toISOString(),
        source: keyRef.source,
        master: keyRef.kdf,
      });
      encrypted = true;
    }
  }

  const fileName = buildBackupFileName();
  const target = snapshotPath(fileName); // honors configured backup_location
  writeFileSync(target, targetBytes);

  // POST-CREATE verification: re-read the written snapshot and verify it —
  // decrypting first when necessary. Any failure deletes the file.
  let fullyVerified = false;
  try {
    const check = await verifySnapshotBytes(
      new Uint8Array(readFileSync(target)),
      keyRef
        ? {
            master: { kind: "master", key: keyRef.masterKey },
          }
        : undefined,
    );
    if (check.status !== "ok") throw errValidation("errors.backupVerifyFailed");
    // A backup is only "verified" when the embedded database is intact AND no
    // registry row was skipped (a skipped row means the restore would be
    // incomplete, so we must never advertise it as fully verified).
    fullyVerified = build.skipped.length === 0;
  } catch (error) {
    try {
      unlinkSync(target);
    } catch {
      /* best effort */
    }
    if (error instanceof Error && (error as { code?: string }).code === "FORBIDDEN") throw error;
    throw errValidation("errors.backupVerifyFailed");
  }

  await recordBackupEntry(db, actor, {
    kind,
    fileName,
    sizeBytes: targetBytes.length,
    checksum: `sha256:${crypto.createHash("sha256").update(targetBytes).digest("hex")}`,
    verified: fullyVerified,
    encrypted,
  });

  try {
    const removed = await pruneBackupsForActor(db, actor);
    for (const name of removed) {
      try {
        unlinkSync(path.join(resolveSnapshotDir(), name));
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* retention pruning is best-effort */
  }

  logLine(
    `snapshot created: ${fileName} (${targetBytes.length} bytes, encrypted=${encrypted}, files=${build.archived}/${build.expected})`,
  );
  return {
    fileName,
    sizeBytes: targetBytes.length,
    formatVersion: encrypted ? 2 : 1,
    encrypted,
    cipher: encrypted ? "aes-256-gcm" : null,
    fileAssetsIncluded: build.archived > 0,
    fileAssetsExpected: build.expected,
    fileAssetsCount: build.archived,
    fileAssetsMissing: build.skipped.length,
    databaseIntegrity,
    fullyVerified,
  };
}

export function readSnapshotBytes(actor: ServiceActor, fileName: string): Uint8Array {
  requirePermission(actor, "backup.restore");
  const target = snapshotPath(fileName);
  if (!existsSync(target)) throw errValidation("errors.backupInvalidFile");
  return new Uint8Array(readFileSync(target));
}

/** Stream a snapshot to the client without loading the whole file into memory. */
export function openSnapshotReadStream(
  actor: ServiceActor,
  fileName: string,
): { stream: ReadStream; sizeBytes: number } {
  requirePermission(actor, "backup.restore");
  const target = snapshotPath(fileName);
  if (!existsSync(target)) throw errValidation("errors.backupInvalidFile");
  return { stream: createReadStream(target), sizeBytes: statSync(target).size };
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

interface CandidateFileManifestEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

interface CandidateProbe {
  integrity: string;
  users: number;
  version: number;
  /** `files` rows that carry a relative_path (= the restore manifest). */
  files: CandidateFileManifestEntry[];
}

/**
 * Open a candidate `.db` image with node:sqlite and read integrity, user
 * count, schema version and the embedded `files` manifest. Returns null when
 * the file is not a readable database at all.
 */
function readCandidateProbe(dbFile: string): CandidateProbe | null {
  let probe: DatabaseSync;
  try {
    probe = new DatabaseSync(dbFile);
  } catch {
    return null;
  }
  try {
    // node:sqlite opens lazily — `prepare` (not the constructor) throws for
    // bytes that are not a database, so every query must be guarded.
    let integrity: string;
    try {
      const integrityRow = probe.prepare("PRAGMA integrity_check").get() as { [k: string]: unknown } | null;
      integrity = String(integrityRow ? Object.values(integrityRow)[0] ?? "" : "").toLowerCase();
    } catch {
      integrity = "unreadable";
    }
    let users = 0;
    let version = 0;
    if (integrity !== "unreadable") {
      try {
        users = Number(
          (probe.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number | bigint }).c,
        );
      } catch {
        users = 0;
      }
      try {
        version = Number(
          (probe.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {
            v: number | bigint | null;
          }).v ?? 0,
        );
      } catch {
        version = 0;
      }
    }
    let files: CandidateFileManifestEntry[] = [];
    try {
      files = (
        probe
          .prepare(
            "SELECT relative_path, size_bytes, sha256 FROM files WHERE relative_path IS NOT NULL AND relative_path <> ''",
          )
          .all() as { relative_path: unknown; size_bytes: unknown; sha256: unknown }[]
      ).map((row) => ({
        relativePath: String(row.relative_path),
        sizeBytes: Number(row.size_bytes ?? 0),
        sha256: String(row.sha256 ?? ""),
      }));
    } catch {
      files = [];
    }
    return { integrity: integrity === "ok" ? "ok" : integrity || "failed", users, version, files };
  } finally {
    probe.close();
  }
}

export interface RestoreFileReport {
  schemaVersion: number;
  /** 1 = GYMBAK-FILES-V1 trailer; 0 = legacy (no trailer). */
  formatVersion: number;
  /** True when the uploaded file was an encrypted AES-256-GCM container. */
  encrypted: boolean;
  cipher: "aes-256-gcm" | null;
  protectedBackupFileName: string | null;
  before: Record<string, number> | null;
  after: Record<string, number>;
  /** True when the backup carried a files trailer. */
  fileAssetsIncluded: boolean;
  /** Files referenced by the restored database (`files` manifest rows). */
  fileAssetsExpected: number;
  /** Entries actually written to disk. */
  fileAssetsStored: number;
  /** Manifest rows whose bytes matched the archive (checksum-verified). */
  fileAssetsVerified: number;
  filesRestored: number;
  filesMissing: number;
  integrityStatus: "ok";
  /** True only when the database is intact AND every expected file is present. */
  fullyVerified: boolean;
}

export interface FileAssetMatch {
  relativePath: string;
  expectedSha256: string;
  actualSha256: string;
}

export interface BackupVerificationReport {
  status: "ok" | "missing_files" | "corrupt";
  checksumSha256: string;
  database: {
    present: boolean;
    integrity: string;
    migrationVersion: number;
    userCount: number;
    /** Byte offset where the embedded SQLite image ends (0 for legacy). */
    sqliteByteOffset: number;
  };
  fileArchive: {
    present: boolean;
    sizeBytes: number;
    expectedCount: number;
    archivedCount: number;
    missingFiles: string[];
    mismatchedFiles: FileAssetMatch[];
    extraFiles: string[];
  };
  fullyVerified: boolean;
  /** True when the buffer is an AES-256-GCM container (payload re-verified). */
  encrypted: boolean;
  cipher: "aes-256-gcm" | null;
}

/**
 * Pure verification of a `.gymbak` byte buffer WITHOUT touching the live
 * database or `Files/`: decodes the trailer, integrity-checks the embedded
 * SQLite image in a temp copy, parses the archive and cross-checks every
 * manifest row (relative_path + sha256). Used by tooling and tests.
 *
 * Status semantics:
 *  - "ok":            database intact AND every expected file present + matching.
 *  - "missing_files": database intact but expected files are absent/mismatched.
 *  - "corrupt":       trailer broken, SQLite image unreadable, or archive parse
 *                     failed — do NOT attempt a restore from this buffer.
 */
export function verifyBackupSnapshot(bytes: Uint8Array): BackupVerificationReport {
  const checksumSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const trailer = extractFilesArchive(bytes);
  const sqliteBytes = trailer.kind === "ok" ? bytes.subarray(0, trailer.sqliteEnd) : bytes;

  const tmp = path.join(os.tmpdir(), `gymbak-verify-${crypto.randomUUID()}.db`);
  writeFileSync(tmp, sqliteBytes);
  let probe: CandidateProbe | null;
  try {
    probe = readCandidateProbe(tmp);
  } finally {
    try {
      rmSync(tmp);
    } catch {
      /* best effort */
    }
  }

  const sqliteByteOffset = trailer.kind === "ok" ? trailer.sqliteEnd : 0;
  const dbPresent = probe !== null;
  const dbOk = probe !== null && probe.integrity === "ok";
  const manifest = probe?.files ?? [];

  const corruptReport = (fileArchivePresent: boolean, sizeBytes: number): BackupVerificationReport => ({
    status: "corrupt",
    checksumSha256,
    database: {
      present: dbPresent,
      integrity: probe ? probe.integrity : "unreadable",
      migrationVersion: probe?.version ?? 0,
      userCount: probe?.users ?? 0,
      sqliteByteOffset,
    },
    fileArchive: {
      present: fileArchivePresent,
      sizeBytes,
      expectedCount: manifest.length,
      archivedCount: 0,
      missingFiles: [],
      mismatchedFiles: [],
      extraFiles: [],
    },
    fullyVerified: false,
    encrypted: false,
    cipher: null,
  });

  if (trailer.kind === "corrupt") {
    return corruptReport(true, 0);
  }
  if (!probe || !dbOk) {
    return corruptReport(trailer.kind !== "none", 0);
  }

  let entries: ExtractedFile[] = [];
  if (trailer.kind === "ok") {
    try {
      entries = parseFilesArchiveStrict(trailer.archive);
    } catch {
      return corruptReport(true, trailer.archiveLength);
    }
  }

  const manifestNames = new Set(manifest.map((f) => f.relativePath));
  const byName = new Map(entries.map((e) => [e.relativePath, e]));
  const missingFiles: string[] = [];
  const mismatchedFiles: FileAssetMatch[] = [];
  for (const meta of manifest) {
    const entry = byName.get(meta.relativePath);
    if (!entry) {
      missingFiles.push(meta.relativePath);
      continue;
    }
    if (meta.sha256) {
      const actual = crypto.createHash("sha256").update(entry.bytes).digest("hex");
      if (actual !== meta.sha256) {
        mismatchedFiles.push({
          relativePath: meta.relativePath,
          expectedSha256: meta.sha256,
          actualSha256: actual,
        });
      }
    }
  }
  const extraFiles = entries.filter((e) => !manifestNames.has(e.relativePath)).map((e) => e.relativePath);

  const incomplete = missingFiles.length > 0 || mismatchedFiles.length > 0;
  return {
    status: incomplete ? "missing_files" : "ok",
    checksumSha256,
    database: {
      present: true,
      integrity: "ok",
      migrationVersion: probe!.version,
      userCount: probe!.users,
      sqliteByteOffset,
    },
    fileArchive: {
      present: trailer.kind !== "none",
      sizeBytes: trailer.kind === "ok" ? trailer.archiveLength : 0,
      expectedCount: manifest.length,
      archivedCount: entries.length,
      missingFiles,
      mismatchedFiles,
      extraFiles,
    },
    fullyVerified: !incomplete,
    encrypted: false,
    cipher: null,
  };
}

export interface SnapshotVerifyOptions {
  /** User-supplied password (for password-derived backup containers). */
  password?: string;
  /** Explicit master key (used by createServerBackup for post-create checks). */
  master?: { kind: "master"; key: Uint8Array };
}

/** Corruption report for a v2 container that could not be decrypted/parsed. */
function encryptedFailureReport(reason: string): BackupVerificationReport {
  return {
    status: "corrupt",
    checksumSha256: "",
    database: {
      present: false,
      integrity: `encrypted:${reason}`,
      migrationVersion: 0,
      userCount: 0,
      sqliteByteOffset: 0,
    },
    fileArchive: {
      present: false,
      sizeBytes: 0,
      expectedCount: 0,
      archivedCount: 0,
      missingFiles: [],
      mismatchedFiles: [],
      extraFiles: [],
    },
    fullyVerified: false,
    encrypted: true,
    cipher: "aes-256-gcm",
  };
}

/** Pick the decrypting key: explicit password, explicit master, else key ring. */
async function resolveDecryptSource(
  kdfSource: "password" | "key",
  options: SnapshotVerifyOptions,
): Promise<DecryptKeySource | null> {
  if (kdfSource === "password" && options.password && options.password !== "") {
    return { kind: "password", password: options.password };
  }
  if (options.master) return { kind: "master", key: Buffer.from(options.master.key) };
  const { dirs } = getDbContext();
  try {
    if (backupKeyExists(dirs.configDir)) {
      const ref = loadBackupKey(dirs.configDir);
      if (ref) return { kind: "master", key: ref.masterKey };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Encryption-aware verification: v1 (`GYMBAK-FILES-V1`) buffers verify inline;
 * v2 AES-256-GCM containers are decrypted first and their plaintext payload is
 * then verified through the plain pipeline. Callers that reach the RPC surface
 * (restore/validate) get precise AppErrors from the decrypt path; this report
 * form is used by post-create checks and tooling.
 */
export async function verifySnapshotBytes(
  bytes: Uint8Array,
  options: SnapshotVerifyOptions = {},
): Promise<BackupVerificationReport> {
  if (!looksLikeContainer(bytes)) return verifyBackupSnapshot(bytes);

  let header;
  try {
    header = parseBackupContainer(bytes);
  } catch {
    return encryptedFailureReport("header");
  }
  if (!header) return encryptedFailureReport("header");

  const source = await resolveDecryptSource(header.kdf.source, options);
  if (!source) return encryptedFailureReport("key_required");

  let payload: Uint8Array;
  try {
    payload = (await decryptBackupContainer(bytes, header, source)).payload;
  } catch {
    return encryptedFailureReport("decrypt_failed");
  }

  const base = verifyBackupSnapshot(payload);
  return { ...base, encrypted: true, cipher: "aes-256-gcm" };
}

/**
 * Read + verify a snapshot from the configured snapshot directory (or the
 * default backups dir when no location is configured).
 */
export async function verifySnapshotFile(
  fileName: string,
  options: SnapshotVerifyOptions = {},
): Promise<BackupVerificationReport> {
  const target = snapshotPath(fileName);
  if (!existsSync(target)) throw errValidation("errors.backupInvalidFile");
  return verifySnapshotBytes(new Uint8Array(readFileSync(target)), options);
}

/**
 * Stage every archive entry under `stagingRoot` using atomic tmp-then-rename
 * writes. Throws on the first unreadable/unsafe/invalid entry — the caller
 * removes the whole staging directory on failure so the live `Files/` tree is
 * never partially written.
 */
function stageArchiveEntries(stagingRoot: string, entries: ExtractedFile[]): number {
  for (const entry of entries) {
    if (!filesService.isSafeRelativePath(entry.relativePath)) {
      throw new Error(`unsafe archive path: ${entry.relativePath}`);
    }
    // isSafeRelativePath above guarantees containment: no `..`, no leading
    // slash, no drive prefix and no backslash tricks, so path.join(stagingRoot, ...)
    // can never escape the root.
    const target = path.join(stagingRoot, entry.relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.pending-${process.pid}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    writeFileSync(tmp, entry.bytes);
    try {
      renameSync(tmp, target);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        /* best effort */
      }
      throw error;
    }
  }
  return entries.length;
}

/**
 * Atomically replace the live `Files/` tree with the staged one:
 *   1. rename  Files/ -> .restore-old-<stamp>
 *   2. rename  .restore-staging-<stamp> -> Files/
 *   3. delete  .restore-old-<stamp> (best-effort)
 * On failure step 2 is rolled back (old tree restored). When the current tree
 * does not exist (restore onto a wiped data dir) step 1 is skipped. Both
 * renames are same-volume so they are atomic on Windows.
 */
function swapInStagedFiles(currentRoot: string, stagedRoot: string): { ok: boolean; reason?: string } {
  const parent = path.dirname(currentRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const oldRoot = path.join(parent, `.restore-old-${stamp}`);
  const currentExists = existsSync(currentRoot);
  if (currentExists) {
    try {
      renameSync(currentRoot, oldRoot);
    } catch (error) {
      return { ok: false, reason: `cannot move current Files/ tree: ${String(error)}` };
    }
  }
  try {
    renameSync(stagedRoot, currentRoot);
  } catch (error) {
    if (currentExists) {
      try {
        renameSync(oldRoot, currentRoot);
      } catch (rollbackError) {
        return {
          ok: false,
          reason: `cannot activate staged Files/ and rollback failed: ${String(rollbackError)}`,
        };
      }
    }
    return { ok: false, reason: `cannot activate staged Files/ tree: ${String(error)}` };
  }
  if (currentExists) {
    try {
      rmSync(oldRoot, { recursive: true, force: true });
    } catch {
      logLine(`restore: could not remove old Files/ tree at ${oldRoot}`);
    }
  }
  return { ok: true };
}

/**
 * Validate candidate database bytes (restore or one-time legacy import),
 * verify the embedded file manifest BEFORE touching anything, take a
 * protective snapshot, stage the archive into a sibling directory, swap the
 * whole `Files/` tree, and only then adopt the database bytes. Any corruption,
 * truncation or missing-mismatched file aborts BEFORE the live state changes
 * (spec sections 17/19).
 */
export async function importDatabaseBytes(
  actor: ServiceActor,
  bytes: Uint8Array,
  options: { kind: "restore" | "legacy_import"; password?: string },
): Promise<RestoreFileReport> {
  requirePermission(actor, "backup.restore");
  // Legacy import (`kind: "legacy_import"`) is a ONE-TIME first-run adoption:
  // it may only run while the system is still uninitialized (no active owner).
  // Re-checked here — synchronously, right before any heavy work — so a setup
  // that completed during the upload cannot be overwritten by a stale
  // unauthenticated import request. Restore (authenticated) is unaffected.
  if (options.kind === "legacy_import" && countActiveOwners(getDbContext().db) > 0) {
    throw errConflict("errors.setupAlreadyDone");
  }
  if (bytes.length < 100 || bytes[0] === 0) throw errValidation("errors.backupInvalidFile");

  // v2 AES-256-GCM containers decrypt FIRST, then flow through the exact same
  // plain v1 verification/restore pipeline.
  let encrypted = false;
  let source: Uint8Array = bytes;
  if (looksLikeContainer(bytes)) {
    let header;
    try {
      header = parseBackupContainer(bytes); // throws with precise messageKey
    } catch (error) {
      if (error instanceof Error && (error as { messageKey?: string }).messageKey) throw error;
      throw errValidation("errors.backupArchiveCorrupt", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (!header) {
      throw errValidation("errors.backupArchiveCorrupt", { reason: "header" });
    }
    const decryptSource = await resolveDecryptSource(header.kdf.source, {
      password: options.password,
    });
    if (!decryptSource) {
      throw errValidation(
        header.kdf.source === "password" && (!options.password || options.password === "")
          ? "errors.backupWrongPassword"
          : "errors.backupKeyRequired",
      );
    }
    try {
      source = (await decryptBackupContainer(bytes, header, decryptSource)).payload;
    } catch (error) {
      if (error instanceof Error && (error as { messageKey?: string }).messageKey) throw error;
      throw errValidation("errors.backupArchiveCorrupt", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    encrypted = true;
    bytes = source;
  }

  const trailer = extractFilesArchive(bytes);
  if (trailer.kind === "corrupt") {
    throw errValidation("errors.backupArchiveCorrupt", { reason: trailer.reason });
  }
  const sqliteBytes = trailer.kind === "ok" ? bytes.subarray(0, trailer.sqliteEnd) : bytes;

  const header = Buffer.from(sqliteBytes.slice(0, 16)).toString("latin1");
  if (!header.startsWith("SQLite format 3")) throw errValidation("errors.backupInvalidFile");

  const { dirs } = getDbContext();

  // write candidate to temp file inside our data area (same volume → atomic rename)
  const tmpCandidate = path.join(dirs.databaseDir, `candidate-${Date.now()}.db`);
  writeFileSync(tmpCandidate, sqliteBytes);
  try {
    const probe = readCandidateProbe(tmpCandidate);
    if (!probe || probe.integrity !== "ok") {
      throw errValidation("errors.backupIntegrityFailed", { result: probe ? probe.integrity : "unreadable" });
    }
    if (probe.users === 0) throw errValidation("errors.restoreNoUsers");
    if (options.kind === "legacy_import" && probe.version > 0 && probe.version > 5) {
      throw errValidation("errors.backupInvalidFile");
    }

    // Manifest = the candidate's own `files` registry. Verification happens
    // HERE, before any protective snapshot, staging or swap is attempted.
    const manifest = probe.files;
    let archiveEntries: ExtractedFile[] = [];
    let fileAssetsIncluded = false;
    if (trailer.kind === "ok") {
      fileAssetsIncluded = true;
      try {
        archiveEntries = parseFilesArchiveStrict(trailer.archive);
      } catch (error) {
        throw errValidation("errors.backupArchiveCorrupt", {
          reason: error instanceof ArchiveCorruptError ? error.message : String(error),
        });
      }
      const missing: string[] = [];
      const mismatched: string[] = [];
      const byName = new Map(archiveEntries.map((e) => [e.relativePath, e]));
      for (const meta of manifest) {
        const entry = byName.get(meta.relativePath);
        if (!entry) {
          missing.push(meta.relativePath);
          continue;
        }
        if (meta.sha256) {
          const actual = crypto.createHash("sha256").update(entry.bytes).digest("hex");
          if (actual !== meta.sha256) mismatched.push(meta.relativePath);
        }
      }
      if (missing.length > 0 || mismatched.length > 0) {
        throw errValidation("errors.backupFilesIncomplete", {
          missing: missing.length,
          mismatched: mismatched.length,
          files: manifest.length,
        });
      }
    } else if (manifest.length > 0) {
      // Legacy backup (pre-trailer) whose database references files: those
      // bytes are not embedded, so restoring would silently drop them.
      throw errValidation("errors.backupFilesIncomplete", {
        missing: manifest.length,
        mismatched: 0,
        files: manifest.length,
      });
    }

    const beforeCounts = existsSync(dirs.dbFile) ? tableCounts(dirs.dbFile) : null;

    // protective snapshot of current state first (live DB + live Files/)
    let protective: string | null = null;
    if (existsSync(dirs.dbFile)) {
      const outcome = await createServerBackup(actor, "pre_restore");
      protective = outcome.fileName;
    }

    // Stage every archive entry into a sibling staging directory FIRST. The
    // live Files/ tree and the DB are untouched until staging is complete, so
    // a failed extract can never leave a partial restore behind.
    let stagedDir: string | null = null;
    if (archiveEntries.length > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      stagedDir = path.join(path.dirname(dirs.filesDir), `.restore-staging-${stamp}`);
      mkdirSync(stagedDir, { recursive: true });
      try {
        stageArchiveEntries(stagedDir, archiveEntries);
      } catch (error) {
        try {
          rmSync(stagedDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
        throw errValidation("errors.backupRestoreFailed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Swap the whole Files/ tree BEFORE adopting the DB: if the swap fails we
    // roll back and abort with the live DB still fully intact.
    let filesSwapped = true; // trivially true when there is nothing to swap
    if (stagedDir) {
      const swap = swapInStagedFiles(dirs.filesDir, stagedDir);
      if (!swap.ok) {
        logLine(`restore: file swap failed: ${swap.reason}`);
        throw errValidation("errors.backupRestoreFailed", { reason: swap.reason ?? "file swap failed" });
      }
      // Drop any `.trash/` leftovers from the OLD tree that could have been
      // carried over, then sweep pending-delete markers of the new one.
      try {
        filesService.purgeTrash();
      } catch (error) {
        logLine(`restore: purgeTrash failed: ${String(error)}`);
      }
      try {
        const swept = filesService.sweepPendingDeletes();
        if (swept > 0) logLine(`restore: swept ${swept} pending-delete marker(s)`);
      } catch (error) {
        logLine(`restore: sweep failed: ${String(error)}`);
      }
    }

    adoptDatabaseFile(tmpCandidate);

    const afterCounts = tableCounts(dirs.dbFile);
    const filesRestored = stagedDir ? archiveEntries.length : 0;
    const filesMissing = stagedDir ? 0 : manifest.length;
    logLine(
      `${options.kind} completed; protective=${protective ?? "none"}; files restored=${filesRestored}/${manifest.length}`,
    );
    return {
      schemaVersion: probe.version,
      formatVersion: trailer.kind === "ok" ? BACKUP_FORMAT_VERSION : 0,
      encrypted,
      cipher: encrypted ? "aes-256-gcm" : null,
      protectedBackupFileName: protective,
      before: beforeCounts,
      after: afterCounts,
      fileAssetsIncluded,
      fileAssetsExpected: manifest.length,
      fileAssetsStored: archiveEntries.length,
      fileAssetsVerified: manifest.length,
      filesRestored,
      filesMissing,
      integrityStatus: "ok",
      fullyVerified: manifest.length === 0 || filesSwapped,
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