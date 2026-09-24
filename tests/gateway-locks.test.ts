import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { clearStaleLocks } from "../whatsapp-gateway/wa-session.js";

const LOCK_NAMES = ["lockfile", "DevToolsActivePort", "SingletonLock", "SingletonSocket", "SingletonCookie"];

describe("clearStaleLocks (gateway cold-start hardening)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gw-locks-"));
  });

  it("removes Chromium lock litter but keeps real profile files", () => {
    for (const name of LOCK_NAMES) {
      if (name === "SingletonLock" || name === "SingletonSocket") {
        mkdirSync(join(dir, name));
      } else {
        writeFileSync(join(dir, name), "123");
      }
    }
    writeFileSync(join(dir, "Local State"), "{}");
    mkdirSync(join(dir, "Default"), { recursive: true });
    writeFileSync(join(dir, "Default", "Preferences"), "{}");

    const removed = clearStaleLocks(dir, { force: true });

    expect(removed.map((p) => basename(p)).sort()).toEqual([...LOCK_NAMES].sort());
    expect(LOCK_NAMES.some((n) => existsSync(join(dir, n)))).toBe(false);
    expect(existsSync(join(dir, "Local State"))).toBe(true);
    expect(existsSync(join(dir, "Default", "Preferences"))).toBe(true);
  });

  it("is a safe no-op when no lock litter exists", () => {
    writeFileSync(join(dir, "Local State"), "{}");

    const removed = clearStaleLocks(dir, { force: true });

    expect(removed).toEqual([]);
    expect(existsSync(join(dir, "Local State"))).toBe(true);
  });

  it("handles missing / invalid dirs gracefully", () => {
    expect(clearStaleLocks(join(dir, "nope"), { force: true })).toEqual([]);
    expect(clearStaleLocks("", { force: true })).toEqual([]);
    expect(clearStaleLocks(null as never, { force: true })).toEqual([]);
  });

  it("removes lock litter on a cold start while no live browser holds the profile", () => {
    for (const name of LOCK_NAMES) writeFileSync(join(dir, name), "123");

    const removed = clearStaleLocks(dir); // force:false — the real cold-start path

    // A fresh temp dir is never owned by a running Edge/Chrome, so the
    // live-browser guard must pass and the liter must be cleared.
    expect(removed.map((p) => basename(p)).sort()).toEqual([...LOCK_NAMES].sort());
    expect(LOCK_NAMES.some((n) => existsSync(join(dir, n)))).toBe(false);
  });
});