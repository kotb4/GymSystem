import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TailscaleStatusResult {
  installed: boolean;
  running: boolean;
  connected: boolean;
  ip: string | null;
  deviceHostName: string | null;
  dnsName: string | null;
  tailnet: string | null;
  rawState: string;
}

export function findTailscaleBin(): string | null {
  const common = [
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }
  return "tailscale";
}

export async function getTailscaleStatus(): Promise<TailscaleStatusResult> {
  const bin = findTailscaleBin();
  try {
    const { stdout } = await execFileAsync(bin || "tailscale", ["status", "--json"], {
      timeout: 3000,
      windowsHide: true,
    });
    const data = JSON.parse(stdout);
    const self = data.Self || {};
    const state = data.BackendState || "Unknown";
    const ip = self.TailscaleIPs?.[0] || data.TailscaleIPs?.[0] || null;

    return {
      installed: true,
      running: state !== "Stopped",
      connected: state === "Running",
      ip,
      deviceHostName: self.HostName || null,
      dnsName: self.DNSName || null,
      tailnet: data.CurrentTailnet?.Name || null,
      rawState: state,
    };
  } catch {
    return {
      installed: false,
      running: false,
      connected: false,
      ip: null,
      deviceHostName: null,
      dnsName: null,
      tailnet: null,
      rawState: "not_installed",
    };
  }
}
