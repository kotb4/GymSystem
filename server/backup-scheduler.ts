import type { ServiceActor } from "../src/core/permissions";
import {
  readRuntimeBackupPolicyConfig,
  pruneBackupsByPolicy,
  type BackupKind,
} from "../src/core/services/backup.service";
import { getDbContext, isMaintenanceMode, logLine } from "./context";
import { createServerBackup } from "./backups";
import { canWrite } from "./license/session";

/**
 * Automatic backup scheduler (TASK-042).
 *
 * A SINGLETON owner of automatic backups: one 60-second interval guarded by a
 * single-flight `running` flag, so at most one auto-backup may be in flight at
 * any time and `startBackupScheduler()` is idempotent (second calls no-op).
 * The scheduler skips work during maintenance/restore, while the license is
 * hard-locked, and while the system is uninitialized (no active owner).
 *
 * Runs entirely server-side — the browser needs no timer, and the login-time
 * hook (`useBootMaintenance`) no longer triggers backups.
 */
const TICK_MS = 60_000;

/** Synthetic owner actor: the owner role passes every requirePermission check. */
const SYSTEM_ACTOR: ServiceActor = {
  userId: "scheduler",
  username: "system",
  roleId: "owner",
  department: "general",
};

let started = false;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Idempotent. Safe to call repeatedly (startup + module reloads). */
export function startBackupScheduler(): void {
  if (started) return;
  started = true;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref?.();
  logLine("backup-scheduler: started (60s interval, unref'd)");
}

export function stopBackupScheduler(): void {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logLine("backup-scheduler: stopped");
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runAutoBackupOnce();
  } catch (error) {
    logLine(`backup-scheduler: tick failed: ${String(error)}`);
  } finally {
    running = false;
  }
}

function systemReady(db: ReturnType<typeof getDbContext>["db"]): boolean {
  if (isMaintenanceMode()) return false;
  if (!canWrite()) return false;
  const owners = db.count(
    "SELECT COUNT(*) FROM users WHERE role_id = 'owner' AND is_active = 1",
  );
  return owners > 0;
}

/** Last auto-backup stamp (`YYYY-MM-DD HH:mm:ss`, local) or null. */
function lastAutoStamp(
  db: ReturnType<typeof getDbContext>["db"],
): string | null {
  const row = db.first<{ created_at: string } | null>(
    "SELECT created_at FROM backups_log WHERE kind = 'auto' ORDER BY id DESC LIMIT 1",
    [],
  );
  return row?.created_at ?? null;
}

/** Compute the local-time interval (hours) since `stamp`, or NaN. */
function hoursSince(stamp: string): number {
  const t = Date.parse(stamp.replace(" ", "T"));
  const now = Date.now();
  if (!Number.isFinite(t) || t > now) return NaN;
  return (now - t) / 3_600_000;
}

/**
 * One scheduler pass: run an automatic backup if enabled AND due, then apply
 * tiered retention. Returns true when a backup was created.
 */
export async function runAutoBackupOnce(): Promise<boolean> {
  const ctx = getDbContext();
  if (!ctx?.db || !systemReady(ctx.db)) return false;

  const config = readRuntimeBackupPolicyConfig(ctx.db);
  if (!config.autoEnabled || config.intervalHours <= 0) return false;

  const last = lastAutoStamp(ctx.db);
  const due = !last || (!Number.isFinite(hoursSince(last)) ? true : hoursSince(last) >= config.intervalHours);
  if (!due) return false;

  const created: BackupKind = "auto";
  await createServerBackup(SYSTEM_ACTOR, created);

  // Retention pruning already ran inside createServerBackup; run it again so
  // an interval edge case (e.g. backups written to a custom location) is also
  // pruned without relying on a request.
  const removed = pruneBackupsByPolicy(ctx.db, config.retentionPolicy, config.retentionCount);
  if (removed.length > 0) logLine(`backup-scheduler: pruned ${removed.length} snapshot(s) by retention policy`);
  return true;
}

/** Test-only: fully reset singleton state. */
export function _resetBackupSchedulerForTest(): void {
  started = false;
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}