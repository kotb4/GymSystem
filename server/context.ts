import { Db } from "../src/db/engine";
import { runMigrations } from "../src/db/migrations";
import { runExpenseAttachmentsBackfill } from "./expense-attachments-backfill";
import { shouldSeedDemo, seedDemoData } from "../src/db/seed";
import { loadPermissionsCache } from "../src/core/services/permissions.service";
import { NodeSqliteDriver } from "./driver";
import { resolveAppDirs, type AppDirs } from "./config";
import { existsSync, renameSync, unlinkSync, createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import path from "node:path";
import { setFilesRoot, sweepPendingDeletes } from "./files.service";
import { initLicenseSession, refreshLicenseClock, licenseStateName } from "./license/session";

export interface AppContext {
  dirs: AppDirs;
  db: Db;
  driver: NodeSqliteDriver;
}

let context: AppContext | null = null;

/**
 * Logger backed by an append-only write stream (non-blocking). Lines written
 * before the stream is ready are buffered and flushed on init. Logging must
 * never break the server, so any failure is swallowed.
 */
let logStream: WriteStream | null = null;
let logBuffer: string[] = [];

export function initLogging(logsDir: string): void {
  flushLogging();
  try {
    logStream = createWriteStream(path.join(logsDir, "server.log"), { flags: "a" });
    logStream.on("error", () => {
      /* keep serving even if logging fails */
    });
    logStream.on("drain", () => {
      if (!logStream) return;
      for (const buffered of logBuffer) logStream?.write(buffered);
      logBuffer = [];
    });
    const buffered = logBuffer;
    logBuffer = [];
    for (const line of buffered) logStream?.write(line);
  } catch {
    logStream = null;
  }
}

export function flushLogging(callback?: () => void): void {
  const stream = logStream;
  logStream = null;
  logBuffer = [];
  if (stream) {
    try {
      stream.end(callback);
    } catch {
      if (callback) callback();
    }
  } else if (callback) {
    callback();
  }
}

export function logLine(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  if (logStream) {
    if (!logStream.write(line)) {
      logBuffer.push(line);
      if (logBuffer.length > 1000) logBuffer.shift();
    }
  } else {
    logBuffer.push(line);
    if (logBuffer.length > 1000) logBuffer.shift();
  }
}

/** True while the live database handle is temporarily swapped (restore/import). */
let maintenanceMode = false;

export function isMaintenanceMode(): boolean {
  return maintenanceMode;
}

export function setMaintenanceMode(value: boolean): void {
  maintenanceMode = value;
}

/** Open (or create) the authoritative SQLite database and run migrations. */
export function openDatabase(): AppContext {
  if (context) return context;
  const dirs = resolveAppDirs();
  initLogging(dirs.logsDir);
  setFilesRoot(dirs.filesDir);
  // Crash-safe sweep: a prior crash may have left .pending-delete sidecars
  // next to files that were about to be moved to .trash/. Best-effort.
  try {
    const recovered = sweepPendingDeletes();
    if (recovered > 0) logLine(`files: swept ${recovered} pending-delete marker(s)`);
  } catch (error) {
    logLine(`files: pending-delete sweep failed: ${String(error)}`);
  }
  const driver = new NodeSqliteDriver(dirs.dbFile);
  const db = new Db(driver);
  runMigrations(db);
  // ADR-018 §8: promote any legacy `expense_attachments` BLOBs to Files/.
  // Idempotent; safe on every boot.
  try {
    const report = runExpenseAttachmentsBackfill(db);
    if (report.imported > 0) {
      logLine(`backfill: imported ${report.imported} legacy expense attachment(s)`);
    }
  } catch (error) {
    logLine(`backfill: expense attachments backfill failed: ${String(error)}`);
  }
  loadPermissionsCache(db);
  db.onDirty(() => loadPermissionsCache(db));

  if (shouldSeedDemo() && !db.scalar("SELECT value FROM settings WHERE key = 'demo_seeded'")) {
    void seedDemoData(db).then(() => {
      db.run(
        "INSERT INTO settings (key, value) VALUES ('demo_seeded', '1')\nON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      logLine("demo data seeded");
    });
  }

  context = { dirs, db, driver };
  // ADR-019: initialize the offline-license session (HWID + signed .lic +
  // clock guard). Must run after dirs are resolved so license.json/.lic live
  // in Config/. Best-effort: a broken perms cache/policy should not crash boot.
  try {
    initLicenseSession(dirs.configDir);
    refreshLicenseClock();
    logLine(`license state: ${licenseStateName()}`);
  } catch (error) {
    logLine(`license: boot init failed: ${String(error)}`);
  }
  logLine(`database ready at ${dirs.dbFile}`);
  return context;
}

export function getDbContext(): AppContext {
  if (!context) throw new Error("database not opened yet");
  return context;
}

/**
 * Atomically replace the live database file with candidate bytes after
 * validation. Used by restore + legacy import. The previous database is kept
 * as a protective snapshot in Backups/.
 */
export function adoptDatabaseFile(candidatePath: string): void {
  const ctx = context;
  if (!ctx) throw new Error("database not opened yet");

  // close current handle first so Windows allows the swap
  setMaintenanceMode(true);
  ctx.driver.close();
  context = null;

  try {
    const probe = NodeSqliteDriver.probeFile(candidatePath);
    if (probe.integrity !== "ok") throw new Error(`integrity check failed: ${probe.integrity}`);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (existsSync(ctx.dirs.dbFile)) {
      renameSync(ctx.dirs.dbFile, `${ctx.dirs.backupsDir}/pre-restore-${stamp}.db`);
      // remove WAL/SHM sidecars of the old database
      for (const suffix of ["-wal", "-shm"]) {
        try {
          unlinkSync(ctx.dirs.dbFile + suffix);
        } catch {
          /* absent is fine */
        }
      }
    }
    renameSync(candidatePath, ctx.dirs.dbFile);
    logLine(`database adopted (${probe.users} users, schema v${probe.version})`);
  } catch (error) {
    // reopen whatever we still have so the server keeps serving
    setMaintenanceMode(false);
    openDatabase();
    throw error;
  }

  openDatabase();
  setMaintenanceMode(false);
}
