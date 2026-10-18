import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Db } from "../src/db/engine";
import { SETTING_KEYS } from "../src/core/services/settings.service";
import { logLine } from "./context";

export interface TunnelState {
  active: boolean;
  url: string | null;
  mode: "ephemeral" | "permanent" | "none";
  installed: boolean;
  hasToken?: boolean;
  token?: string | null;
}

let tunnelProc: ChildProcess | null = null;
let activeTunnelUrl: string | null = null;
let tunnelMode: "ephemeral" | "permanent" | "none" = "none";
let intentionalStop = false;
let restartTimeout: NodeJS.Timeout | null = null;

/**
 * Locate cloudflared binary across common Windows and environment locations.
 */
export function findCloudflaredBin(): string | null {
  const commonPaths = [
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "cloudflared", "cloudflared.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "cloudflared", "cloudflared.exe"),
  ];

  for (const p of commonPaths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  // Check PATH if where.exe finds it
  if (process.platform === "win32") {
    try {
      const { execSync } = require("node:child_process");
      const out = execSync("where.exe cloudflared", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const firstLine = out.split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {
      /* ignore */
    }
  }

  return "cloudflared";
}

/**
 * Check if cloudflared is installed on the host.
 */
export function isCloudflaredInstalled(): boolean {
  const bin = findCloudflaredBin();
  if (bin && bin !== "cloudflared" && fs.existsSync(bin)) return true;
  if (process.platform === "win32") {
    try {
      const { execSync } = require("node:child_process");
      execSync("where.exe cloudflared", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Get current tunnel state.
 */
export function getTunnelState(db?: Db): TunnelState {
  const installed = isCloudflaredInstalled();
  let url = activeTunnelUrl;
  let hasToken = false;
  let token: string | null = null;

  if (db) {
    try {
      const rowToken = db.first<{ value: string }>(
        "SELECT value FROM settings WHERE key = ? LIMIT 1",
        [SETTING_KEYS.tunnelToken],
      );
      if (rowToken && rowToken.value) {
        hasToken = true;
        token = rowToken.value.trim();
      }
      if (!url) {
        const row = db.first<{ value: string }>(
          "SELECT value FROM settings WHERE key = ? LIMIT 1",
          [SETTING_KEYS.tunnelUrl],
        );
        if (row && row.value) url = row.value.trim();
      }
    } catch {
      /* ignore */
    }
  }

  return {
    active: tunnelProc != null && !tunnelProc.killed,
    url: url || null,
    mode: hasToken ? "permanent" : tunnelMode,
    installed,
    hasToken,
    token: token || null,
  };
}

/**
 * Stop any running Cloudflare tunnel process.
 */
export function stopCloudflareTunnel(db?: Db, clearToken = false): void {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  intentionalStop = true;

  if (tunnelProc) {
    try {
      tunnelProc.kill("SIGTERM");
      setTimeout(() => {
        if (tunnelProc && !tunnelProc.killed) {
          tunnelProc.kill("SIGKILL");
        }
      }, 1000);
    } catch {
      /* ignore */
    }
    tunnelProc = null;
  }
  activeTunnelUrl = null;
  tunnelMode = "none";

  if (db && clearToken) {
    try {
      db.run("DELETE FROM settings WHERE key IN (?, ?)", [
        SETTING_KEYS.tunnelUrl,
        SETTING_KEYS.tunnelToken,
      ]);
    } catch {
      /* ignore */
    }
  }
  logLine("cloudflare-tunnel: stopped");
}

/**
 * Start or restart Cloudflare Tunnel.
 */
export async function startCloudflareTunnel(
  db: Db,
  forceRestart = false,
  port = 8890,
): Promise<{ ok: boolean; url?: string; running: boolean }> {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  intentionalStop = false;

  const bin = findCloudflaredBin();
  if (!bin) {
    throw new Error("cloudflared is not installed on this system");
  }

  if (tunnelProc && !forceRestart && activeTunnelUrl) {
    return { ok: true, url: activeTunnelUrl, running: true };
  }

  stopCloudflareTunnel();
  intentionalStop = false;

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (activeTunnelUrl) {
          resolve({ ok: true, url: activeTunnelUrl, running: true });
        } else {
          resolve({ ok: false, running: tunnelProc != null });
        }
      }
    }, 25000);

    try {
      // Check if permanent token is stored
      let storedToken = "";
      let storedUrl = "";
      try {
        const rowToken = db.first<{ value: string }>(
          "SELECT value FROM settings WHERE key = ? LIMIT 1",
          [SETTING_KEYS.tunnelToken],
        );
        storedToken = rowToken?.value ? rowToken.value.trim() : "";
        const rowUrl = db.first<{ value: string }>(
          "SELECT value FROM settings WHERE key = ? LIMIT 1",
          [SETTING_KEYS.tunnelUrl],
        );
        storedUrl = rowUrl?.value ? rowUrl.value.trim() : "";
      } catch {
        /* ignore */
      }

      const args = storedToken
        ? ["tunnel", "run", "--token", storedToken]
        : ["tunnel", "--url", `http://127.0.0.1:${port}`];

      tunnelMode = storedToken ? "permanent" : "ephemeral";

      logLine(`cloudflare-tunnel: spawning ${bin} ${args.join(" ")}`);
      tunnelProc = spawn(bin, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (storedToken) {
        // With permanent token, cloudflared connects to Cloudflare Edge.
        // Fallback resolve after 3500ms if process remains alive and no error thrown.
        setTimeout(() => {
          if (!resolved && tunnelProc && !tunnelProc.killed) {
            resolved = true;
            clearTimeout(timeout);
            activeTunnelUrl = storedUrl || activeTunnelUrl || null;
            logLine(`cloudflare-tunnel: permanent connection ready${storedUrl ? ` at ${storedUrl}` : ""}`);
            resolve({ ok: true, url: activeTunnelUrl || undefined, running: true });
          }
        }, 3500);
      }

      const handleOutput = (data: Buffer | string) => {
        const text = String(data);
        if (storedToken) {
          if (/registered\s+tunnel\s+connection|connection.*registered|updated to new configuration|INF Connection/i.test(text)) {
            activeTunnelUrl = storedUrl || activeTunnelUrl || null;
            logLine(`cloudflare-tunnel: permanent tunnel registered${storedUrl ? ` at ${storedUrl}` : ""}`);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({ ok: true, url: activeTunnelUrl || undefined, running: true });
            }
          }
        } else {
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
          if (match && match[0]) {
            const foundUrl = match[0].trim();
            activeTunnelUrl = foundUrl;
            try {
              db.run(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [SETTING_KEYS.tunnelUrl, foundUrl],
              );
            } catch {
              /* ignore */
            }
            logLine(`cloudflare-tunnel: active at ${foundUrl}`);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({ ok: true, url: foundUrl, running: true });
            }
          }
        }
      };

      tunnelProc.stdout?.on("data", handleOutput);
      tunnelProc.stderr?.on("data", handleOutput);

      tunnelProc.on("error", (err) => {
        logLine(`cloudflare-tunnel error: ${err.message}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      tunnelProc.on("exit", (code) => {
        logLine(`cloudflare-tunnel exited with code ${code}`);
        tunnelProc = null;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ ok: false, running: false });
        }

        // Auto-reconnect if unexpectedly closed and token is configured
        if (!intentionalStop && storedToken) {
          logLine("cloudflare-tunnel: unexpected exit, scheduling auto-reconnect in 5s...");
          if (restartTimeout) clearTimeout(restartTimeout);
          restartTimeout = setTimeout(() => {
            restartTimeout = null;
            if (!intentionalStop && !tunnelProc) {
              startCloudflareTunnel(db, true, port).catch((e) => {
                logLine(`cloudflare-tunnel auto-reconnect failed: ${e?.message || String(e)}`);
              });
            }
          }, 5000);
        }
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/**
 * Auto-start tunnel on boot if tunnel configuration/token exists.
 */
export async function autostartTunnelIfConfigured(db: Db, port = 8890): Promise<void> {
  try {
    const rowToken = db.first<{ value: string }>(
      "SELECT value FROM settings WHERE key = ? LIMIT 1",
      [SETTING_KEYS.tunnelToken],
    );
    const token = rowToken?.value ? rowToken.value.trim() : "";
    if (!token) {
      logLine("cloudflare-tunnel: no permanent token configured, skipping auto-start");
      return;
    }
    if (!isCloudflaredInstalled()) {
      logLine("cloudflare-tunnel: token configured but cloudflared binary not found");
      return;
    }
    logLine("cloudflare-tunnel: found configured token, auto-starting tunnel...");
    await startCloudflareTunnel(db, true, port);
    logLine("cloudflare-tunnel: auto-start completed successfully");
  } catch (err: any) {
    logLine(`cloudflare-tunnel: auto-start error: ${err?.message || String(err)}`);
  }
}

