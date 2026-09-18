import { describe, expect, it } from "vitest";
import { canAdoptFirstRun, isLoopbackAddress } from "../server/first-run";

/**
 * First-run network gate (ADR-023 follow-up). The unauthenticated
 * initialization routes (`POST /api/auth/setup` and the no-owner
 * `POST /api/system/import-legacy`) must only ever run from the local machine.
 *
 * Functional first-run/migration behavior (a valid legacy adoption succeeds,
 * and import is refused once an owner exists) is covered end-to-end in
 * tests/restore-authz.test.ts; these tests pin the network exposure rule.
 */
describe("isLoopbackAddress", () => {
  it("accepts the loopback interface in every form Node reports", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects LAN/unknown peers", () => {
    expect(isLoopbackAddress("192.168.1.50")).toBe(false);
    expect(isLoopbackAddress("10.0.0.7")).toBe(false);
    expect(isLoopbackAddress("::ffff:192.168.1.50")).toBe(false);
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
  });
});

describe("first-run adoption policy", () => {
  it("allows a legitimate first-run import from localhost while no owner exists", () => {
    expect(canAdoptFirstRun(false, "127.0.0.1")).toBe(true);
    expect(canAdoptFirstRun(false, "::1")).toBe(true);
    expect(canAdoptFirstRun(false, "::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects an unauthorized import coming from another machine on the network", () => {
    expect(canAdoptFirstRun(false, "192.168.1.50")).toBe(false);
    expect(canAdoptFirstRun(false, "::ffff:10.0.0.7")).toBe(false);
    expect(canAdoptFirstRun(false, undefined)).toBe(false);
  });

  it("refuses unauthenticated import once an owner exists, even from localhost", () => {
    expect(canAdoptFirstRun(true, "127.0.0.1")).toBe(false);
    expect(canAdoptFirstRun(true, "::1")).toBe(false);
  });
});
