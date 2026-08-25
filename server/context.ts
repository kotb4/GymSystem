import { Db } from "../src/db/engine";
import { runMigrations } from "../src/db/migrations";
import { shouldSeedDemo, seedDemoData } from "../src/db/seed";
import { loadPermissionsCache } from "../src/core/services/permissions.service";
import { NodeSqliteDriver } from "./driver";
import { resolveAppDirs, type AppDirs } from "./config";
import { existsSync, renameSync, unlinkSync, appendFileSync } from "node:fs";
import { setFilesRoot } from "./files.service";

export interface AppContext {
  dirs: AppDirs;
  db: Db;
  driver: NodeSqliteDriver;
}

let context: AppContext | null = null;

export function logLine(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    if (context) appendFileSync(`${context.dirs.logsDir}/server.log`, line);
  } catch {
    /* logging must never break the server */
  }
  process.stdout.write(line);
}

/** Open (or create) the authoritative SQLite database and run migrations. */
export function openDatabase(): AppContext {
  if (context) return context;
  const dirs = resolveAppDirs();
  setFilesRoot(dirs.filesDir);
  const driver = new NodeSqliteDriver(dirs.dbFile);
  const db = new Db(driver);
  runMigrations(db);
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
    openDatabase();
    throw error;
  }

  openDatabase();
}
