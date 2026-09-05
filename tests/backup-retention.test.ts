import { describe, expect, it, beforeEach } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import {
  selectBackupsToKeep,
  pruneBackupsByPolicy,
  isoWeekKey,
  recordBackupEntry,
  pruneBackups,
} from "@/core/services/backup.service";
import { parseRetentionPolicy, DEFAULT_BACKUP_RETENTION_POLICY } from "@/core/services/settings.service";
import { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

/**
 * TASK-042 tiered retention (daily/weekly/monthly + safety cap) over the
 * `backups_log` table. Uses direct inserts so retention math is isolated from
 * the snapshot filesystem work.
 */
let db: Db;
let owner: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  owner = buildActor(
    await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    }),
  );
});

function insertBackup(kind: string, createdAt: string): void {
  db.run(
    "INSERT INTO backups_log (kind, file_name, size_bytes, checksum, verified, encrypted, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [kind, `gympro-backup-${createdAt.replace(/[- :]/g, "").slice(0, 14)}.gymbak`, 10, "x", 1, 0, owner.userId, createdAt],
  );
}

describe("isoWeekKey", () => {
  it("computes ISO weeks at noon local time (timezone-stable)", () => {
    expect(isoWeekKey("2024-01-01 12:00:00")).toBe("2024-W01");
    expect(isoWeekKey("2024-01-08 12:00:00")).toBe("2024-W02");
    expect(isoWeekKey("2024-12-30 12:00:00")).toBe("2025-W01");
    expect(isoWeekKey("2024-12-29 12:00:00")).toBe("2024-W52");
    expect(isoWeekKey("2026-09-05 12:00:00")).toBe("2026-W36");
  });
});

describe("retention policy parsing", () => {
  it("parses valid JSON and falls back to defaults for garbage", () => {
    expect(parseRetentionPolicy('{"daily":3,"weekly":4,"monthly":2}')).toEqual({ daily: 3, weekly: 4, monthly: 2 });
    expect(parseRetentionPolicy("not-json")).toEqual(DEFAULT_BACKUP_RETENTION_POLICY);
    expect(parseRetentionPolicy('{"daily":999}')).toEqual({
      daily: DEFAULT_BACKUP_RETENTION_POLICY.daily,
      weekly: DEFAULT_BACKUP_RETENTION_POLICY.weekly,
      monthly: DEFAULT_BACKUP_RETENTION_POLICY.monthly,
    });
    expect(parseRetentionPolicy(null)).toEqual(DEFAULT_BACKUP_RETENTION_POLICY);
  });
});

describe("selectBackupsToKeep (tiered retention)", () => {
  it("always keeps the newest N regardless of buckets (safety cap)", () => {
    const rows = [
      { id: 1, createdAt: "2026-01-01 10:00:00" },
      { id: 2, createdAt: "2026-01-02 10:00:00" },
      { id: 3, createdAt: "2026-01-03 10:00:00" },
      { id: 4, createdAt: "2026-01-04 10:00:00" },
    ];
    const keep = selectBackupsToKeep(rows, { daily: 0, weekly: 0, monthly: 0 }, 2);
    expect([...keep].sort()).toEqual([3, 4]);
  });

  it("keeps the newest backup of each of the last `daily` days", () => {
    const rows = [];
    for (let day = 1; day <= 10; day += 1) {
      // two backups per day
      rows.push({ id: rows.length, createdAt: `2026-01-${String(day).padStart(2, "0")} 09:00:00` });
      rows.push({ id: rows.length, createdAt: `2026-01-${String(day).padStart(2, "0")} 18:00:00` });
    }
    const keep = selectBackupsToKeep(rows, { daily: 3, weekly: 0, monthly: 0 }, 1);
    const keptRow = (id: number) => rows.find((r) => r.id === id);
    // Last day has two identical-... entries: both same id? no — unique ids.
    // The newest per-day ids: day10->19, day9->17, day8->15; plus safety (last id 19).
    expect(keep.has(19)).toBe(true);
    expect(keep.has(15)).toBe(true);
    expect(keep.has(17)).toBe(true);
    // Older days must go.
    expect(keep.has(1)).toBe(false);
    expect(keep.has(13)).toBe(false);
    // Safety cap never drops the last row.
    expect([...keep].sort().at(-1)).toBe(19);
    void keptRow;
  });

  it("keeps one per month when daily/weekly are zeroed from a large span", () => {
    const rows = [];
    for (let month = 1; month <= 24; month += 1) {
      const m = String(month).padStart(2, "0");
      rows.push({ id: rows.length, createdAt: `2025-${m}-15 10:00:00` });
    }
    const keep = selectBackupsToKeep(rows, { daily: 0, weekly: 0, monthly: 12 }, 1);
    expect(keep.size).toBe(12);
    // Newest 12 months kept (months 13..24), oldest dropped.
    expect(keep.has(0)).toBe(false);
    expect(keep.has(11)).toBe(false);
    expect(keep.has(12)).toBe(true);
    expect(keep.has(23)).toBe(true);
  });
});

describe("pruneBackupsByPolicy", () => {
  it("deletes only non-kept rows and returns the removed file names", () => {
    insertBackup("manual", "2026-01-01 10:00:00");
    insertBackup("manual", "2026-01-02 10:00:00");
    insertBackup("manual", "2026-01-03 10:00:00");
    insertBackup("manual", "2026-01-04 10:00:00");

    const removed = pruneBackupsByPolicy(db, { daily: 2, weekly: 1, monthly: 1 }, 1);
    // daily:2 keeps days 04 + 03 (newest per day); weekly/monthly re-keep day 04.
    expect(removed.length).toBe(2);
    const names = db.all<{ file_name: string }>("SELECT file_name FROM backups_log ORDER BY id");
    expect(names.length).toBe(2);
    expect(names[names.length - 1].file_name).toContain("20260104");
  });

  it("keeps pruneBackups (legacy count cap) for backward compatibility", () => {
    for (let i = 1; i <= 6; i += 1) {
      insertBackup("manual", `2026-02-${String(i).padStart(2, "0")} 10:00:00`);
    }
    const removed = pruneBackups(db, 3);
    expect(removed.length).toBe(3);
    expect(db.count("SELECT COUNT(*) FROM backups_log")).toBe(3);
  });
});

describe("recordBackupEntry for new kinds", () => {
  it("persists kind pre_purge and the encrypted flag", async () => {
    const entry = await recordBackupEntry(db, owner, {
      kind: "pre_purge",
      fileName: "protect.gymbak",
      sizeBytes: 42,
      checksum: "x",
      verified: true,
      encrypted: true,
    });
    expect(entry.kind).toBe("pre_purge");
    expect(entry.encrypted).toBe(true);
    const row = db.first<{ kind: string; encrypted: number }>(
      "SELECT kind, encrypted FROM backups_log WHERE file_name = 'protect.gymbak'",
    );
    expect(row?.kind).toBe("pre_purge");
    expect(row?.encrypted).toBe(1);
  });
});