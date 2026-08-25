import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Windows application-data layout (spec section 5):
 *   %LOCALAPPDATA%/GymSystem/
 *     Database/gym.db        authoritative SQLite file
 *     Files/                 future filesystem assets (member photos, ...)
 *     Backups/               snapshots + legacy-import protectives
 *     Logs/                  server log
 *     Config/                reserved for future configuration files
 */
export interface AppDirs {
  root: string;
  databaseDir: string;
  filesDir: string;
  backupsDir: string;
  logsDir: string;
  configDir: string;
  dbFile: string;
}

function resolveRoot(): string {
  const override = process.env.GYMSYSTEM_DATA_DIR;
  if (override && override.trim() !== "") return path.resolve(override.trim());
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "GymSystem");
  }
  return path.join(os.homedir(), ".gymsystem");
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveAppDirs(): AppDirs {
  const root = ensureDir(resolveRoot());
  const databaseDir = ensureDir(path.join(root, "Database"));
  const filesDir = ensureDir(path.join(root, "Files"));
  const backupsDir = ensureDir(path.join(root, "Backups"));
  const logsDir = ensureDir(path.join(root, "Logs"));
  const configDir = ensureDir(path.join(root, "Config"));
  return {
    root,
    databaseDir,
    filesDir,
    backupsDir,
    logsDir,
    configDir,
    dbFile: path.join(databaseDir, "gym.db"),
  };
}
