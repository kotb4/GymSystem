import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Dependency-free hardware fingerprint for the offline license.
 *
 * Primary stable input on Windows: the machine-unique `MachineGuid` under
 * `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography`, read via `reg query`.
 * `MachineGuid` is the SOLE backbone of the fingerprint: it survives
 * NIC/CPU/hostname renames, differs between physical machines, and alone is
 * enough to fail a copy of the app/DB onto another PC.
 * Hostname is deliberately EXCLUDED (it changes on rename / DNS / domain
 * join and was the top source of false "device changed" support tickets).
 * MACs stay as a secondary, non-essential input. Non-Windows builds fall back
 * to `node:os` stable identifiers (MACs + platform/arch), best-effort only.
 *
 * The HWID is SHA-256 over a canonical JSON list of identifiers, truncated to
 * `GYM-XXXX-XXXX-XXXX-XXXX`.
 */

function machineGuid(osPlatform: NodeJS.Platform): string | null {
  if (osPlatform !== "win32") return null;
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", windowsHide: true, timeout: 4000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function macAddresses(): string[] {
  const nets = os.networkInterfaces();
  const macs: string[] = [];
  for (const key of Object.keys(nets)) {
    for (const n of nets[key] ?? []) {
      if (!n.internal && n.mac && n.mac !== "00:00:00:00:00:00") macs.push(n.mac);
    }
  }
  return macs.sort();
}

export function computeHwId(pf: NodeJS.Platform = os.platform()): string {
  const identifiers: (string | null)[] = [];
  identifiers.push(machineGuid(pf));
  identifiers.push(pf);
  identifiers.push(os.arch());
  identifiers.push(...macAddresses());
  const canonical = JSON.stringify(identifiers.filter(Boolean));
  const digest = crypto.createHash("sha256").update(canonical).digest("hex").toUpperCase();
  // GYM-XXXX-XXXX-XXXX-XXXX : 16 hex chars
  const hex = digest.padEnd(16, "0").slice(0, 16);
  const parts = [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
  return `GYM-${parts.join("-")}`;
}