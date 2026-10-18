import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Windows application-data layout (spec section 5):
 *   %LOCALAPPDATA%/GymGate/ (or fallback to GymSystem/)
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
 * Default bind address: 0.0.0.0 listens on all interfaces (localhost, LAN, and
 * Tailscale mesh VPN) so remote branch sync and client devices can reach the server.
 * Sensitive first-run setup routes remain loopback-only via
 * isDirectPhysicalLocalRequest() (ADR-035). Opt into loopback-only explicitly via
 * `GYMGATE_HOST=127.0.0.1` or `GYMSYSTEM_HOST=127.0.0.1`.
 */
export const DEFAULT_HTTP_HOST = "0.0.0.0";

/** Resolve the bind host: env override wins, else loopback default. */
export function resolveHttpHost(override?: string): string {
  const candidate = override ?? process.env.GYMGATE_HOST ?? process.env.GYMSYSTEM_HOST;
  return candidate && candidate.trim() !== "" ? candidate.trim() : DEFAULT_HTTP_HOST;
}

function resolveRoot(): string {
  const override = process.env.GYMGATE_DATA_DIR ?? process.env.GYMSYSTEM_DATA_DIR;
  if (override && override.trim() !== "") return path.resolve(override.trim());
  const exeBase = path.basename(process.execPath).toLowerCase();
  const isBranch2 = exeBase.includes("branch2") || exeBase.includes("branch-2") || exeBase.includes("b2");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const localAppData = process.env.LOCALAPPDATA;
    if (isBranch2) {
      const gateBranch2 = path.join(localAppData, "GymGate_Branch2");
      const sysBranch2 = path.join(localAppData, "GymSystem_Branch2");
      if (existsSync(gateBranch2)) return gateBranch2;
      if (existsSync(sysBranch2)) return sysBranch2;
      return gateBranch2;
    }
    const gatePath = path.join(localAppData, "GymGate");
    const sysPath = path.join(localAppData, "GymSystem");
    if (existsSync(gatePath)) return gatePath;
    if (existsSync(sysPath)) return sysPath;
    return gatePath;
  }
  const home = os.homedir();
  if (isBranch2) {
    const gateBranch2 = path.join(home, ".gymgate_branch2");
    const sysBranch2 = path.join(home, ".gymsystem_branch2");
    if (existsSync(gateBranch2)) return gateBranch2;
    if (existsSync(sysBranch2)) return sysBranch2;
    return gateBranch2;
  }
  const gateHome = path.join(home, ".gymgate");
  const sysHome = path.join(home, ".gymsystem");
  if (existsSync(gateHome)) return gateHome;
  if (existsSync(sysHome)) return sysHome;
  return gateHome;
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
