import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_HTTP_HOST, resolveHttpHost } from "../server/config";

/**
 * Regression tests for the bind-host default (0.0.0.0 enables LAN and Tailscale
 * mesh network access out of the box, with setup guarded by isDirectPhysicalLocalRequest).
 */

afterEach(() => {
  delete process.env.GYMSYSTEM_HOST;
});

describe("default HTTP host", () => {
  it("defaults to 0.0.0.0 when nothing is set", () => {
    delete process.env.GYMSYSTEM_HOST;
    expect(resolveHttpHost()).toBe("0.0.0.0");
    expect(DEFAULT_HTTP_HOST).toBe("0.0.0.0");
  });

  it("honours an explicit override (e.g. restricting to 127.0.0.1)", () => {
    expect(resolveHttpHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("reads the GYMSYSTEM_HOST env override", () => {
    process.env.GYMSYSTEM_HOST = "127.0.0.1";
    expect(resolveHttpHost()).toBe("127.0.0.1");
  });

  it("falls back to default when the override is empty/whitespace", () => {
    expect(resolveHttpHost("")).toBe("0.0.0.0");
    expect(resolveHttpHost("   ")).toBe("0.0.0.0");
    process.env.GYMSYSTEM_HOST = "";
    expect(resolveHttpHost()).toBe("0.0.0.0");
  });
});