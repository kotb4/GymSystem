import fs from "node:fs";
import path from "node:path";
import type { SignedPayload } from "./policy";

/**
 * Persists the license state OUTSIDE SQLite, in `configDir/license.json`.
 * Kept outside `gym.db` so it survives backups/restores and so copying the DB
 * alone cannot carry a license to another machine. The signed `.lic` is a
 * separate file the user uploads; this file is only the app-side bookkeeping
 * (hwid + lastActive) plus a cache of the last verified payload.
 */

export interface LicenseStateFile {
  formatVersion: 1;
  hwid: string;
  lastActive: number | null;
  payload: SignedPayload | null;
}

/** Never trust the persisted payload blindly — it is only a cache; the .lic is re-verified at boot. */
export function readLicenseState(dir: string): LicenseStateFile | null {
  try {
    const file = path.join(dir, "license.json");
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LicenseStateFile>;
    if (raw.formatVersion !== 1) return null;
    return {
      formatVersion: 1,
      hwid: typeof raw.hwid === "string" ? raw.hwid : "",
      lastActive: typeof raw.lastActive === "number" ? raw.lastActive : null,
      payload: raw.payload && typeof raw.payload === "object" ? (raw.payload as SignedPayload) : null,
    };
  } catch {
    return null;
  }
}

export function writeLicenseState(
  dir: string,
  state: LicenseStateFile,
): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "license.json");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, file); // atomic-ish replace
}

export function deleteLicenseState(dir: string): void {
  const file = path.join(dir, "license.json");
  if (fs.existsSync(file)) fs.unlinkSync(file);
}