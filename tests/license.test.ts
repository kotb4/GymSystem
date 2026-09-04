import { describe, expect, it, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  evaluate,
  isHardLocked,
  needsActivation,
  advanceLastActive,
  stateFromPayload,
  CLOCK_ROLLBACK_TOLERANCE_MS,
  type LicenseState,
} from "../server/license/policy";
import {
  generateKeyPair,
  signLicense,
  verifyLicense,
  exportPrivateKeyPem,
  exportPublicKeyPem,
  issueLicense,
  parseAndVerifyLicense,
} from "../server/license/crypto";
import {
  _resetLicenseSession,
  _setSessionForTest,
  _activateWithPublicKey,
  _overrideHwIdForTest,
  initLicenseSession,
  deactivateLicense,
  rpcBlockReason,
  canWrite,
  licenseStatus,
} from "../server/license/session";
import { createTestDb } from "./helpers/test-db";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gym-license-test-"));
  return dir;
}

function payload(opts: { hwid?: string; expiresAt?: number; issuedAt?: number } = {}) {
  const now = Date.now();
  return {
    hwid: opts.hwid ?? "GYM-AAAA-BBBB-CCCC-DDDD",
    gym: "نادي أبطال",
    issuedAt: opts.issuedAt ?? now - 10 * DAY,
    expiresAt: opts.expiresAt ?? now + 30 * DAY,
    tier: "full",
  };
}

function state(over: Partial<LicenseState>): LicenseState {
  return {
    hwid: "GYM-AAAA-BBBB-CCCC-DDDD",
    lastActive: null,
    payload: payload(),
    now: Date.now(),
    filePresent: true,
    signatureValid: true,
    ...over,
  };
}

describe("license policy (state machine)", () => {
  it("unlicensed when no state file / no payload", () => {
    const s = state({ filePresent: false, payload: null });
    expect(evaluate(s).name).toBe("unlicensed");
    expect(needsActivation(s)).toBe(true);
    expect(isHardLocked(s)).toBe(false);
  });

  it("active while now < expiresAt", () => {
    expect(evaluate(state({})).name).toBe("active");
    expect(needsActivation(state({}))).toBe(false);
    expect(isHardLocked(state({}))).toBe(false);
  });

  it("expired as soon as now is past expiresAt (no grace period)", () => {
    const s = state({ payload: payload({ expiresAt: Date.now() - 1 * DAY }) });
    expect(evaluate(s).name).toBe("expired");
    expect(isHardLocked(s)).toBe(true);
  });

  it("expired exactly at the expiresAt boundary", () => {
    const s = state({ payload: payload({ expiresAt: Date.now() - 1 }) });
    expect(evaluate(s).name).toBe("expired");
  });

  it("stays active until NOW reaches expiresAt (boundary just before)", () => {
    const s = state({ payload: payload({ expiresAt: Date.now() + 1 }) });
    expect(evaluate(s).name).toBe("active");
    expect(isHardLocked(s)).toBe(false);
  });

  it("tampered when clock rolled back beyond rollback tolerance", () => {
    // lastActive far "in the future" vs now => rewind detected
    const s = state({ lastActive: Date.now() + (CLOCK_ROLLBACK_TOLERANCE_MS + 14 * HOUR) });
    expect(evaluate(s).name).toBe("tampered");
    expect(isHardLocked(s)).toBe(true);
  });

  it("tolerates small clock drift backward", () => {
    const s = state({ lastActive: Date.now() - 2 * HOUR });
    expect(evaluate(s).name).toBe("active");
  });

  it("invalid when hwid does not match the bound machine", () => {
    const s = state({ payload: payload({ hwid: "GYM-XXXX-XXXX-XXXX-XXXX" }) });
    expect(evaluate(s).name).toBe("invalid");
    expect(needsActivation(s)).toBe(true);
    expect(isHardLocked(s)).toBe(true);
  });

  it("invalid when signature verification failed", () => {
    const s = state({ signatureValid: false });
    expect(evaluate(s).name).toBe("invalid");
    expect(isHardLocked(s)).toBe(true);
  });

  it("advanceLastActive only moves forward", () => {
    expect(advanceLastActive(null, 1000)).toBe(1000);
    expect(advanceLastActive(1000, 2000)).toBe(2000);
    expect(advanceLastActive(2000, 1500)).toBeNull();
    expect(advanceLastActive(2000, 2000)).toBeNull();
  });

  it("stateFromPayload resets lastActive so a fresh license cannot trip the clock guard", () => {
    const s = stateFromPayload(payload(), "GYM-AAAA-BBBB-CCCC-DDDD");
    expect(s.lastActive).toBeNull();
    expect(s.signatureValid).toBe(true);
  });
});

describe("license crypto (Ed25519 sign/verify)", () => {
  let privPem: string;
  let pubPem: string;

  beforeEach(() => {
    const kp = generateKeyPair();
    privPem = exportPrivateKeyPem(kp);
    pubPem = exportPublicKeyPem(kp);
  });

  it("verifies a genuine signature against the correct public key", () => {
    const lic = signLicense(privPem, JSON.stringify(payload()));
    expect(verifyLicense(lic, pubPem)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const lic = signLicense(privPem, JSON.stringify(payload()));
    const tampered = { ...lic, payload: JSON.stringify(payload({ expiresAt: Date.now() + 100 * DAY })) };
    expect(verifyLicense(tampered, pubPem)).toBe(false);
  });

  it("rejects a signature made by a different key", () => {
    const otherPriv = exportPrivateKeyPem(generateKeyPair());
    const lic = signLicense(otherPriv, JSON.stringify(payload()));
    expect(verifyLicense(lic, pubPem)).toBe(false);
  });

  it("issues and round-trips through parseAndVerifyLicense", () => {
    const licJson = issueLicense(privPem, "GYM-AAAA-BBBB-CCCC-DDDD", "نادي", Date.now(), Date.now() + 365 * DAY);
    const parsed = parseAndVerifyLicense(licJson, pubPem);
    expect(parsed).not.toBeNull();
    expect(parsed!.hwid).toBe("GYM-AAAA-BBBB-CCCC-DDDD");
    expect((parsed!.expiresAt - parsed!.issuedAt) / DAY).toBeCloseTo(365, 0);
  });

  it("parseAndVerifyLicense rejects garbage", () => {
    expect(parseAndVerifyLicense("{invalid", pubPem)).toBeNull();
    expect(parseAndVerifyLicense(JSON.stringify({ payload: "x", signature: "y" }), pubPem)).toBeNull();
  });
});

describe("license session (read-only gate)", () => {
  beforeEach(() => _resetLicenseSession());

  it("allows all RPC when active (no block reason)", () => {
    _setSessionForTest({ payload: payload(), signatureValid: true, filePresent: true, lastActive: null });
    expect(canWrite()).toBe(true);
    expect(rpcBlockReason("subscriptions", "createSubscription")).toBeNull();
  });

  it("total-locks ALL RPC (even reads) once expired — only the license surface stays", () => {
    _setSessionForTest({
      signatureValid: true,
      filePresent: true,
      lastActive: null,
      payload: payload({ expiresAt: Date.now() - 1 * DAY }),
    });
    expect(rpcBlockReason("cash", "openCashSession")).toBe("expired");
    expect(rpcBlockReason("store", "createSale")).toBe("expired");
    expect(rpcBlockReason("subscriptions", "createSubscription")).toBe("expired");
    expect(rpcBlockReason("finance", "getFinanceOverview")).toBe("expired");
    expect(rpcBlockReason("dashboard", "getDashboardStats")).toBe("expired");
    expect(rpcBlockReason("members", "listMembers")).toBe("expired");
    expect(rpcBlockReason("license", "status")).toBeNull();
    expect(rpcBlockReason("license", "activate")).toBeNull();
    expect(rpcBlockReason("license", "deactivate")).toBeNull();
    expect(rpcBlockReason("auth", "needsSetup")).toBeNull();
    expect(canWrite()).toBe(false);
  });

  it("reports tampered and still allows the read-only allowlist", () => {
    _setSessionForTest({
      signatureValid: true,
      filePresent: true,
      lastActive: Date.now() + (CLOCK_ROLLBACK_TOLERANCE_MS + 14 * HOUR),
      payload: payload(),
    });
    expect(rpcBlockReason("subscriptions", "createSubscription")).toBe("tampered");
    expect(rpcBlockReason("dashboard", "getDashboardStats")).toBeNull();
    expect(rpcBlockReason("license", "status")).toBeNull();
  });

  it("activates a matching-hwid license against the given public key", () => {
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp);
    _setSessionForTest({ signatureValid: false, filePresent: false, payload: null, lastActive: null });
    const kp = generateKeyPair();
    const priv = exportPrivateKeyPem(kp);
    const pub = exportPublicKeyPem(kp);
    const hwid = "GYM-AAAA-BBBB-CCCC-DDDD";
    _setSessionForTest({ hwid, signatureValid: false, filePresent: false, payload: null, lastActive: null });
    const lic = issueLicense(priv, hwid, "نادي", Date.now(), Date.now() + 30 * DAY);
    const st = _activateWithPublicKey(lic, pub);
    expect(st.state).toBe("active");
    expect(st.needsActivation).toBe(false);
  });

  it("rejects activation when the license is bound to another HWID", () => {
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp);
    _setSessionForTest({ hwid: "GYM-AAAA-BBBB-CCCC-DDDD", signatureValid: false, filePresent: false, payload: null, lastActive: null });
    const kp = generateKeyPair();
    const priv = exportPrivateKeyPem(kp);
    const pub = exportPublicKeyPem(kp);
    const lic = issueLicense(priv, "GYM-9999-8888-7777-6666", "نادي", Date.now(), Date.now() + 30 * DAY);
    expect(() => _activateWithPublicKey(lic, pub)).toThrow(/HWID_MISMATCH/);
  });

  it("rejects a garbage activation payload", () => {
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp);
    _setSessionForTest({ signatureValid: false, filePresent: false, payload: null, lastActive: null });
    const pub = exportPublicKeyPem(generateKeyPair());
    expect(() => _activateWithPublicKey("{invalid", pub)).toThrow(/LICENSE_INVALID/);
  });

  it("licenseStatus reports state fields", () => {
    _setSessionForTest({ payload: payload(), signatureValid: true, filePresent: true, lastActive: null });
    const st = licenseStatus();
    expect(st.state).toBe("active");
    expect(st.needsActivation).toBe(false);
    expect(st.hwid).toBeTruthy();
    expect(st.daysRemaining).toBe(30);
  });

  it("daysRemaining counts down to expiry only while active", () => {
    const now = Date.now();
    _setSessionForTest({ payload: payload({ expiresAt: now + 3 * DAY }), signatureValid: true, filePresent: true, lastActive: null });
    const active = licenseStatus();
    expect(active.state).toBe("active");
    expect(active.daysRemaining).toBe(3);

    _setSessionForTest({ payload: payload({ expiresAt: now - 2 * DAY }), signatureValid: true, filePresent: true, lastActive: null });
    const expired = licenseStatus();
    expect(expired.state).toBe("expired");
    expect(expired.daysRemaining).toBe(0);
    expect(expired.readOnly).toBe(true);
  });

  it("records the activation marker on activation and falls back to it when the signed files are deleted", () => {
    const db = createTestDb();
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp, db);
    _overrideHwIdForTest( "GYM-AAAA-BBBB-CCCC-DDDD");
    const kp = generateKeyPair();
    const priv = exportPrivateKeyPem(kp);
    const pub = exportPublicKeyPem(kp);
    const lic = issueLicense(priv, "GYM-AAAA-BBBB-CCCC-DDDD", "نادي", Date.now() - 10 * DAY, Date.now() + 30 * DAY);

    expect(_activateWithPublicKey(lic, pub).state).toBe("active");
    const marker = db.first<{ hwid: string; expires_at: number; last_active: number | null }>(
      "SELECT hwid, expires_at, last_active FROM license_activation WHERE hwid = 'GYM-AAAA-BBBB-CCCC-DDDD'",
    );
    expect(marker).not.toBeNull();
    expect(Number(marker!.expires_at)).toBeGreaterThan(Date.now());

    // Simulate the attack: delete the signed files, keep only the DB.
    fs.rmSync(path.join(tmp, "license.lic"), { force: true });
    fs.rmSync(path.join(tmp, "license.json"), { force: true });

    initLicenseSession(tmp, db);
    const st = licenseStatus();
    expect(st.state).toBe("active");
    expect(st.needsActivation).toBe(false);
    expect(canWrite()).toBe(true);
    // expiry comes from the marker-recorded grant
    expect(st.expiresAt).toBeGreaterThan(Date.now() - 40 * DAY);
  });

  it("marker enforces grant period: deleting signed files does NOT escape expired total lock", () => {
    const db = createTestDb();
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp, db);
    _overrideHwIdForTest( "GYM-AAAA-BBBB-CCCC-DDDD");
    const kp = generateKeyPair();
    const priv = exportPrivateKeyPem(kp);
    const pub = exportPublicKeyPem(kp);
    // grant lapsed long ago — activation then marker fallback must be expired
    const lic = issueLicense(priv, "GYM-AAAA-BBBB-CCCC-DDDD", "نادي", Date.now() - 30 * DAY, Date.now() - 20 * DAY);

    expect(_activateWithPublicKey(lic, pub).state).toBe("expired");
    fs.rmSync(path.join(tmp, "license.lic"), { force: true });
    fs.rmSync(path.join(tmp, "license.json"), { force: true });

    initLicenseSession(tmp, db);
    const st = licenseStatus();
    expect(st.state).toBe("expired");
    expect(st.readOnly).toBe(true);
    expect(rpcBlockReason("cash", "openCashSession")).toBe("expired");
    expect(rpcBlockReason("members", "listMembers")).toBe("expired");
    expect(rpcBlockReason("license", "status")).toBeNull();
  });

  it("marker keeps the clock-rollback guard working after the signed files are deleted", () => {
    const db = createTestDb();
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp, db);
    _overrideHwIdForTest( "GYM-AAAA-BBBB-CCCC-DDDD");
    const kp = generateKeyPair();
    const priv = exportPrivateKeyPem(kp);
    const pub = exportPublicKeyPem(kp);
    const lic = issueLicense(priv, "GYM-AAAA-BBBB-CCCC-DDDD", "نادي", Date.now() - 10 * DAY, Date.now() + 30 * DAY);
    _activateWithPublicKey(lic, pub);

    fs.rmSync(path.join(tmp, "license.lic"), { force: true });
    fs.rmSync(path.join(tmp, "license.json"), { force: true });
    initLicenseSession(tmp, db);

    // last_active was advanced at activation/boot; rewind beyond the tolerance
    // (simulated by writing a future last_active into the marker) trips tampered.
    db.run(
      "UPDATE license_activation SET last_active = ? WHERE hwid = 'GYM-AAAA-BBBB-CCCC-DDDD'",
      [Date.now() + (CLOCK_ROLLBACK_TOLERANCE_MS + 14 * HOUR)],
    );
    initLicenseSession(tmp, db);
    expect(licenseStatus().state).toBe("tampered");
    expect(rpcBlockReason("subscriptions", "createSubscription")).toBe("tampered");
  });

  it("explicit deactivation clears the marker, so a truly fresh install stays writable", () => {
    const db = createTestDb();
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp, db);
    _overrideHwIdForTest( "GYM-AAAA-BBBB-CCCC-DDDD");
    const kp = generateKeyPair();
    const priv = exportPrivateKeyPem(kp);
    const pub = exportPublicKeyPem(kp);
    const lic = issueLicense(priv, "GYM-AAAA-BBBB-CCCC-DDDD", "نادي", Date.now() - 10 * DAY, Date.now() + 30 * DAY);
    _activateWithPublicKey(lic, pub);
    expect(db.count("SELECT COUNT(*) AS c FROM license_activation")).toBe(1);

    deactivateLicense();
    expect(db.count("SELECT COUNT(*) AS c FROM license_activation")).toBe(0);
    expect(licenseStatus().state).toBe("unlicensed");
    expect(canWrite()).toBe(true);
  });
});

