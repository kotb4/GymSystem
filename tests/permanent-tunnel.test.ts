import { beforeEach, describe, expect, it } from "vitest";
import { extractTunnelToken } from "@/core/tunnel-token";
import {
  SETTING_KEYS,
  readAllSettings,
  updateSetting,
} from "@/core/services/settings.service";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

describe("extractTunnelToken", () => {
  it("extracts a raw token starting with eyJh", () => {
    const raw = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample_token_content_here_12345";
    expect(extractTunnelToken(raw)).toBe(raw);
  });

  it("extracts token from 'cloudflared.exe service install <token>' command", () => {
    const token = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload_data_windows_service";
    const cmd = `cloudflared.exe service install ${token}`;
    expect(extractTunnelToken(cmd)).toBe(token);
  });

  it("extracts token from 'cloudflared tunnel run --token <token>' command", () => {
    const token = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload_data_tunnel_run";
    const cmd = `cloudflared tunnel run --token ${token}`;
    expect(extractTunnelToken(cmd)).toBe(token);
  });

  it("extracts token when surrounded by arbitrary whitespace or newlines", () => {
    const token = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload_whitespace";
    const cmd = `\n\r  cloudflared.exe service install   ${token}  \n`;
    expect(extractTunnelToken(cmd)).toBe(token);
  });

  it("returns empty string when input is empty or whitespace", () => {
    expect(extractTunnelToken("")).toBe("");
    expect(extractTunnelToken("   \t\n  ")).toBe("");
  });

  it("returns trimmed input if no specific token prefix was matched", () => {
    expect(extractTunnelToken("my-custom-tunnel-string")).toBe("my-custom-tunnel-string");
  });
});

describe("Permanent Tunnel Settings Integration", () => {
  let db: Db;
  let owner: ServiceActor;
  let receptionist: ServiceActor;

  beforeEach(async () => {
    db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Yassen Gym",
      ownerFullName: "Owner User",
      username: "owner",
      password: "Password123!",
    });
    owner = buildActor(ownerUser);

    const recUser = await createUser(db, owner, {
      username: "reception",
      fullName: "Reception User",
      roleId: "reception",
      password: "Password123!",
    });
    receptionist = buildActor(recUser);
  });

  it("allows owner to persist tunnel_token and tunnel_url", async () => {
    const token = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock_tunnel_token";
    const url = "https://gym.mycloudflaredomain.com";

    await updateSetting(db, owner, SETTING_KEYS.tunnelToken, token);
    await updateSetting(db, owner, SETTING_KEYS.tunnelUrl, url);

    const settings = readAllSettings(db, owner);
    expect(settings[SETTING_KEYS.tunnelToken]).toBe(token);
    expect(settings[SETTING_KEYS.tunnelUrl]).toBe(url);
  });

  it("denies non-authorized user from modifying tunnel settings", async () => {
    await expect(
      updateSetting(db, receptionist, SETTING_KEYS.tunnelToken, "unauthorized_token"),
    ).rejects.toThrow();
  });

  it("rejects tunnel_token exceeding max allowed length", async () => {
    const tooLongToken = "a".repeat(2001);
    await expect(
      updateSetting(db, owner, SETTING_KEYS.tunnelToken, tooLongToken),
    ).rejects.toThrow();
  });

  it("allows clearing tunnel_token to empty string", async () => {
    await updateSetting(db, owner, SETTING_KEYS.tunnelToken, "eyJhValidToken123");
    expect(readAllSettings(db, owner)[SETTING_KEYS.tunnelToken]).toBe("eyJhValidToken123");

    await updateSetting(db, owner, SETTING_KEYS.tunnelToken, "");
    expect(readAllSettings(db, owner)[SETTING_KEYS.tunnelToken]).toBe("");
  });
});
