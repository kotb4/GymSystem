import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  statSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";

/**
 * Filesystem-backed storage registry (ADR-018).
 *
 * Layout (POSIX-relative, stored verbatim in `files.relative_path`):
 *   <filesRoot>/<kind>/<id><ext>
 *
 * - The bytes live on disk; the database stores metadata only.
 * - All filesystem access resolves through `resolveSafe(relative)` which
 *   enforces `path.resolve(root, relative)` stays under `<root>`. Any
 *   attempt to escape throws `errors.file.pathEscape`.
 * - Boot path (`server/context.ts::openDatabase`) MUST call `setFilesRoot`
 *   before any service uses the files API; otherwise the API throws
 *   `errors.file.rootNotConfigured` instead of leaking writes to a tmp dir.
 */

let filesRoot: string | null = null;

export function setFilesRoot(root: string): void {
  filesRoot = path.resolve(root);
  mkdirSync(filesRoot, { recursive: true });
}

export function getFilesRoot(): string | null {
  return filesRoot;
}

/** Test-only: forget the configured root. Never call in production code. */
export function _resetFilesRootForTests(): void {
  filesRoot = null;
}

function ensureKindDir(kind: string): string {
  if (!filesRoot) throw errValidation("errors.file.rootNotConfigured");
  const dir = path.join(filesRoot, kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const KINDS = ["member_photo", "inbody_report", "expense_attachment", "other"] as const;
export type FileKind = (typeof KINDS)[number];

const MIME_RULES: Record<FileKind, readonly string[]> = {
  member_photo: ["image/jpeg", "image/png", "image/webp"],
  inbody_report: ["application/pdf", "image/jpeg", "image/png"],
  expense_attachment: ["application/pdf", "image/jpeg", "image/png"],
  other: ["application/pdf", "image/jpeg", "image/png"],
};

/**
 * Hand-written magic-byte sniffers for the four supported MIMEs. We avoid a
 * new dependency to honour the project's offline-first rule (ADR-018 §4).
 * Each returns true iff the first 4..12 bytes match the spec signature.
 */
function sniffMagic(mime: string, head: Uint8Array): boolean {
  if (head.length < 4) return false;
  switch (mime) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return (
        head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
        head.length >= 8 &&
        head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
      );
    case "image/webp":
      // RIFF....WEBP
      return (
        head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head.length >= 12 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
      );
    case "application/pdf":
      return (
        head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
      );
    default:
      return false;
  }
}

/** Strip path separators, control chars, and Windows-forbidden filename chars. */
export function sanitizeFilename(input: string): string {
  let name = (input ?? "").toString().normalize("NFC");
  // Remove control characters and Windows-forbidden chars.
  name = name.replace(/[\x00-\x1f\x7f/\\:*?"<>|\t\r\n]/g, "_");
  // Collapse leading dots (hidden files on POSIX, hidden on Windows too).
  while (name.startsWith(".")) name = "." + name.replace(/^\.+/, "");
  name = name.replace(/\s+/g, " ").trim();
  if (name.length > 200) name = name.slice(0, 200);
  if (name === "." || name === "..") name = "_";
  return name || "file";
}

/** Normalize a stored `relative_path` to forward slashes, no leading slash, no `..`. */
function normalizeRelative(input: string): string {
  let p = (input ?? "").toString().replace(/\\/g, "/").trim();
  // strip any leading slashes
  while (p.startsWith("/")) p = p.slice(1);
  // reject obvious traversal early (defence in depth; resolveSafe also guards)
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw errValidation("errors.file.pathEscape");
    parts.push(seg);
  }
  return parts.join("/");
}

/** Throw unless `relative` (already normalized) resolves under `filesRoot`. */
function resolveSafe(relative: string): string {
  if (!filesRoot) throw errValidation("errors.file.rootNotConfigured");
  const normalized = normalizeRelative(relative);
  if (!normalized) throw errValidation("errors.file.pathEscape");
  const resolved = path.resolve(filesRoot, normalized);
  const rootWithSep = filesRoot.endsWith(path.sep) ? filesRoot : filesRoot + path.sep;
  if (resolved !== filesRoot && !resolved.startsWith(rootWithSep)) {
    throw errValidation("errors.file.pathEscape");
  }
  return resolved;
}

/**
 * Returns true iff `input` is a safe *relative* path for writing under a
 * files root: non-empty, no leading slash, no `..`/`.` segments, no
 * backslash tricks, no drive prefixes and no control characters. This is a
 * purely structural check (no filesystem access), shared between the backup
 * writer (archive keys) and the restore extractor (staging directory) so a
 * hostile `relative_path` can never escape the root.
 */
export function isSafeRelativePath(input: string): boolean {
  const normalized = String(input ?? "").replace(/\\/g, "/").trim();
  if (normalized === "") return false;
  if (normalized.startsWith("/")) return false;
  const parts = normalized.split("/");
  for (const segment of parts) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (/^[a-zA-Z]:/.test(segment)) return false;
    if (/[\x00-\x1f]/.test(segment)) return false;
  }
  return true;
}

export interface SaveFileInput {
  kind: FileKind;
  originalName: string;
  mimeType: string;
  /** raw file bytes (NOT base64) */
  content: Uint8Array;
}

export function permissionForKind(kind: string): Parameters<typeof requirePermission>[1] {
  switch (kind) {
    case "member_photo":
      return "members.edit";
    case "inbody_report":
      return "assessments.manage";
    case "expense_attachment":
      return "expenses.attachments";
    default:
      return "settings.edit";
  }
}

export function saveFile(
  db: Db,
  actor: ServiceActor,
  input: SaveFileInput,
): { id: string; kind: string; relativePath: string; sizeBytes: number } {
  requirePermission(actor, permissionForKind(input.kind));
  if (!KINDS.includes(input.kind)) throw errValidation("errors.file.kindInvalid");
  const rules = MIME_RULES[input.kind];
  if (!rules.includes(input.mimeType)) throw errValidation("errors.file.mimeInvalid");
  if (!input.content || input.content.length === 0) throw errValidation("errors.file.empty");
  if (input.content.length > MAX_BYTES) throw errValidation("errors.file.tooLarge");

  const cleanName = sanitizeFilename(input.originalName);
  if (!cleanName) throw errValidation("errors.file.nameRequired");

  // Magic-byte sniffing against the declared MIME (ADR-018 §4).
  const sniffLen = Math.min(12, input.content.length);
  const head = input.content.subarray(0, sniffLen);
  if (!sniffMagic(input.mimeType, head)) {
    throw errValidation("errors.file.mimeMismatch", { mime: input.mimeType });
  }

  const id = crypto.randomUUID();
  // ensure the kind directory exists (side effect of ensureKindDir; the actual
  // write target is derived from `resolveSafe` below).
  ensureKindDir(input.kind);
  const ext = path.extname(cleanName).slice(0, 10).replace(/[^.\w]/g, "") || "";
  const safeName = `${id}${ext}`;
  const relativePath = `${input.kind}/${safeName}`;
  // Defensive: re-resolve to confirm before writing.
  const target = resolveSafe(relativePath);

  // Write atomically: tmp + rename, so partial files never appear under
  // the canonical name (matters for the backup walk and for concurrent reads).
  const tmp = `${target}.pending-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, input.content);
  try {
    renameSync(tmp, target);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }

  const sha256 = crypto.createHash("sha256").update(input.content).digest("hex");
  db.run(
    "INSERT INTO files (id, kind, original_name, mime_type, size_bytes, sha256, relative_path, created_by, created_at)\n" +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.kind,
      cleanName,
      input.mimeType,
      input.content.length,
      sha256,
      relativePath,
      actor.userId,
      nowStamp(),
    ],
  );
  return { id, kind: input.kind, relativePath, sizeBytes: input.content.length };
}

export interface FileMeta {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  relativePath: string;
  createdAt: string;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function rowToMeta(row: Row): FileMeta {
  const relativePath = str(row.relative_path);
  return {
    id: str(row.id),
    kind: str(row.kind),
    originalName: str(row.original_name),
    mimeType: str(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: str(row.sha256),
    relativePath,
    createdAt: str(row.created_at),
  };
}

/**
 * Resolve a meta row into an absolute path under filesRoot, then assert the
 * file exists. Returns the path or throws `errors.file.notFound` if either
 * the registry is missing or the bytes are gone.
 */
function resolveExistingPath(meta: FileMeta): string {
  const target = resolveSafe(meta.relativePath);
  if (!existsSync(target)) {
    // Missing-on-disk is distinct from missing-registry; both surface as
    // notFound to the caller but we log the distinction for ops.
    process.stderr.write(
      `[files] meta ${meta.id} references ${meta.relativePath} but bytes are missing\n`,
    );
    throw errNotFound("errors.file.notFound");
  }
  return target;
}

export function getFileMeta(db: Db, fileId: string): FileMeta {
  const row = db.first<Row>("SELECT * FROM files WHERE id = ?", [fileId]);
  if (!row) throw errNotFound("errors.file.notFound");
  return rowToMeta(row);
}

/** Read bytes for serving over HTTP. Caller enforces authz per usage context. */
export function readFileBytes(db: Db, fileId: string): { meta: FileMeta; bytes: Uint8Array } {
  const meta = getFileMeta(db, fileId);
  const target = resolveExistingPath(meta);
  return { meta, bytes: new Uint8Array(readFileSync(target)) };
}

/**
 * Best-effort disk removal once the registry row is gone. Uses the trash
 * directory under filesRoot so a crash here is recoverable. Always swallows
 * ENOENT; surfaces other errors to stderr for ops.
 *
 * Crash-safety: writes a sidecar `<file>.pending-delete` marker BEFORE moving
 * the file to `.trash/`. `sweepPendingDeletes()` (called on boot and after
 * every commit) retries any marker whose target still exists on disk, then
 * removes the marker. So if the process dies between the marker write and
 * the rename, the next sweep finishes the unlink.
 */
export function unlinkFileBytes(meta: FileMeta): void {
  if (!filesRoot) return;
  let target: string;
  try {
    target = resolveSafe(meta.relativePath);
  } catch {
    return; // path already escapes — refuse silently
  }
  if (!existsSync(target)) return;

  const trashDir = path.join(filesRoot, ".trash");
  mkdirSync(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(target);
  const trashTarget = path.join(trashDir, `${stamp}-${baseName}`);

  // Write sidecar marker first; if we crash before the rename, the sweep
  // recovers by repeating the operation.
  const marker = `${target}.pending-delete`;
  let markerWritten = false;
  try {
    writeFileSync(
      marker,
      JSON.stringify({
        id: meta.id,
        kind: meta.kind,
        relativePath: meta.relativePath,
        trashTarget,
        enqueuedAt: nowStamp(),
      }),
      "utf8",
    );
    markerWritten = true;
  } catch (error) {
    process.stderr.write(`[files] failed to write pending-delete marker ${marker}: ${String(error)}\n`);
  }

  try {
    renameSync(target, trashTarget);
  } catch (error) {
    process.stderr.write(`[files] failed to trash ${target}: ${String(error)}\n`);
    if (markerWritten) {
      try { unlinkSync(marker); } catch { /* best effort */ }
    }
    return;
  }

  // Best-effort cleanup of the marker. If we crash before this line runs, the
  // sweep on next boot will see the marker + the now-missing target and just
  // remove the marker (it checks target existence first).
  if (markerWritten) {
    try { unlinkSync(marker); } catch { /* best effort */ }
  }
}

/**
 * Sweep any `.pending-delete` markers left behind by an interrupted unlink.
 * Safe to call on boot. Returns the number of sidecars processed (recovered
 * or cleared). Per-kinders are scanned in the four known kinds plus the root
 * trash directory itself.
 */
export function sweepPendingDeletes(): number {
  if (!filesRoot) return 0;
  let processed = 0;
  const dirs = [...KINDS, ".trash"];
  for (const kind of dirs) {
    const dir = path.join(filesRoot, kind);
    if (!existsSync(dir)) continue;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".pending-delete")) continue;
      const marker = path.join(dir, entry);
      // Recover the original filename (strip trailing ".pending-delete").
      const original = marker.slice(0, -".pending-delete".length);
      try {
        if (existsSync(original)) {
          // target still exists — retry the trash move
          const trashDir = path.join(filesRoot, ".trash");
          mkdirSync(trashDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const baseName = path.basename(original);
          const trashTarget = path.join(trashDir, `${stamp}-recover-${baseName}`);
          try {
            renameSync(original, trashTarget);
          } catch (error) {
            process.stderr.write(`[files] sweep failed to trash ${original}: ${String(error)}\n`);
            // Don't remove the marker; try again next boot.
            continue;
          }
        }
        // Target is gone (or just moved). Clear the marker.
        try { unlinkSync(marker); } catch { /* best effort */ }
        processed += 1;
      } catch (error) {
        process.stderr.write(`[files] sweep failed on ${marker}: ${String(error)}\n`);
      }
    }
  }
  return processed;
}

/**
 * Compute the relative path a registry row would use for `kind` + an `id`,
 * honouring the on-disk filename rules. Used by callers that have to bridge
 * from older code paths (notably the v26 BLOB backfill).
 */
export function relativePathFor(kind: FileKind, id: string, originalName: string): string {
  const cleanName = sanitizeFilename(originalName);
  const ext = path.extname(cleanName).slice(0, 10).replace(/[^.\w]/g, "") || "";
  return `${kind}/${id}${ext}`;
}

/**
 * Write raw bytes to disk under `<filesRoot>/<kind>/<id><ext>` and INSERT a
 * matching `files` registry row. Used by the BLOB-backfill migration (v26)
 * and by tooling that already has the bytes in memory. Atomically renames a
 * tmp file so a partial write never appears at the canonical path.
 */
export function saveRawBytes(
  db: Db,
  actor: ServiceActor,
  args: {
    id: string;
    kind: FileKind;
    originalName: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): FileMeta {
  requirePermission(actor, permissionForKind(args.kind));
  if (!KINDS.includes(args.kind)) throw errValidation("errors.file.kindInvalid");
  const rules = MIME_RULES[args.kind];
  if (!rules.includes(args.mimeType)) throw errValidation("errors.file.mimeInvalid");
  if (!args.bytes || args.bytes.length === 0) throw errValidation("errors.file.empty");
  if (args.bytes.length > MAX_BYTES) throw errValidation("errors.file.tooLarge");

  const cleanName = sanitizeFilename(args.originalName);
  if (!cleanName) throw errValidation("errors.file.nameRequired");

  // Magic-byte sniff (same rules as saveFile).
  const sniffLen = Math.min(12, args.bytes.length);
  const head = args.bytes.subarray(0, sniffLen);
  if (!sniffMagic(args.mimeType, head)) {
    throw errValidation("errors.file.mimeMismatch", { mime: args.mimeType });
  }

  const ext = path.extname(cleanName).slice(0, 10).replace(/[^.\w]/g, "") || "";
  const relativePath = `${args.kind}/${args.id}${ext}`;
  const dir = ensureKindDir(args.kind);
  const target = path.join(dir, `${args.id}${ext}`);
  // Defensive re-check via resolveSafe (defence in depth — relativePath is
  // already clean because kind is whitelisted).
  resolveSafe(relativePath);

  const tmp = `${target}.pending-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, args.bytes);
  try {
    renameSync(tmp, target);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }

  const sha256 = crypto.createHash("sha256").update(args.bytes).digest("hex");
  db.run(
    "INSERT INTO files (id, kind, original_name, mime_type, size_bytes, sha256, relative_path, created_by, created_at)\n" +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      args.id,
      args.kind,
      cleanName,
      args.mimeType,
      args.bytes.length,
      sha256,
      relativePath,
      actor.userId,
      nowStamp(),
    ],
  );

  const row = db.first<Row>("SELECT * FROM files WHERE id = ?", [args.id]);
  if (!row) throw errNotFound("errors.file.notFound");
  return rowToMeta(row);
}

/**
 * Empty the on-disk `.trash/` directory. Used by the restore sweep after
 * extracting a fresh archive so we don't accumulate centuries-old orphans.
 * Best-effort; never throws.
 */
export function purgeTrash(): number {
  if (!filesRoot) return 0;
  const trashDir = path.join(filesRoot, ".trash");
  if (!existsSync(trashDir)) return 0;
  let removed = 0;
  try {
    for (const entry of readdirSync(trashDir)) {
      try { rmSync(path.join(trashDir, entry), { recursive: true, force: true }); removed += 1; } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
  return removed;
}

/**
 * Read the raw bytes for a known registry id without going through the
 * permission gate. Used by tooling (backup walker, restore extractor,
 * tests) that already authorised the caller.
 */
export function readBytesForMeta(meta: FileMeta): Uint8Array {
  const target = resolveExistingPath(meta);
  return new Uint8Array(readFileSync(target));
}

/**
 * Delete the registry row AND its bytes. Caller is responsible for any
 * transactional ordering (the typical caller is `purgeMember`, which calls
 * this AFTER committing, then a periodic sweep catches any `.pending-delete`
 * leftovers from crashes).
 */
export function deleteFile(db: Db, actor: ServiceActor, fileId: string): void {
  const meta = getFileMeta(db, fileId);
  requirePermission(actor, permissionForKind(meta.kind));
  unlinkFileBytes(meta);
  db.run("DELETE FROM files WHERE id = ?", [fileId]);
}

/**
 * Compute the absolute path a registry row currently lives at, without
 * touching the disk. Useful for backup/restore tooling.
 */
export function absolutePathForMeta(meta: FileMeta): string {
  return resolveSafe(meta.relativePath);
}

/** List every file row as FileMeta (used by backup tooling). */
export function listAllFiles(db: Db): FileMeta[] {
  return db.all<Row>("SELECT * FROM files ORDER BY created_at ASC").map(rowToMeta);
}

/**
 * Sweep leftover `.pending-*` temp files left behind by interrupted writes
 * (process crash between `writeFileSync(tmp)` and `renameSync`). Safe to call
 * on boot; no-op when nothing is pending.
 */
export function sweepPendingWrites(): number {
  if (!filesRoot) return 0;
  let removed = 0;
  for (const kind of KINDS) {
    const dir = path.join(filesRoot, kind);
    if (!existsSync(dir)) continue;
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      for (const entry of readdirSync(dir)) {
        if (entry.includes(".pending-")) {
          try { unlinkSync(path.join(dir, entry)); removed++; } catch { /* best effort */ }
        }
      }
    } catch { /* best effort */ }
  }
  return removed;
}

/** Diagnostic: report on-disk size under filesRoot (best-effort, used by ops). */
export function diskStats(): { bytes: number; fileCount: number } {
  if (!filesRoot) return { bytes: 0, fileCount: 0 };
  let bytes = 0;
  let fileCount = 0;
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      let s: import("node:fs").Stats;
      try { s = statSync(p); } catch { continue; }
      if (s.isFile()) { bytes += s.size; fileCount++; }
      else if (s.isDirectory()) walk(p);
    }
  };
  walk(filesRoot);
  return { bytes, fileCount };
}