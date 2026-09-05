import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/core/permissions";

/**
 * TASK-040 end-to-end coverage for the GYMBAK-FILES-V1 trailer:
 *  - create a snapshot that really embeds Files/ bytes;
 *  - verify the buffer (trailer parse + embedded DB integrity + per-file sha
 *    against the `files` manifest) WITHOUT touching live state;
 *  - restore onto a FRESH data dir (disaster recovery: DB + Files destroyed);
 *  - corrupt / truncated / legacy-with-files backups fail BEFORE any mutation.
 */
interface BootedContext {
  db: {
    run(sql: string, params?: unknown[]): unknown;
    scalar(sql: string, params?: unknown[]): unknown;
    count(sql: string, params?: unknown[]): number;
    first<T = unknown>(sql: string, params?: unknown[]): T | null;
    transaction<T>(fn: () => T): T;
  };
  driver: { close(): void; exportBytes(): Uint8Array | null };
  dirs: { dbFile: string; backupsDir: string; filesDir: string; databaseDir: string };
}

const cleanups: Array<() => void> = [];

async function boot(dir: string): Promise<{ ctx: BootedContext; contextModule: typeof import("../server/context") }> {
  process.env.GYMSYSTEM_DATA_DIR = dir;
  delete process.env.VITE_SEED_DEMO;
  process.env.GYM_SEED_DEMO = "";
  vi.resetModules();
  const contextModule = await import("../server/context");
  const ctx = contextModule.openDatabase() as BootedContext;
  cleanups.push(() => {
    try {
      ctx.driver.close();
    } catch {
      /* already closed by adopt */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return { ctx, contextModule };
}

async function setupOwner(ctx: BootedContext): Promise<ServiceActor> {
  const { setup, buildActor } = await import("@/core/services/auth.service");
  const user = await setup(ctx.db as never, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  return buildActor(user);
}

/**
 * Build an actor whose `users` row EXISTS in the given (live) database. The
 * pre-restore protective snapshot records `created_by` with a users FK, so the
 * actor passed to importDatabaseBytes must be present in the CURRENT live DB,
 * which changes as restores replace it.
 */
async function liveOwnerActor(ctx: BootedContext): Promise<ServiceActor> {
  const { buildActor } = await import("@/core/services/auth.service");
  const row = ctx.db.first<{ id: string; username: string; full_name: string; role_id: string; department?: string }>(
    "SELECT id, username, full_name, role_id, department FROM users WHERE role_id = 'owner' LIMIT 1",
  );
  if (!row) throw new Error("no owner in live db");
  return buildActor({
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    roleId: row.role_id as ServiceActor["roleId"],
    department: (row.department ?? undefined) as ServiceActor["department"],
  });
}

/** Minimal fake JPEG that satisfies the magic sniff (FF D8 FF ...). */
function jpegBytes(size = 64): Uint8Array {
  const buf = new Uint8Array(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  for (let i = 4; i < size; i++) buf[i] = (i * 7 + 3) & 0xff;
  return buf;
}

/** Minimal fake PDF (%PDF-...). */
function pdfBytes(size = 48): Uint8Array {
  const buf = new Uint8Array(size);
  buf[0] = 0x25;
  buf[1] = 0x50;
  buf[2] = 0x44;
  buf[3] = 0x46;
  for (let i = 4; i < size; i++) buf[i] = (i * 13 + 1) & 0xff;
  return buf;
}

/** Link a saved file row to a member the same way setMemberPhoto does. */
function linkPhoto(ctx: BootedContext, memberId: string, fileId: string): void {
  ctx.db.run("UPDATE members SET photo_file_id = ?, updated_at = ? WHERE id = ?", [
    fileId,
    new Date().toISOString(),
    memberId,
  ]);
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  delete process.env.GYMSYSTEM_DATA_DIR;
});

describe("backup/restore file-archive round trip (TASK-040)", () => {
  it("archives real Files/ bytes, verifies them, and restores onto a wiped data dir", async () => {
    // ---- Phase A: seed a system with a member + photo + report + a backup.
    const dirA = mkdtempSync(join(tmpdir(), "gym-backup-a-"));
    const { ctx: ctxA } = await boot(dirA);
    const owner = await setupOwner(ctxA);

    const { createMember } = await import("@/core/services/members.service");
    const filesService = await import("../server/files.service");
    const backupsA = await import("../server/backups");

    // Legacy (pre-trailer) image with only the owner — a historical backup
    // with NO files referenced. Must be captured BEFORE any member/files
    // exist, otherwise the exported DB would reference rows that have no
    // trailer (and the restore would claim the wrong baseline).
    const legacyBytes = ctxA.driver.exportBytes()!;
    expect(legacyBytes.length).toBeGreaterThan(100);

    const member = await createMember(ctxA.db as never, owner, {
      fullName: "محمود أحمد",
      phone: "01000000001",
      department: "general",
    });

    const photoBytes = jpegBytes(192);
    const photoId = "photo-1";
    filesService.saveRawBytes(ctxA.db as never, owner, {
      id: photoId,
      kind: "member_photo",
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      bytes: photoBytes,
    });
    linkPhoto(ctxA, member.id, photoId);

    const reportBytes = pdfBytes(128);
    filesService.saveRawBytes(ctxA.db as never, owner, {
      id: "report-1",
      kind: "inbody_report",
      originalName: "report.pdf",
      mimeType: "application/pdf",
      bytes: reportBytes,
    });

    const created = await backupsA.createServerBackup(owner, "manual");
    expect(created.fileAssetsExpected).toBe(2);
    expect(created.fileAssetsCount).toBe(2);
    expect(created.fileAssetsMissing).toBe(0);
    expect(created.fileAssetsIncluded).toBe(true);
    expect(created.fullyVerified).toBe(true);
    expect(created.formatVersion).toBe(1);

    const snapshotBytes = backupsA.readSnapshotBytes(owner, created.fileName);
    expect(snapshotBytes.length).toBe(created.sizeBytes);

    // Verify without touching live state.
    const verified = backupsA.verifyBackupSnapshot(snapshotBytes);
    expect(verified.status).toBe("ok");
    expect(verified.fullyVerified).toBe(true);
    expect(verified.database.integrity).toBe("ok");
    expect(verified.database.present).toBe(true);
    expect(verified.database.sqliteByteOffset).toBeGreaterThan(0);
    expect(verified.fileArchive.present).toBe(true);
    expect(verified.fileArchive.expectedCount).toBe(2);
    expect(verified.fileArchive.archivedCount).toBe(2);
    expect(verified.fileArchive.missingFiles).toEqual([]);
    expect(verified.fileArchive.mismatchedFiles).toEqual([]);
    // Layout sanity: [sqlite][magic16][size8][archive] exactly.
    expect(verified.database.sqliteByteOffset + 16 + 8 + verified.fileArchive.sizeBytes).toBe(
      snapshotBytes.length,
    );

    // Simulate destruction: close A's DB handle, then wipe DB + Files tree.
    ctxA.driver.close();
    rmSync(ctxA.dirs.dbFile, { force: true });
    for (const suffix of ["-wal", "-shm"]) {
      rmSync(ctxA.dirs.dbFile + suffix, { force: true });
    }
    rmSync(ctxA.dirs.filesDir, { recursive: true, force: true });

    // ---- Phase B: fresh (destroyed) install in a NEW data dir. A real fresh
    // install always has its owner account set up before restoring, so do the
    // same (a completely empty DB cannot even record pre-restore snapshots).
    const dirB = mkdtempSync(join(tmpdir(), "gym-backup-b-"));
    const { ctx: ctxB, contextModule: ctxBModule } = await boot(dirB);
    const backupsB = await import("../server/backups");
    const ownerB = await setupOwner(ctxB);

    expect(ctxB.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL")).toBe(0);

    // 1) A legacy backup (owner only, no files) is still accepted. The actor
    //    must exist in the CURRENT live db, so use ownerB.
    const legacyReport = await backupsB.importDatabaseBytes(ownerB, legacyBytes, { kind: "restore" });
    expect(legacyReport.fileAssetsIncluded).toBe(false);
    expect(legacyReport.fileAssetsExpected).toBe(0);
    expect(legacyReport.filesRestored).toBe(0);
    expect(legacyReport.filesMissing).toBe(0);
    expect(legacyReport.fullyVerified).toBe(true);
    expect(legacyReport.schemaVersion).toBeGreaterThan(0);
    expect(legacyReport.after.users).toBe(1);

    // adoptDatabaseFile swapped the live driver; re-grab the CURRENT context
    // for every subsequent query (the boot-time ctxB.db wraps a closed handle).
    const liveAfterLegacy = ctxBModule.getDbContext() as BootedContext;

    // The live DB is now the legacy image (dirA's owner only). Rebuild the
    // actor from the CURRENT users table so protective-snapshot FKs resolve.
    const liveActor = await liveOwnerActor(liveAfterLegacy);

    // 2) Truncated trailer must fail cleanly and leave the live DB untouched.
    const truncated = snapshotBytes.slice(0, snapshotBytes.length - 3);
    await expect(
      backupsB.importDatabaseBytes(liveActor, truncated, { kind: "restore" }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "errors.backupArchiveCorrupt" });
    expect(liveAfterLegacy.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL")).toBe(0);

    // 3) Corrupt archive (flip the end-marker byte) must fail cleanly too.
    const badEnd = new Uint8Array(snapshotBytes);
    badEnd[badEnd.length - 1] ^= 0xff;
    await expect(
      backupsB.importDatabaseBytes(liveActor, badEnd, { kind: "restore" }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "errors.backupArchiveCorrupt" });
    expect(liveAfterLegacy.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL")).toBe(0);

    // 4) Corrupt archive CONTENT (flip a byte inside the first entry name):
    //    the declared size still matches, so this surfaces as an integrity /
    //    manifest failure, not a silent drop.
    const badContent = new Uint8Array(snapshotBytes);
    const archiveFirstEntry = verified.database.sqliteByteOffset + 24 + 30; // inside the first name field
    badContent[archiveFirstEntry] ^= 0xff;
    await expect(
      backupsB.importDatabaseBytes(liveActor, badContent, { kind: "restore" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      messageKey: expect.stringMatching(/^errors\.backup(ArchiveCorrupt|FilesIncomplete)$/),
    });
    expect(liveAfterLegacy.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL")).toBe(0);

    // 5) Legacy backup whose DB references files must be REFUSED (files would
    //    be silently dropped).
    const sqliteOnly = snapshotBytes.slice(0, verified.database.sqliteByteOffset);
    await expect(
      backupsB.importDatabaseBytes(liveActor, sqliteOnly, { kind: "restore" }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "errors.backupFilesIncomplete" });
    expect(liveAfterLegacy.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL")).toBe(0);

    // 6) The real restore round trip.
    const report = await backupsB.importDatabaseBytes(liveActor, snapshotBytes, { kind: "restore" });
    expect(report.schemaVersion).toBeGreaterThan(0);
    expect(report.formatVersion).toBe(1);
    expect(report.fileAssetsIncluded).toBe(true);
    expect(report.fileAssetsExpected).toBe(2);
    expect(report.fileAssetsStored).toBe(2);
    expect(report.fileAssetsVerified).toBe(2);
    expect(report.filesRestored).toBe(2);
    expect(report.filesMissing).toBe(0);
    expect(report.integrityStatus).toBe("ok");
    expect(report.fullyVerified).toBe(true);
    expect(report.after.members).toBe(1);
    expect(report.after.users).toBe(1);
    expect(report.protectedBackupFileName).toMatch(/\.gymbak$/);

    // Re-grab the live context (adoptDatabaseFile opened a fresh driver).
    const liveCtx = ctxBModule.getDbContext() as BootedContext;

    // DB data came back.
    const restoredMember = liveCtx.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL");
    expect(restoredMember).toBe(1);
    const restoredPhoto = liveCtx.db.scalar("SELECT photo_file_id FROM members LIMIT 1");
    expect(restoredPhoto).toBe(photoId);

    // Files landed on disk with exact bytes.
    const liveFiles = await import("../server/files.service");
    const metas = liveFiles.listAllFiles(liveCtx.db);
    expect(metas.length).toBe(2);
    const byId = new Map(metas.map((m) => [m.id, m]));
    expect(byId.get(photoId)?.relativePath).toBe(`member_photo/${photoId}.jpg`);
    expect(byId.get("report-1")?.relativePath).toBe(`inbody_report/report-1.pdf`);

    const photoOnDisk = readFileSync(join(ctxB.dirs.filesDir, `member_photo/${photoId}.jpg`));
    expect(Buffer.from(photoOnDisk).equals(Buffer.from(photoBytes))).toBe(true);
    expect(crypto.createHash("sha256").update(photoOnDisk).digest("hex")).toBe(byId.get(photoId)!.sha256);
    expect(
      Buffer.from(readFileSync(join(ctxB.dirs.filesDir, `inbody_report/report-1.pdf`))).equals(
        Buffer.from(reportBytes),
      ),
    ).toBe(true);

    // No staging / old-tree leftovers on the target data dir.
    const leftovers = readdirSync(ctxB.dirs.filesDir).filter((e) =>
      e.startsWith(".restore"),
    );
    expect(leftovers).toEqual([]);

    // Second restore of the same backup is idempotent (report shape stable).
    const report2 = await backupsB.importDatabaseBytes(
      await liveOwnerActor(liveCtx),
      snapshotBytes,
      { kind: "restore" },
    );
    expect(report2.fullyVerified).toBe(true);
    expect(report2.after.members).toBe(1);
  });

  it("verifyBackupSnapshot classifies malformed buffers without touching the DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-backup-verify-"));
    const { ctx } = await boot(dir);
    const owner = await setupOwner(ctx);
    const filesService = await import("../server/files.service");
    const backupsMod = await import("../server/backups");

    filesService.saveRawBytes(ctx.db as never, owner, {
      id: "photo-v",
      kind: "member_photo",
      originalName: "p.jpg",
      mimeType: "image/jpeg",
      bytes: jpegBytes(32),
    });

    const created = await backupsMod.createServerBackup(owner, "manual");
    const bytes = backupsMod.readSnapshotBytes(owner, created.fileName);

    expect(backupsMod.verifyBackupSnapshot(bytes).status).toBe("ok");

    // Truncated -> corrupt (trailer size no longer reaches EOF).
    expect(backupsMod.verifyBackupSnapshot(bytes.slice(0, bytes.length - 5)).status).toBe("corrupt");

    // Garbage that is not even a database -> corrupt.
    expect(backupsMod.verifyBackupSnapshot(new Uint8Array(200).fill(0x41)).status).toBe("corrupt");

    // Legacy (no trailer) with files referenced -> missing_files (restore would be refused).
    const probe = backupsMod.verifyBackupSnapshot(bytes);
    const sqliteOnly = bytes.slice(0, probe.database.sqliteByteOffset);
    expect(backupsMod.verifyBackupSnapshot(sqliteOnly).status).toBe("missing_files");
  });

  it("rejects an archive whose entry names no longer match the manifest (fail before staging)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-backup-path-"));
    const { ctx } = await boot(dir);
    const owner = await setupOwner(ctx);
    const filesService = await import("../server/files.service");
    const backupsMod = await import("../server/backups");

    filesService.saveRawBytes(ctx.db as never, owner, {
      id: "photo-p",
      kind: "member_photo",
      originalName: "p.jpg",
      mimeType: "image/jpeg",
      bytes: jpegBytes(40),
    });

    const created = await backupsMod.createServerBackup(owner, "manual");
    const bytes = backupsMod.readSnapshotBytes(owner, created.fileName);
    const verified = backupsMod.verifyBackupSnapshot(bytes);
    expect(verified.status).toBe("ok");
    expect(verified.fileArchive.expectedCount).toBe(1);

    // Rewrite the first archive entry name to a traversal attempt. The parse
    // either fails structurally (corrupt) or the name stops matching the
    // restored manifest (filesIncomplete) — either way the restore is refused
    // BEFORE anything is staged or swapped.
    const evil = new Uint8Array(bytes);
    const archiveStart = verified.database.sqliteByteOffset + 24;
    const evilName = Buffer.from("../escape.jpg", "utf8");
    evil[archiveStart] = evilName.length & 0xff;
    evil[archiveStart + 1] = (evilName.length >>> 8) & 0xff;
    evil.set(evilName, archiveStart + 2);

    await expect(
      backupsMod.importDatabaseBytes(owner, evil, { kind: "restore" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      messageKey: expect.stringMatching(/^errors\.backup(ArchiveCorrupt|FilesIncomplete)$/),
    });

    // Live state untouched: no member restored, the original Files/ tree is
    // unchanged (the single photo created for the backup), and there are no
    // staging/swap leftovers next to the Files root.
    expect(ctx.db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL")).toBe(0);
    expect(readdirSync(ctx.dirs.filesDir)).toEqual(["member_photo"]);
    expect(readdirSync(join(ctx.dirs.filesDir, "member_photo"))).toEqual(["photo-p.jpg"]);
    const parentEntries = readdirSync(join(ctx.dirs.filesDir, "..")).filter((e) =>
      e.startsWith(".restore-"),
    );
    expect(parentEntries).toEqual([]);
  });

  it("isSafeRelativePath rejects traversal, absolute, and hidden paths", async () => {
    const filesService = await import("../server/files.service");
    const { isSafeRelativePath } = filesService;
    for (const bad of [
      "",
      "../escape.jpg",
      "members/../../etc/passwd",
      "/etc/passwd",
      "C:/windows/system32",
      "a\\..\\b",
      "dir/./x",
      "a//b",
      "hidden/\x00kill",
      "a/.",
    ]) {
      expect(isSafeRelativePath(bad), `expected unsafe: ${bad}`).toBe(false);
    }
    for (const good of ["member_photo/abc.jpg", "inbody_report/1.pdf", "expense_attachment/x y.png", "other/q"]) {
      expect(isSafeRelativePath(good), `expected safe: ${good}`).toBe(true);
    }
  });
});