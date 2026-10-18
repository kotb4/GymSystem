import { describe, expect, it, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createTestDb } from "./helpers/test-db";
import {
  isDeveloperActor,
  ensureDeveloperAccount,
  getDeveloperOverview,
  setSystemReadOnly,
  toggleUserActive,
  suspendAllNonDevUsers,
  activateAllUsers,
  devResetUserPassword,
  devDeleteUser,
  devSeedDemoData,
  devRunIntegrityCheck,
  devVacuumDatabase,
  devResetOwnerEmergency,
  getFeatureFlags,
  setFeatureFlag,
} from "../src/core/services/developer.service";
import { needsSetup, setup } from "../src/core/services/auth.service";
import { countTotalOwners } from "../src/core/services/users.service";
import {
  _resetLicenseSession,
  _setSessionForTest,
  grantEmergencyGrace,
  resetClockTamper,
  licenseStatus,
} from "../server/license/session";
import { readSetting, SETTING_KEYS } from "../src/core/services/settings.service";
import type { ServiceActor } from "../src/core/permissions";
import { verifyPassword } from "../src/core/auth/password";

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gym-dev-test-"));
}

describe("Developer Console & Management", () => {
  let db: ReturnType<typeof createTestDb>;

  const devActor: ServiceActor = {
    userId: "dev-kotb-superadmin",
    username: "kotb",
    roleId: "owner",
    isDeveloper: true,
  };

  const managerActor: ServiceActor = {
    userId: "manager-1",
    username: "manager",
    roleId: "manager",
    isDeveloper: false,
  };

  beforeEach(() => {
    db = createTestDb();
    ensureDeveloperAccount(db);
  });

  it("identifies developer actors correctly", () => {
    expect(isDeveloperActor(devActor)).toBe(true);
    expect(isDeveloperActor({ userId: "u1", username: "KOTB", roleId: "owner", isDeveloper: true })).toBe(true);
    expect(isDeveloperActor({ userId: "u1", username: "KOTB", roleId: "owner", isDeveloper: false })).toBe(false);
    expect(isDeveloperActor(managerActor)).toBe(false);
    expect(isDeveloperActor(null)).toBe(false);
  });

  it("ensures developer account exists with superadmin owner role", () => {
    const devRow = db.first<{ username: string; role_id: string; is_developer: number }>(
      "SELECT username, role_id, is_developer FROM users WHERE username = 'kotb'",
    );
    expect(devRow).toBeDefined();
    expect(devRow?.role_id).toBe("owner");
    expect(Number(devRow?.is_developer)).toBe(1);
  });

  it("gets developer overview with users, stats and read-only status", () => {
    expect(() => getDeveloperOverview(db, managerActor)).toThrow();

    const overview = getDeveloperOverview(db, devActor, 1024);
    expect(overview.systemReadOnly).toBe(false);
    expect(overview.stats.dbSizeBytes).toBe(1024);
    expect(overview.users.some((u) => u.username === "kotb")).toBe(true);
  });

  it("toggles system read-only mode", () => {
    expect(() => setSystemReadOnly(db, managerActor, true)).toThrow();

    const res1 = setSystemReadOnly(db, devActor, true);
    expect(res1.systemReadOnly).toBe(true);
    expect(readSetting(db, SETTING_KEYS.systemReadOnly)).toBe("1");

    const res2 = setSystemReadOnly(db, devActor, false);
    expect(res2.systemReadOnly).toBe(false);
    expect(readSetting(db, SETTING_KEYS.systemReadOnly)).toBe("0");
  });

  it("allows developer to suspend and reactivate any account including the owner", async () => {
    // Insert a normal owner
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, is_developer, created_at, updated_at) VALUES ('owner-1', 'realowner', 'o@gym.com', 'hash', 'Real Owner', 'owner', 1, 0, '2026-01-01', '2026-01-01')",
    );

    // Developer deactivates the owner
    const deactivated = await toggleUserActive(db, devActor, "owner-1", false);
    expect(deactivated.isActive).toBe(false);

    const row = db.first<{ is_active: number }>("SELECT is_active FROM users WHERE id = 'owner-1'");
    expect(Number(row?.is_active)).toBe(0);

    // Developer reactivates the owner
    const reactivated = await toggleUserActive(db, devActor, "owner-1", true);
    expect(reactivated.isActive).toBe(true);
  });

  it("suspends all non-developer users and reactivates them", () => {
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, is_developer, created_at, updated_at) VALUES ('u-1', 'staff1', 's1@gym.com', 'hash', 'Staff 1', 'reception', 1, 0, '2026-01-01', '2026-01-01')",
    );
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, is_developer, created_at, updated_at) VALUES ('u-2', 'staff2', 's2@gym.com', 'hash', 'Staff 2', 'trainer', 1, 0, '2026-01-01', '2026-01-01')",
    );

    const suspended = suspendAllNonDevUsers(db, devActor);
    expect(suspended.affected).toBeGreaterThanOrEqual(2);

    const activeNonDev = db.count("SELECT COUNT(*) FROM users WHERE COALESCE(is_developer, 0) = 0 AND is_active = 1");
    expect(activeNonDev).toBe(0);

    const devUser = db.first<{ is_active: number }>("SELECT is_active FROM users WHERE username = 'kotb'");
    expect(Number(devUser?.is_active)).toBe(1);

    const activated = activateAllUsers(db, devActor);
    expect(activated.affected).toBeGreaterThanOrEqual(2);

    const activeAfter = db.count("SELECT COUNT(*) FROM users WHERE is_active = 1");
    expect(activeAfter).toBeGreaterThanOrEqual(3);
  });

  it("resets user password with strength validation", async () => {
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, is_developer, created_at, updated_at) VALUES ('target-user', 'target', 't@gym.com', 'oldhash', 'Target', 'reception', 1, 0, '2026-01-01', '2026-01-01')",
    );

    await devResetUserPassword(db, devActor, "target-user", "NewStrong@2026");

    const row = db.first<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = 'target-user'");
    expect(row).toBeDefined();
    const ok = await verifyPassword("NewStrong@2026", row!.password_hash);
    expect(ok).toBe(true);
  });

  it("grants emergency grace period and resets clock directly", () => {
    const tmp = mkTmpDir();
    _resetLicenseSession(tmp, db);
    _setSessionForTest({
      filePresent: true,
      signatureValid: true,
      lastActive: Date.now() + 100000,
      payload: {
        hwid: "TEST-HWID",
        gym: "Test Gym",
        issuedAt: Date.now() - 30 * 86400000,
        expiresAt: Date.now() - 1000, // expired
        tier: "full",
      },
    });

    const statusBefore = licenseStatus();
    expect(statusBefore.daysRemaining).toBe(0);

    // Grant 7 days grace
    const graceRes = grantEmergencyGrace(7, db);
    expect(graceRes.days).toBe(7);
    expect(graceRes.expiresAt).toBeGreaterThan(Date.now());

    // Reset clock tamper
    resetClockTamper(db);
    const statusAfter = licenseStatus();
    expect(statusAfter.daysRemaining).toBeGreaterThanOrEqual(6);
  });

  it("suspending all users does NOT trigger first-run setup (needsSetup remains false)", async () => {
    // 1. Initial setup creates the first owner
    await setup(db, {
      gymName: "Main Gym",
      ownerFullName: "Gym Owner",
      username: "theowner",
      password: "OwnerPassword@2026",
    });
    expect(needsSetup(db)).toBe(false);
    expect(countTotalOwners(db)).toBe(1);

    // 2. Developer suspends all non-developer users (including the owner)
    suspendAllNonDevUsers(db, devActor);

    // 3. All non-dev users are inactive, but owner exists in DB
    const ownerRow = db.first<{ is_active: number }>("SELECT is_active FROM users WHERE username = 'theowner'");
    expect(Number(ownerRow?.is_active)).toBe(0);

    // 4. CRITICAL: needsSetup MUST remain false so setup page is never opened!
    expect(needsSetup(db)).toBe(false);
    expect(countTotalOwners(db)).toBe(1);

    // 5. Trying to run setup again is rejected with CONFLICT
    await expect(
      setup(db, {
        gymName: "Another Gym",
        ownerFullName: "Hacker",
        username: "hacker",
        password: "HackerPassword@2026",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("deletes a user and safely detaches foreign keys without errors", () => {
    // Insert a target user
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, is_developer, created_at, updated_at) VALUES ('del-target', 'todelete', 'd@gym.com', 'hash', 'To Delete', 'reception', 1, 0, '2026-01-01', '2026-01-01')",
    );
    // Insert an active session for that user
    db.run(
      "INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES ('tok123', 'del-target', '2026-01-01', '2026-01-01', '2026-01-02')",
    );

    // Insert an audit log referencing the user
    db.run(
      "INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, metadata, created_at) VALUES ('del-target', 'todelete', 'LOGIN', 'auth', 'del-target', '{}', '2026-01-01')",
    );

    // Delete the user
    const res = devDeleteUser(db, devActor, "del-target");
    expect(res.success).toBe(true);
    expect(res.deletedUsername).toBe("todelete");

    // User is gone from users table
    const userRow = db.first<{ id: string }>("SELECT id FROM users WHERE id = 'del-target'");
    expect(userRow).toBeNull();

    // Session is gone
    const sessionRow = db.first<{ token_hash: string }>("SELECT token_hash FROM auth_sessions WHERE user_id = 'del-target'");
    expect(sessionRow).toBeNull();

    // Audit log user_id is detached to NULL
    const logRow = db.first<{ user_id: string | null }>("SELECT user_id FROM audit_logs WHERE user_name = 'todelete'");
    expect(logRow?.user_id).toBeNull();

    // Refuses to delete the developer account
    expect(() => devDeleteUser(db, devActor, "dev-kotb-superadmin")).toThrow();

    // Refuses to delete self
    expect(() => devDeleteUser(db, devActor, devActor.userId)).toThrow();
  });

  it("seeds demo marketing data when invoked by developer actor", async () => {
    // Non-developer actor is denied
    await expect(devSeedDemoData(db, managerActor)).rejects.toThrow();

    // Developer actor succeeds
    const result = await devSeedDemoData(db, devActor);
    expect(result.success).toBe(true);
    expect(result.membersCount).toBeGreaterThan(0);
    expect(result.subscriptionsCount).toBeGreaterThan(0);

    // Verify payments and ledger were populated
    const paymentsCount = db.count("SELECT COUNT(*) FROM payments");
    expect(paymentsCount).toBeGreaterThan(0);

    const ledgerCount = db.count("SELECT COUNT(*) FROM financial_ledger WHERE entry_type = 'payment'");
    expect(ledgerCount).toBeGreaterThan(0);
  });

  it("runs database integrity check and foreign key check", () => {
    // Non-developer actor is denied
    expect(() => devRunIntegrityCheck(db, managerActor)).toThrow();

    // Developer actor gets integrity status
    const result = devRunIntegrityCheck(db, devActor);
    expect(result.integrity.toLowerCase()).toBe("ok");
    expect(result.foreignKeysOk).toBe(true);
    expect(result.fkViolations).toEqual([]);
  });

  it("executes database VACUUM when requested by developer", () => {
    // Non-developer actor is denied
    expect(() => devVacuumDatabase(db, managerActor)).toThrow();

    // Developer actor succeeds
    const result = devVacuumDatabase(db, devActor);
    expect(result.success).toBe(true);
  });

  it("resets owner password and unlocks account in emergency", async () => {
    // Setup regular owner
    await setup(db, {
      gymName: "Test Gym",
      username: "realowner",
      password: "OriginalPassword123!",
      ownerFullName: "Real Owner",
    });

    // Lock the owner account
    db.run(
      "UPDATE users SET is_active = 0, failed_attempts = 5, locked_until = '2099-01-01' WHERE username = 'realowner'",
    );

    // Non-developer actor is denied
    await expect(devResetOwnerEmergency(db, managerActor, "NewSecretPass123!")).rejects.toThrow();

    // Developer resets owner
    const res = await devResetOwnerEmergency(db, devActor, "NewSecretPass123!");
    expect(res.success).toBe(true);
    expect(res.username).toBe("realowner");

    // Verify account is active and unlocked
    const ownerRow = db.first<{ is_active: number; failed_attempts: number; locked_until: string | null; password_hash: string }>(
      "SELECT is_active, failed_attempts, locked_until, password_hash FROM users WHERE username = 'realowner'",
    );
    expect(ownerRow?.is_active).toBe(1);
    expect(ownerRow?.failed_attempts).toBe(0);
    expect(ownerRow?.locked_until).toBeNull();

    // Verify new password works
    const ok = await verifyPassword("NewSecretPass123!", ownerRow!.password_hash);
    expect(ok).toBe(true);
  });

  it("manages feature flags accurately", () => {
    // Non-developer actor is denied
    expect(() => getFeatureFlags(db, managerActor)).toThrow();
    expect(() => setFeatureFlag(db, managerActor, "featurePosEnabled", false)).toThrow();

    // Developer actor reads default flags (all true by default)
    const flags = getFeatureFlags(db, devActor);
    expect(flags.featureAttendanceEnabled).toBe(true);
    expect(flags.featureMembersEnabled).toBe(true);
    expect(flags.featureSubscriptionsEnabled).toBe(true);
    expect(flags.featureCardsEnabled).toBe(true);
    expect(flags.featureTreasuryEnabled).toBe(true);
    expect(flags.featureExpensesEnabled).toBe(true);
    expect(flags.featurePosEnabled).toBe(true);
    expect(flags.featureReportsEnabled).toBe(true);
    expect(flags.featureClassesEnabled).toBe(true);
    expect(flags.featureInbodyEnabled).toBe(true);
    expect(flags.featureWhatsappEnabled).toBe(true);
    expect(flags.featureCrmEnabled).toBe(true);
    expect(flags.featureLoyaltyEnabled).toBe(true);
    expect(flags.featureReferralsEnabled).toBe(true);
    expect(flags.featureEmployeesEnabled).toBe(true);
    expect(flags.featureHrCheckinEnabled).toBe(true);
    expect(flags.featureMultibranchEnabled).toBe(true);

    // Toggle POS module off
    const updated = setFeatureFlag(db, devActor, "featurePosEnabled", false);
    expect(updated.featurePosEnabled).toBe(false);

    // Re-read flags
    const fresh = getFeatureFlags(db, devActor);
    expect(fresh.featurePosEnabled).toBe(false);

    // Toggle POS module back on
    setFeatureFlag(db, devActor, "featurePosEnabled", true);
    expect(getFeatureFlags(db, devActor).featurePosEnabled).toBe(true);

    // Toggle attendance module
    setFeatureFlag(db, devActor, "featureAttendanceEnabled", false);
    expect(getFeatureFlags(db, devActor).featureAttendanceEnabled).toBe(false);
  });
});
