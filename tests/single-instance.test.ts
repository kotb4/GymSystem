import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  isPortInUse,
  waitForPortFree,
  requestGracefulShutdown,
  ensureSingleActiveInstance,
  findPidListeningOnPort,
  findOtherExePids,
  killProcess,
} from "../server/single-instance";

describe("single-instance takeover suite", () => {
  it("detects when a port is free vs in use", async () => {
    // Pick an ephemeral port
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as net.AddressInfo;
    const testPort = address.port;

    expect(await isPortInUse(testPort)).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortInUse(testPort)).toBe(false);
  });

  it("waitForPortFree returns true when port closes within timeout", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const testPort = (server.address() as net.AddressInfo).port;

    setTimeout(() => {
      server.close();
    }, 150);

    const freed = await waitForPortFree(testPort, 1500);
    expect(freed).toBe(true);
  });

  it("requestGracefulShutdown successfully sends POST to /api/system/shutdown", async () => {
    let received = false;
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/system/shutdown") {
        received = true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const testPort = (server.address() as net.AddressInfo).port;

    const ok = await requestGracefulShutdown(testPort, 1000);
    expect(ok).toBe(true);
    expect(received).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("ensureSingleActiveInstance does nothing when no conflict exists", async () => {
    // Port 29999 should be completely free
    const logs: string[] = [];
    const terminated = await ensureSingleActiveInstance({
      port: 29999,
      exeName: "non-existent-binary-123456.exe",
      log: (msg) => logs.push(msg),
    });

    expect(terminated).toBe(false);
    expect(logs.length).toBe(0);
  });

  it("safe guards: killProcess never targets self or negative PID", () => {
    expect(killProcess(process.pid)).toBe(false);
    expect(killProcess(0)).toBe(false);
    expect(killProcess(-1)).toBe(false);
  });

  it("findPidListeningOnPort handles free port safely", () => {
    const pid = findPidListeningOnPort(29999);
    expect(pid).toBe(null);
  });

  it("findOtherExePids excludes current process", () => {
    const pids = findOtherExePids("non-existent-test-binary.exe");
    expect(Array.isArray(pids)).toBe(true);
    expect(pids.includes(process.pid)).toBe(false);
  });
});
