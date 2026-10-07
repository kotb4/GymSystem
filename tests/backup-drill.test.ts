import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceActor } from "@/core/permissions";

describe("Test 6: Backup Integrity & Disaster Recovery Drill", () => {
  it(
    "creates an encrypted .gymbak snapshot with database & files, completely wipes local disk, and recovers 100% of data and files onto a clean environment",
    async () => {
      console.log("\n=======================================================");
      console.log("⚡ STARTING BACKUP INTEGRITY & RESTORE DRILL (TEST 6)");
      console.log("=======================================================");

      // Phase 1: Initialize operational Gym instance with members, financial transactions, and files
      const dirOrigin = mkdtempSync(join(tmpdir(), "gym-drill-origin-"));
      process.env.GYMSYSTEM_DATA_DIR = dirOrigin;
      delete process.env.VITE_SEED_DEMO;
      process.env.GYM_SEED_DEMO = "";

      const contextModule = await import("../server/context");
      const ctxOrigin = contextModule.openDatabase();

      const { setup, buildActor } = await import("@/core/services/auth.service");
      const ownerUser = await setup(ctxOrigin.db as never, {
        gymName: "Yassen Mohamed Kotb | 01288536381",
        ownerFullName: "كابتن ياسين قطب",
        username: "yassen_owner",
        password: "OwnerMasterPassword@2026",
      });
      const owner = buildActor(ownerUser);

      const { createMember } = await import("@/core/services/members.service");
      const { createPlan } = await import("@/core/services/plans.service");
      const { createSubscription } = await import("@/core/services/subscriptions.service");
      const { recordPayment } = await import("@/core/services/payments.service");
      const { recordCheckIn } = await import("@/core/services/attendance.service");
      const filesService = await import("../server/files.service");
      const backupsModule = await import("../server/backups");

      console.log("\n1. Populating active business state (Members, Subscriptions, Payments, Attendance, and Files)...");

      const plan = await createPlan(ctxOrigin.db as never, owner, {
        name: "باقة سنوية VIP شاملة",
        durationDays: 365,
        price: 3600,
        kind: "time",
      });

      const member1 = await createMember(ctxOrigin.db as never, owner, {
        fullName: "محمد أحمد الحنفي",
        phone: "01011112233",
      });

      const member2 = await createMember(ctxOrigin.db as never, owner, {
        fullName: "كريم سامح عثمان",
        phone: "01022223344",
      });

      const card1 = ctxOrigin.db.first<{ barcode_value: string }>(
        "SELECT barcode_value FROM cards WHERE member_id = ?",
        [member1.id]
      )!;

      const sub1 = await createSubscription(ctxOrigin.db as never, owner, {
        memberId: member1.id,
        planId: plan.id,
        startDate: "2026-10-01",
      });

      await recordPayment(ctxOrigin.db as never, owner, {
        memberId: member1.id,
        subscriptionId: sub1.id,
        baseAmountMinor: 360000,
        paidAmountMinor: 360000,
        methodCode: "cash",
      });

      await recordCheckIn(ctxOrigin.db as never, owner, {
        barcode: card1.barcode_value,
      });

      // Save binary file assets (member photo and inbody report)
      const fakePhotoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
      const photoId = "photo-drill-1";
      filesService.saveRawBytes(ctxOrigin.db as never, owner, {
        id: photoId,
        kind: "member_photo",
        originalName: "avatar.jpg",
        mimeType: "image/jpeg",
        bytes: fakePhotoBytes,
      });

      ctxOrigin.db.run("UPDATE members SET photo_file_id = ? WHERE id = ?", [photoId, member1.id]);

      const fakePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 10, 20, 30, 40, 50]);
      filesService.saveRawBytes(ctxOrigin.db as never, owner, {
        id: "inbody-drill-1",
        kind: "inbody_report",
        originalName: "assessment.pdf",
        mimeType: "application/pdf",
        bytes: fakePdfBytes,
      });

      const preMembers = ctxOrigin.db.count("SELECT COUNT(*) FROM members");
      const prePayments = ctxOrigin.db.count("SELECT COUNT(*) FROM payments");
      const preLedger = ctxOrigin.db.count("SELECT COUNT(*) FROM financial_ledger");
      const preAttendance = ctxOrigin.db.count("SELECT COUNT(*) FROM attendance");
      const preFiles = filesService.listAllFiles(ctxOrigin.db as never).length;

      console.log(`   Baseline State: ${preMembers} members, ${prePayments} payments, ${preLedger} ledger rows, ${preAttendance} check-ins, ${preFiles} binary files.`);
      expect(preMembers).toBe(2);
      expect(prePayments).toBe(1);
      expect(preLedger).toBe(1);
      expect(preAttendance).toBe(1);
      expect(preFiles).toBe(2);

      // Phase 2: Create complete snapshot
      console.log("\n2. Creating verified .gymbak backup snapshot with full file assets bundle...");
      const snapshot = await backupsModule.createServerBackup(owner, "manual");
      console.log(`   ✓ Snapshot created: ${snapshot.fileName} (${snapshot.sizeBytes.toLocaleString()} bytes)`);
      expect(snapshot.fullyVerified).toBe(true);
      expect(snapshot.databaseIntegrity).toBe("ok");
      expect(snapshot.fileAssetsCount).toBe(2);

      const snapshotBytes = backupsModule.readSnapshotBytes(owner, snapshot.fileName);
      expect(snapshotBytes.length).toBe(snapshot.sizeBytes);

      // Phase 3: Total Disaster Simulation (Close handles and completely delete origin directory)
      console.log("\n3. 💥 Simulating Complete Data Destruction (Wiping entire database and files tree)...");
      contextModule.closeDatabase();
      rmSync(dirOrigin, { recursive: true, force: true });
      console.log("   ✓ Origin disk storage completely purged and deleted.");

      // Phase 4: Disaster Recovery onto Fresh Destination Directory
      console.log("\n4. 🔄 Initiating Disaster Recovery onto clean, wiped environment...");
      const dirDest = mkdtempSync(join(tmpdir(), "gym-drill-dest-"));
      process.env.GYMSYSTEM_DATA_DIR = dirDest;

      // Boot clean environment
      const ctxDest = contextModule.openDatabase();
      const ownerDestUser = await setup(ctxDest.db as never, {
        gymName: "Empty Recovery Node",
        ownerFullName: "Recovery Admin",
        username: "admin_recover",
        password: "TempPassword@2026",
      });
      const ownerDest = buildActor(ownerDestUser);

      // Restore the snapshot bytes
      console.log("   -> Importing and adopting snapshot archive...");
      const restoreReport = await backupsModule.importDatabaseBytes(ownerDest, snapshotBytes, { kind: "restore" });

      console.log(`   ✓ Restore completed: ${restoreReport.filesRestored} files restored, schema v${restoreReport.schemaVersion}`);
      expect(restoreReport.integrityStatus).toBe("ok");
      expect(restoreReport.fullyVerified).toBe(true);
      expect(restoreReport.filesRestored).toBe(2);
      expect(restoreReport.filesMissing).toBe(0);

      // Phase 5: 100% Data Verification on Restored System
      console.log("\n5. 🔍 Auditing 100% data fidelity on recovered system...");
      const liveCtx = contextModule.getDbContext();

      const postMembers = liveCtx.db.count("SELECT COUNT(*) FROM members");
      const postPayments = liveCtx.db.count("SELECT COUNT(*) FROM payments");
      const postLedger = liveCtx.db.count("SELECT COUNT(*) FROM financial_ledger");
      const postAttendance = liveCtx.db.count("SELECT COUNT(*) FROM attendance");
      const postFiles = filesService.listAllFiles(liveCtx.db as never);

      console.log(`   Restored State: ${postMembers} members, ${postPayments} payments, ${postLedger} ledger rows, ${postAttendance} check-ins, ${postFiles.length} binary files.`);

      expect(postMembers).toBe(preMembers);
      expect(postPayments).toBe(prePayments);
      expect(postLedger).toBe(preLedger);
      expect(postAttendance).toBe(preAttendance);
      expect(postFiles.length).toBe(preFiles);

      // Verify specific member names and balances
      const restoredMember1 = liveCtx.db.first<{ full_name: string; phone: string; photo_file_id: string }>(
        "SELECT full_name, phone, photo_file_id FROM members WHERE id = ?",
        [member1.id]
      )!;
      expect(restoredMember1.full_name).toBe("محمد أحمد الحنفي");
      expect(restoredMember1.phone).toBe("01011112233");
      expect(restoredMember1.photo_file_id).toBe(photoId);

      // Verify physical restored files on disk match byte-for-byte
      const restoredPhoto = filesService.readFileBytes(liveCtx.db as never, photoId);
      expect(restoredPhoto).not.toBeNull();
      expect(Array.from(restoredPhoto!.bytes)).toEqual(Array.from(fakePhotoBytes));

      const restoredPdf = filesService.readFileBytes(liveCtx.db as never, "inbody-drill-1");
      expect(restoredPdf).not.toBeNull();
      expect(Array.from(restoredPdf!.bytes)).toEqual(Array.from(fakePdfBytes));

      // Database integrity check
      const integrity = liveCtx.db.scalar<string>("PRAGMA integrity_check");
      expect(integrity).toBe("ok");
      console.log(`   ✓ SQLite PRAGMA integrity_check on restored system: ${integrity}`);

      liveCtx.driver.close();
      rmSync(dirDest, { recursive: true, force: true });

      console.log("\n✓ DISASTER RECOVERY DRILL PASSED WITH 100% DATA & FILE ASSET FIDELITY.");
      console.log("=======================================================\n");
    },
    30000
  );
});
