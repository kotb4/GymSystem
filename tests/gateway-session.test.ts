import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import wa from "../whatsapp-gateway/wa-session.js";

describe("wa-session persistence & pairing contract", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "gw-session-"));
    wa.setCfg({
      sessionDir,
      engineDir: join(sessionDir, "engine"),
      headless: true,
      logFile: join(sessionDir, "gw.log"),
    });
  });

  it("hasSavedCredentials returns false when authDir is missing or empty", () => {
    expect(wa.hasSavedCredentials()).toBe(false);

    const authDir = join(sessionDir, "baileys_auth");
    mkdirSync(authDir, { recursive: true });
    expect(wa.hasSavedCredentials()).toBe(false);

    writeFileSync(join(authDir, "creds.json"), "{}");
    expect(wa.hasSavedCredentials()).toBe(false);

    writeFileSync(join(authDir, "creds.json"), JSON.stringify({ registered: false }));
    expect(wa.hasSavedCredentials()).toBe(false);
  });

  it("hasSavedCredentials returns true when creds.json has registered=true", () => {
    const authDir = join(sessionDir, "baileys_auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "creds.json"),
      JSON.stringify({
        registered: true,
        noiseKey: "abc",
        registrationId: 12345,
      })
    );
    expect(wa.hasSavedCredentials()).toBe(true);
  });

  it("hasSavedCredentials returns true when creds.json has me.id", () => {
    const authDir = join(sessionDir, "baileys_auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "creds.json"),
      JSON.stringify({
        me: { id: "20123456789:1@s.whatsapp.net", name: "Gym" },
      })
    );
    expect(wa.hasSavedCredentials()).toBe(true);
  });

  it("isPaired and healthStatus recognize saved credentials without active socket", async () => {
    const authDir = join(sessionDir, "baileys_auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "creds.json"),
      JSON.stringify({
        registered: true,
        me: { id: "20123456789:1@s.whatsapp.net" },
      })
    );

    expect(await wa.isPaired()).toBe(true);
    const health = await wa.healthStatus();
    expect(health.paired).toBe(true);
  });

  it("readQr returns null when saved credentials exist", async () => {
    const authDir = join(sessionDir, "baileys_auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "creds.json"),
      JSON.stringify({
        registered: true,
        me: { id: "20123456789:1@s.whatsapp.net" },
      })
    );

    const qr = await wa.readQr();
    expect(qr).toBeNull();
  });

  it("disconnect wipes authDir and resets pairing state", async () => {
    const authDir = join(sessionDir, "baileys_auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "creds.json"),
      JSON.stringify({
        registered: true,
        me: { id: "20123456789:1@s.whatsapp.net" },
      })
    );
    writeFileSync(join(sessionDir, "messages_cache.json"), "[]");
    writeFileSync(join(sessionDir, "lid_mappings.json"), "{}");

    expect(wa.hasSavedCredentials()).toBe(true);

    const res = await wa.disconnect();
    expect(res.ok).toBe(true);
    expect(res.disconnected).toBe(true);

    expect(existsSync(authDir)).toBe(false);
    expect(existsSync(join(sessionDir, "messages_cache.json"))).toBe(false);
    expect(existsSync(join(sessionDir, "lid_mappings.json"))).toBe(false);
    expect(wa.hasSavedCredentials()).toBe(false);
    expect(await wa.isPaired()).toBe(false);
  });
});
