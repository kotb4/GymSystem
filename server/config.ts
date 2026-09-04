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

/**
 * Secure default bind address: loopback only. The app is a local desktop
 * application; exposing it on 0.0.0.0 would put the HTTP API (and the
 * unauthenticated first-run setup route) on the LAN. Opt into LAN exposure
 * explicitly via `GYMSYSTEM_HOST`. See ADR-023 (supersedes ADR-010).
 */
export const DEFAULT_HTTP_HOST = "127.0.0.1";

/** Resolve the bind host: env override wins, else loopback default. */
export function resolveHttpHost(override?: string): string {
  const candidate = override ?? process.env.GYMSYSTEM_HOST;
  return candidate && candidate.trim() !== "" ? candidate.trim() : DEFAULT_HTTP_HOST;
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
