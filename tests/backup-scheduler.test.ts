import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/core/permissions";
import { writeSettingInternal, SETTING_KEYS } from "@/core/services/settings.service";

/**
 * TASK-042 automatic backup scheduler:
 *  - single-flight + idempotent start (no duplicate interval instances);
 *  - skips when disabled, interval 0, or the system has no owner;
 *  - a due run creates exactly one `auto` snapshot via createServerBackup;
 *  - a second immediate run is NOT due and creates nothing.
 */
interface BootedCtx {
  db: {
    run(sql: string, params?: unknown[]): unknown;
    count(sql: string, params?: unknown[]): number;
    first<T = unknown>(sql: string, params?: unknown[]): T | null;
    transaction<T>(fn: () => T): T;
  };
  driver: { close(): void; exportBytes(): Uint8Array | null };
  dirs: { dbFile: string; backupsDir: string; filesDir: string; databaseDir: string; configDir: string };
}

const cleanups: Array<() => void> = [];

async function boot(dir: string): Promise<{ ctx: BootedCtx; scheduler: typeof import("../server/backup-scheduler") }> {
  process.env.GYMSYSTEM_DATA_DIR = dir;
  process.env.GYMSYSTEM_SECRET_STORE = "file";
  process.env.GYM_SEED_DEMO = "";
  delete process.env.VITE_SEED_DEMO;
  vi.resetModules();
  const contextModule = await import("../server/context");
  const ctx = contextModule.openDatabase() as BootedCtx;
  cleanups.push(() => {
    try {
      ctx.driver.close();
    } catch {
      /* already closed */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  const scheduler = await import("../server/backup-scheduler");
  return { ctx, scheduler };
}

async function setupOwner(ctx: BootedCtx): Promise<ServiceActor> {
  const { setup, buildActor } = await import("@/core/services/auth.service");
  const user = await setup(ctx.db as never, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  return buildActor(user);
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  delete process.env.GYMSYSTEM_DATA_DIR;
});

describe("automatic backup scheduler (TASK-042)", () => {
  it("startBackupScheduler is idempotent and stop is safe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-sched-a-"));
    const { scheduler } = await boot(dir);
    scheduler._resetBackupSchedulerForTest();
    expect(() => {
      scheduler.startBackupScheduler();
      scheduler.startBackupScheduler();
      scheduler.startBackupScheduler();
    }).not.toThrow();
    expect(() => scheduler.stopBackupScheduler()).not.toThrow();
    scheduler._resetBackupSchedulerForTest();
  });

  it("runs an auto backup when due and not again immediately", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-sched-b-"));
    const { ctx, scheduler } = await boot(dir);
    const owner = await setupOwner(ctx);
    void owner;

    // Defaults from migration v31: enabled, 24 h interval, no auto entry yet → due.
    const created = await scheduler.runAutoBackupOnce();
    expect(created).toBe(true);

    const autoCount = ctx.db.count("SELECT COUNT(*) FROM backups_log WHERE kind = 'auto'");
    expect(autoCount).toBe(1);

    // Immediately after creation it is not due again (no duplicate snapshot).
    expect(await scheduler.runAutoBackupOnce()).toBe(false);
    expect(ctx.db.count("SELECT COUNT(*) FROM backups_log WHERE kind = 'auto'")).toBe(1);
  });

  it("skips when auto backups are disabled or the interval is zero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-sched-c-"));
    const { ctx, scheduler } = await boot(dir);
    await setupOwner(ctx);

    writeSettingInternal(ctx.db as never, SETTING_KEYS.backupAutoEnabled, "0");
    expect(await scheduler.runAutoBackupOnce()).toBe(false);
    expect(ctx.db.count("SELECT COUNT(*) FROM backups_log WHERE kind = 'auto'")).toBe(0);

    writeSettingInternal(ctx.db as never, SETTING_KEYS.backupAutoEnabled, "1");
    writeSettingInternal(ctx.db as never, SETTING_KEYS.backupAutoIntervalHours, "0");
    expect(await scheduler.runAutoBackupOnce()).toBe(false);
    expect(ctx.db.count("SELECT COUNT(*) FROM backups_log WHERE kind = 'auto'")).toBe(0);
  });

  it("skips when the system has no owner (first-run)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-sched-d-"));
    const { ctx, scheduler } = await boot(dir);
    const anyUser = ctx.db.count("SELECT COUNT(*) FROM users");
    expect(anyUser).toBe(0);
    expect(await scheduler.runAutoBackupOnce()).toBe(false);
  });

  it("records the auto snapshot as the scheduler system actor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-sched-e-"));
    const { ctx, scheduler } = await boot(dir);
    await setupOwner(ctx);

    expect(await scheduler.runAutoBackupOnce()).toBe(true);
    const row = ctx.db.first<{ kind: string; created_by: string | null }>(
      "SELECT kind, created_by FROM backups_log WHERE kind = 'auto' ORDER BY id DESC LIMIT 1",
    );
    expect(row?.kind).toBe("auto");
    // Synthetic scheduler actor must NOT write a dangling user FK.
    expect(row?.created_by).toBeNull();
  });
});