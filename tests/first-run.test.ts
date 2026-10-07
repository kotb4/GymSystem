import { describe, expect, it } from "vitest";
import { canAdoptFirstRun, isLoopbackAddress, isDirectPhysicalLocalRequest } from "../server/first-run";

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

describe("isDirectPhysicalLocalRequest", () => {
  it("accepts direct loopback requests without proxy headers", () => {
    expect(isDirectPhysicalLocalRequest("127.0.0.1")).toBe(true);
    expect(isDirectPhysicalLocalRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: {} })).toBe(true);
    expect(isDirectPhysicalLocalRequest({ socket: { remoteAddress: "::1" }, headers: {} })).toBe(true);
  });

  it("rejects loopback requests with Cloudflare or proxy forwarding headers", () => {
    expect(
      isDirectPhysicalLocalRequest({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "cf-connecting-ip": "203.0.113.1" },
      }),
    ).toBe(false);

    expect(
      isDirectPhysicalLocalRequest({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-forwarded-for": "198.51.100.2" },
      }),
    ).toBe(false);

    expect(
      isDirectPhysicalLocalRequest({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-real-ip": "198.51.100.3" },
      }),
    ).toBe(false);

    expect(
      isDirectPhysicalLocalRequest({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "cf-visitor": '{"scheme":"https"}' },
      }),
    ).toBe(false);
  });

  it("rejects non-loopback addresses even without proxy headers", () => {
    expect(
      isDirectPhysicalLocalRequest({
        socket: { remoteAddress: "192.168.1.100" },
        headers: {},
      }),
    ).toBe(false);
  });
});

describe("first-run adoption policy", () => {
  it("allows a legitimate first-run import from localhost while no owner exists", () => {
    expect(canAdoptFirstRun(false, "127.0.0.1")).toBe(true);
    expect(canAdoptFirstRun(false, "::1")).toBe(true);
    expect(canAdoptFirstRun(false, "::ffff:127.0.0.1")).toBe(true);
    expect(canAdoptFirstRun(false, { socket: { remoteAddress: "127.0.0.1" }, headers: {} })).toBe(true);
  });

  it("rejects an unauthorized import coming from another machine on the network", () => {
    expect(canAdoptFirstRun(false, "192.168.1.50")).toBe(false);
    expect(canAdoptFirstRun(false, "::ffff:10.0.0.7")).toBe(false);
    expect(canAdoptFirstRun(false, undefined)).toBe(false);
  });

  it("rejects import coming through Cloudflare Tunnel or reverse proxy even when socket is loopback", () => {
    expect(
      canAdoptFirstRun(false, {
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "cf-connecting-ip": "198.51.100.4" },
      }),
    ).toBe(false);
  });

  it("refuses unauthenticated import once an owner exists, even from localhost", () => {
    expect(canAdoptFirstRun(true, "127.0.0.1")).toBe(false);
    expect(canAdoptFirstRun(true, "::1")).toBe(false);
  });
});
