import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_HTTP_HOST, resolveHttpHost } from "../server/config";

/**
 * Regression tests for the secure bind-host default (ADR-023). The app is a
 * local desktop application: the default bind MUST be loopback-only even if
 * an operator forgets to set GYMSYSTEM_HOST.
 */

afterEach(() => {
  delete process.env.GYMSYSTEM_HOST;
});

describe("default HTTP host (secure loopback default)", () => {
  it("defaults to 127.0.0.1 when nothing is set", () => {
    delete process.env.GYMSYSTEM_HOST;
    expect(resolveHttpHost()).toBe("127.0.0.1");
    expect(DEFAULT_HTTP_HOST).toBe("127.0.0.1");
  });

  it("honours an explicit override (LAN exposure is opt-in)", () => {
    expect(resolveHttpHost("0.0.0.0")).toBe("0.0.0.0");
  });

  it("reads the GYMSYSTEM_HOST env override", () => {
    process.env.GYMSYSTEM_HOST = "0.0.0.0";
    expect(resolveHttpHost()).toBe("0.0.0.0");
  });

  it("falls back to loopback when the override is empty/whitespace", () => {
    expect(resolveHttpHost("")).toBe("127.0.0.1");
    expect(resolveHttpHost("   ")).toBe("127.0.0.1");
    process.env.GYMSYSTEM_HOST = "";
    expect(resolveHttpHost()).toBe("127.0.0.1");
  });
});