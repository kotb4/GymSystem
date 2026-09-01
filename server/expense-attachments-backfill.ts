import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { Db } from "../src/db/engine";

/**
 * Migrate any leftover BLOB rows from the legacy `expense_attachments` table
 * onto the filesystem under `<dataRoot>/Files/expense_attachment/<id>.<ext>`,
 * inserting a matching row in the `files` registry. This is ADR-018 §8 —
 * formerly part of the v26 callback but split out so that `migrations.ts`
 * stays free of node-only globals and the frontend tsconfig still passes.
 *
 * Idempotent: rows already present in `files` are skipped, so this is safe
 * to call on every boot. Crashes between the DB write and the disk write
 * leave the registry inconsistent; on the next boot the row in `files` is
 * present so the legacy row will be skipped — but the bytes are missing on
 * disk. To minimise that window we do the registry insert LAST.
 */
export interface BackfillReport {
  scanned: number;
  imported: number;
  failed: number;
  skippedExisting: number;
}

function resolveDataRoot(): string {
  const override = process.env.GYMSYSTEM_DATA_DIR;
  if (override && override.trim() !== "") return path.resolve(override.trim());
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "GymSystem");
  }
  return path.join(os.homedir(), ".gymsystem");
}

export function runExpenseAttachmentsBackfill(db: Db): BackfillReport {
  const hasTable = db.first<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = 'expense_attachments'",
  );
  if (!hasTable || Number(hasTable.cnt) === 0) {
    return { scanned: 0, imported: 0, failed: 0, skippedExisting: 0 };
  }
  const legacy = db.all<{
    id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    data: Uint8Array | null;
    created_by: string | null;
    created_at: string;
  }>(
    "SELECT id, file_name, mime_type, size_bytes, data, created_by, created_at FROM expense_attachments",
  );
  const report: BackfillReport = {
    scanned: legacy.length,
    imported: 0,
    failed: 0,
    skippedExisting: 0,
  };
  if (legacy.length === 0) return report;

  const filesDir = path.join(resolveDataRoot(), "Files");
  const kindDir = path.join(filesDir, "expense_attachment");
  if (!existsSync(filesDir)) mkdirSync(filesDir, { recursive: true });
  if (!existsSync(kindDir)) mkdirSync(kindDir, { recursive: true });
  const filesRootWithSep = filesDir.endsWith(path.sep) ? filesDir : filesDir + path.sep;

  for (const row of legacy) {
    const existing = db.first<{ id: string }>("SELECT id FROM files WHERE id = ?", [row.id]);
    if (existing) {
      report.skippedExisting += 1;
      continue;
    }
    const ext = String(row.file_name ?? "").split(".").pop()?.replace(/[^\w]/g, "").slice(0, 10) ?? "";
    const relativePath = `expense_attachment/${row.id}${ext ? "." + ext : ""}`;
    const target = path.join(filesDir, relativePath);
    if (target !== filesDir && !target.startsWith(filesRootWithSep)) {
      report.failed += 1;
      process.stderr.write(
        `[backfill] refused to write ${target} (outside Files root)\n`,
      );
      continue;
    }
    // Atomic write: tmp + rename so partial files never appear at canonical path.
    const tmp = `${target}.pending-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmp, row.data ?? Buffer.alloc(0));
      renameSync(tmp, target);
    } catch (error) {
      try { unlinkSync(tmp); } catch { /* best effort */ }
      report.failed += 1;
      process.stderr.write(`[backfill] failed to write ${target}: ${String(error)}\n`);
      continue;
    }
    db.run(
      "INSERT OR IGNORE INTO files (id, kind, original_name, mime_type, size_bytes, sha256, relative_path, created_by, created_at)\n" +
        "VALUES (?, 'expense_attachment', ?, ?, ?, '', ?, ?, ?)",
      [
        row.id,
        String(row.file_name ?? "").slice(0, 200),
        String(row.mime_type ?? "application/octet-stream"),
        Number(row.size_bytes ?? 0),
        relativePath,
        row.created_by ?? null,
        String(row.created_at ?? new Date().toISOString()),
      ],
    );
    report.imported += 1;
  }
  if (report.imported > 0 || report.failed > 0) {
    process.stderr.write(
      `[backfill] v26-style expense_attachments: imported=${report.imported} skipped=${report.skippedExisting} failed=${report.failed}\n`,
    );
  }
  return report;
}