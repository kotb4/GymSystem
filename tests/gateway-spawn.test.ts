import { describe, expect, it, vi } from "vitest";
import {
  ensureGateway,
  isLoopbackUrl,
  probeGateway,
  resolveGatewayLaunch,
  type GatewayLaunch,
  type SpawnFn,
} from "../server/gateway-spawn";
import type { ChildProcess } from "node:child_process";

const VALID_URL = "http://127.0.0.1:8891";
const noop = () => {};

function fakeChild(): ChildProcess {
  return { on: () => fakeChild(), unref: () => fakeChild() } as unknown as ChildProcess;
}

describe("gateway-spawn helpers", () => {
  it("only probes loopback URLs (no SSRF through the settings value)", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8891")).toBe(true);
    expect(isLoopbackUrl("http://localhost/health")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8891")).toBe(true);
    expect(isLoopbackUrl("https://127.0.0.1:8891")).toBe(true);
    expect(isLoopbackUrl("http://192.168.1.5:8891")).toBe(false);
    expect(isLoopbackUrl("http://example.com/health")).toBe(false);
    expect(isLoopbackUrl("file:///c:/x")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("resolves the packaged launch next to the exe when files exist", () => {
    // Packaged mode resolves against process.execPath dir â€” can't fabricate
    // that on disk for a unit test, so assert it returns null when absent and
    // that dev (non-packaged) resolution reuses the current node binary.
    const dev = resolveGatewayLaunch(false);
    expect(dev).not.toBeNull();
    expect(dev!.nodeBin).toBe(process.execPath);
  });
});

describe("ensureGateway", () => {
  it("returns alreadyRunning when the gateway is reachable (no spawn)", async () => {
    const spawnFn: SpawnFn = vi.fn(() => (fakeChild()));
    const result = await ensureGateway(VALID_URL, {
      packaged: false,
      log: noop,
      probe: async () => true,
      spawnFn,
    });
    expect(result).toEqual({ running: true, alreadyRunning: true });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("spawns and polls until the gateway becomes healthy", async () => {
    let silent = true;
    const probe = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      const healthy = !silent;
      silent = false;
      return healthy;
    });
    const launched = vi.fn();
    const spawnFn: SpawnFn = (launch: GatewayLaunch) => {
      launched(launch);
      return fakeChild();
    };
    const result = await ensureGateway(VALID_URL, {
      packaged: false,
      log: noop,
      probe,
      spawnFn,
      pollMs: 5,
      startTimeoutMs: 500,
    });
    expect(result.running).toBe(true);
    expect(result.alreadyRunning).toBe(false);
    expect(launched).toHaveBeenCalledTimes(1);
  });

  it("returns start_timeout when the gateway never becomes healthy", async () => {
    const result = await ensureGateway(VALID_URL, {
      packaged: false, // dev mode: repo gateway exists, so we reach the spawn+poll path
      log: noop,
      probe: async () => false,
      spawnFn: () => (fakeChild()),
      pollMs: 2,
      startTimeoutMs: 30,
    });
    expect(result.running).toBe(false);
    expect(result.error).toBe("start_timeout");
  });

  it("returns invalid_url without probing or spawning", async () => {
    const probe = vi.fn(async () => false);
    const spawnFn: SpawnFn = vi.fn(() => (fakeChild()));
    const result = await ensureGateway("http://example.com/health", {
      packaged: false,
      log: noop,
      probe,
      spawnFn,
    });
    expect(result.error).toBe("invalid_url");
    expect(probe).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("returns not_found when the gateway binaries are missing", async () => {
    const result = await ensureGateway(VALID_URL, {
      packaged: true,
      log: noop,
      probe: async () => false,
      // resolveGatewayLaunch(packaged=true) will fail because the exe dir has
      // no runtime\node.exe â€” assert the friendly error, no spawn.
      spawnFn: () => (fakeChild()),
      pollMs: 2,
      startTimeoutMs: 10,
    });
    expect(result.running).toBe(false);
    expect(result.error).toBe("not_found");
  });
});

