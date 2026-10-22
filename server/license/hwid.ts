import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Dependency-free hardware fingerprint for the offline license.
 *
 * Primary stable input on Windows: the machine-unique `MachineGuid` under
 * `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography`, read via `reg query`.
 * On Windows, MachineGuid is the SOLE input: it survives NIC/CPU/hostname
 * renames, VPN adapter changes (Tailscale, OpenVPN, etc.), and alone is
 * enough to fail a copy of the app/DB onto another PC.
 *
 * MACs are deliberately excluded on Windows because:
 *   1. The same physical NIC may appear multiple times (once per IP address),
 *      making the MAC count unstable across Windows/driver updates.
 *   2. VPN clients (Tailscale, OpenVPN, WireGuard, etc.) add virtual adapters
 *      unpredictably, changing the MAC list between boots.
 * Both issues were the #1 source of false "device changed" support tickets.
 *
 * Non-Windows builds fall back to `node:os` unique MACs + platform/arch
 * (best-effort; no MachineGuid equivalent exists cross-platform).
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
  const seen = new Set<string>();
  for (const key of Object.keys(nets)) {
    for (const n of nets[key] ?? []) {
      if (!n.internal && n.mac && n.mac !== "00:00:00:00:00:00") seen.add(n.mac);
    }
  }
  return [...seen].sort();
}

export function computeHwId(pf: NodeJS.Platform = os.platform()): string {
  const mg = machineGuid(pf);
  let identifiers: string[];
  if (mg) {
    // Windows: MachineGuid only — stable across NIC renames, VPN changes, driver updates.
    identifiers = [mg, pf, os.arch()];
  } else {
    // Non-Windows: best-effort fingerprint using unique MACs + platform + arch.
    identifiers = [pf, os.arch(), ...macAddresses()];
  }
  const canonical = JSON.stringify(identifiers);
  const digest = crypto.createHash("sha256").update(canonical).digest("hex").toUpperCase();
  // GYM-XXXX-XXXX-XXXX-XXXX : 16 hex chars
  const hex = digest.padEnd(16, "0").slice(0, 16);
  const parts = [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
  return `GYM-${parts.join("-")}`;
}
