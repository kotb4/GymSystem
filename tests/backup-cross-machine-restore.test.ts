import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Cross-Machine Backup Restore Verification", () => {
  it("restores a password-encrypted backup on a clean foreign machine without DPAPI keys", async () => {
    // -------------------------------------------------------------------------
    // Phase 1: Machine A - Create database, configure backup password, create data & backup
    // -------------------------------------------------------------------------
    const dirMachineA = mkdtempSync(join(tmpdir(), "gym-machine-a-"));
    process.env.GYMSYSTEM_DATA_DIR = dirMachineA;
    process.env.GYM_SEED_DEMO = "";

    const contextModule = await import("../server/context");
    const ctxA = contextModule.openDatabase();

    const { setup, buildActor } = await import("@/core/services/auth.service");
    const ownerA = buildActor(
      await setup(ctxA.db as never, {
        gymName: "Gym Machine A",
        ownerFullName: "كابتن جهاز أ",
        username: "owner_a",
        password: "OwnerPassword123!",
      }),
    );

    const { setBackupPassword } = await import("../server/backup-key");
    const BACKUP_PASS = "StrictCrossMachinePass123!";
    await setBackupPassword(ctxA.db as never, ownerA, { password: BACKUP_PASS });

    const { createMember } = await import("@/core/services/members.service");
    const memberA = await createMember(ctxA.db as never, ownerA, {
      fullName: "مشترك الجهاز الأول",
      phone: "01098765432",
    });

    const backupsModule = await import("../server/backups");
    const snapshotA = await backupsModule.createServerBackup(ownerA, "manual");
    expect(snapshotA.encrypted).toBe(true);

    const snapshotBytesA = backupsModule.readSnapshotBytes(ownerA, snapshotA.fileName);
    expect(snapshotBytesA.length).toBeGreaterThan(1000);

    // Close Machine A
    contextModule.closeDatabase(ctxA);

    // -------------------------------------------------------------------------
    // Phase 2: Machine B - Completely foreign clean machine, NO keys from Machine A
    // -------------------------------------------------------------------------
    const dirMachineB = mkdtempSync(join(tmpdir(), "gym-machine-b-"));
    process.env.GYMSYSTEM_DATA_DIR = dirMachineB;

    const ctxB = contextModule.openDatabase();
    expect(ctxB.dirs.configDir).not.toBe(ctxA.dirs.configDir);

    const ownerBUser = await setup(ctxB.db as never, {
      gymName: "Empty Machine B",
      ownerFullName: "كابتن جهاز ب",
      username: "owner_b",
      password: "TempPassword123!",
    });
    const ownerB = buildActor(ownerBUser);

    // 1. Attempting restore with WRONG password on foreign machine must fail
    await expect(
      backupsModule.importDatabaseBytes(ownerB, snapshotBytesA, {
        kind: "restore",
        password: "WrongPassword999!",
      }),
    ).rejects.toThrow();

    // 2. Attempting restore with the CORRECT password on foreign machine must succeed
    const restoreReport = await backupsModule.importDatabaseBytes(ownerB, snapshotBytesA, {
      kind: "restore",
      password: BACKUP_PASS,
    });

    expect(restoreReport.integrityStatus).toBe("ok");
    expect(restoreReport.fullyVerified).toBe(true);

    // 3. Verify data on Machine B matches Machine A
    const liveCtx = contextModule.getDbContext();
    const restoredMember = liveCtx.db.first<{ full_name: string; phone: string }>(
      "SELECT full_name, phone FROM members WHERE id = ?",
      [memberA.id],
    );

    expect(restoredMember).not.toBeNull();
    expect(restoredMember?.full_name).toBe("مشترك الجهاز الأول");
    expect(restoredMember?.phone).toBe("01098765432");

    // Cleanup
    contextModule.closeDatabase(liveCtx);
    try {
      rmSync(dirMachineA, { recursive: true, force: true });
      rmSync(dirMachineB, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
