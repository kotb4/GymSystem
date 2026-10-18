import { describe, expect, it } from "vitest";
import { findCloudflaredBin, isCloudflaredInstalled, getTunnelState } from "../server/tunnel";
import { findTailscaleBin, getTailscaleStatus } from "../server/tailscale";
import { createTestDb } from "./helpers/test-db";

describe("Network & Tunnel Server Modules", () => {
  it("resolves cloudflared binary detection gracefully", () => {
    const bin = findCloudflaredBin();
    expect(bin).toBeTruthy();
    const installed = isCloudflaredInstalled();
    expect(typeof installed).toBe("boolean");
  });

  it("returns default tunnel state safely with a test database", () => {
    const db = createTestDb();
    const state = getTunnelState(db);
    expect(state).toHaveProperty("active");
    expect(state).toHaveProperty("url");
    expect(state).toHaveProperty("mode");
    expect(state).toHaveProperty("installed");
    expect(state).toHaveProperty("hasToken");
    expect(state.hasToken).toBe(false);

    // Save token in db
    db.run("INSERT INTO settings (key, value) VALUES ('tunnel_token', 'test-token-123')");
    const stateWithToken = getTunnelState(db);
    expect(stateWithToken.hasToken).toBe(true);
    expect(stateWithToken.token).toBe("test-token-123");
    expect(stateWithToken.mode).toBe("permanent");
  });

  it("resolves tailscale binary and status safely without throwing", async () => {
    const bin = findTailscaleBin();
    expect(bin).toBeTruthy();
    const status = await getTailscaleStatus();
    expect(status).toHaveProperty("installed");
    expect(status).toHaveProperty("running");
    expect(status).toHaveProperty("connected");
    expect(status).toHaveProperty("rawState");
  });
});
