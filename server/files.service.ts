import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";

/**
 * Filesystem-backed storage registry (spec PART 5):
 *   %LOCALAPPDATA%\GymSystem\Files\<kind>\<id>
 * The database stores metadata only; bytes live on disk and are covered by
 * folder-level backup/restore.
 */

let filesRoot = path.join(os.tmpdir(), "gymsystem-files");

export function setFilesRoot(root: string): void {
  filesRoot = root;
  mkdirSync(filesRoot, { recursive: true });
}

function ensureKindDir(kind: string): string {
  const dir = path.join(filesRoot, kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const MIME_RULES: Record<string, readonly string[]> = {
  member_photo: ["image/jpeg", "image/png", "image/webp"],
  inbody_report: ["application/pdf", "image/jpeg", "image/png"],
  expense_attachment: ["application/pdf", "image/jpeg", "image/png"],
  other: ["application/pdf", "image/jpeg", "image/png"],
};

export interface SaveFileInput {
  kind: keyof typeof MIME_RULES;
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

export function saveFile(db: Db, actor: ServiceActor, input: SaveFileInput): {
  id: string;
  kind: string;
  sizeBytes: number;
} {
  requirePermission(actor, permissionForKind(input.kind));
  const rules = MIME_RULES[input.kind];
  if (!rules) throw errValidation("errors.file.kindInvalid");
  if (!rules.includes(input.mimeType)) throw errValidation("errors.file.mimeInvalid");
  if (!input.content || input.content.length === 0) throw errValidation("errors.file.empty");
  if (input.content.length > MAX_BYTES) throw errValidation("errors.file.tooLarge");
  if (!input.originalName.trim()) throw errValidation("errors.file.nameRequired");

  const id = crypto.randomUUID();
  const dir = ensureKindDir(input.kind);
  const ext = path.extname(input.originalName).slice(0, 10).replace(/[^.\w]/g, "");
  const safeName = `${id}${ext}`;
  writeFileSync(path.join(dir, safeName), input.content);

  db.run(
    "INSERT INTO files (id, kind, original_name, mime_type, size_bytes, sha256, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.kind,
      input.originalName.trim().slice(0, 200),
      input.mimeType,
      input.content.length,
      crypto.createHash("sha256").update(input.content).digest("hex"),
      actor.userId,
      nowStamp(),
    ],
  );
  return { id, kind: input.kind, sizeBytes: input.content.length };
}

export interface FileMeta {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function getFileMeta(db: Db, fileId: string): FileMeta {
  const row = db.first<Row>("SELECT * FROM files WHERE id = ?", [fileId]);
  if (!row) throw errNotFound("errors.file.notFound");
  return {
    id: str(row.id),
    kind: str(row.kind),
    originalName: str(row.original_name),
    mimeType: str(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    createdAt: str(row.created_at),
  };
}

/** Read bytes for serving over HTTP. Caller enforces authz per usage context. */
export function readFileBytes(db: Db, fileId: string): { meta: FileMeta; bytes: Uint8Array } {
  const meta = getFileMeta(db, fileId);
  const p = path.join(filesRoot, meta.kind, `${meta.id}${extFor(meta.originalName)}`);
  if (!existsSync(p)) throw errNotFound("errors.file.notFound");
  return { meta, bytes: new Uint8Array(readFileSync(p)) };
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function extFor(originalName: string): string {
  return path.extname(originalName).slice(0, 10);
}

/** Best-effort disk removal once the registry row is gone (purge cleanup). */
export function unlinkFileBytes(meta: FileMeta): void {
  const p = path.join(filesRoot, meta.kind, `${meta.id}${extFor(meta.originalName)}`);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best effort */
  }
}

/** Replace (delete old bytes + row handled by caller) helper for photos etc. */
export function deleteFile(db: Db, actor: ServiceActor, fileId: string): void {
  const meta = getFileMeta(db, fileId);
  requirePermission(actor, permissionForKind(meta.kind));
  const p = path.join(filesRoot, meta.kind, `${meta.id}${extFor(meta.originalName)}`);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best effort */
  }
  db.run("DELETE FROM files WHERE id = ?", [fileId]);
}
