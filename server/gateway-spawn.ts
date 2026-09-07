import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * On-demand WhatsApp gateway lifecycle (ADR-029 / card delivery).
 *
 * The gateway is a separate local process bound to 127.0.0.1:8891. It is
 * spawned (a) once at packaged-mode boot when whatsapp_enabled=1, and
 * (b) on demand via POST /api/system/ensure-whatsapp-gateway so enabling
 * WhatsApp mid-session never forces an app restart. Everything here is
 * idempotent: if the gateway is already reachable we never spawn a second one.
 */

export interface GatewayLaunch {
  nodeBin: string;
  gatewayMain: string;
}

/** Locate the gateway binaries in packaged mode or dev checkout. */
export function resolveGatewayLaunch(packaged: boolean): GatewayLaunch | null {
  if (packaged) {
    const appDir = path.dirname(process.execPath);
    const nodeBin = path.join(appDir, "runtime", "node.exe");
    const gatewayMain = path.join(appDir, "gateway", "index.js");
    return fs.existsSync(nodeBin) && fs.existsSync(gatewayMain)
      ? { nodeBin, gatewayMain }
      : null;
  }
  const gatewayMain = path.join(process.cwd(), "whatsapp-gateway", "index.js");
  return fs.existsSync(gatewayMain) ? { nodeBin: process.execPath, gatewayMain } : null;
}

/** Only loopback URLs may be probed (prevents SSRF via the settings value). */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

/** True when the gateway answers `GET /health` within the timeout. */
export async function probeGateway(url: string, timeoutMs = 1500): Promise<boolean> {
  if (!isLoopbackUrl(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface EnsureGatewayResult {
  running: boolean;
  alreadyRunning: boolean;
  error?: "invalid_url" | "not_found" | "start_timeout";
}

export type ProbeFn = (url: string, timeoutMs?: number) => Promise<boolean>;
export type SpawnFn = (launch: GatewayLaunch) => ChildProcess;

export interface EnsureOptions {
  packaged: boolean;
  log?: (msg: string) => void;
  probe?: ProbeFn;
  spawnFn?: SpawnFn;
  pollMs?: number;
  startTimeoutMs?: number;
}

/** Default spawner: hidden, detached, never keeps the parent alive. */
function defaultSpawn(launch: GatewayLaunch): ChildProcess {
  const child = spawn(launch.nodeBin, [launch.gatewayMain], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
}

/**
 * Ensure the gateway is up. If already reachable → alreadyRunning. Otherwise
 * spawn it (detached) and poll /health until it answers. Safe to call from
 * concurrent paths: the probe-before-spawn ordering makes duplicates unlikely,
 * and a straggler that fails to bind simply exits on EADDRINUSE.
 */
export async function ensureGateway(url: string, opts: EnsureOptions): Promise<EnsureGatewayResult> {
  const probe = opts.probe ?? probeGateway;
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const log = opts.log ?? (() => {});
  const pollMs = opts.pollMs ?? 400;
  const startTimeoutMs = opts.startTimeoutMs ?? 4000;
  if (!isLoopbackUrl(url)) return { running: false, alreadyRunning: false, error: "invalid_url" };

  if (await probe(url, 1500)) return { running: true, alreadyRunning: true };

  const launch = resolveGatewayLaunch(opts.packaged);
  if (!launch) {
    log("whatsapp gateway binaries not found; skipping start");
    return { running: false, alreadyRunning: false, error: "not_found" };
  }

  let child: ChildProcess;
  try {
    child = spawnFn(launch);
  } catch (error) {
    log(`whatsapp gateway spawn failed: ${String(error)}`);
    return { running: false, alreadyRunning: false, error: "start_timeout" };
  }
  child.on("error", (error) => log(`whatsapp gateway process error: ${error.message}`));

  const deadline = Date.now() + startTimeoutMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (Date.now() >= deadline) break;
    if (await probe(url, 1500)) return { running: true, alreadyRunning: false };
  }
  log("whatsapp gateway did not become healthy in time");
  return { running: false, alreadyRunning: false, error: "start_timeout" };
}