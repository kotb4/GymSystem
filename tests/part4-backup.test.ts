import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  buildBackupFileName,
  collectDiagnostics,
  computeChecksum,
  getLatestVerifiedBackup,
  listBackupEntries,
  pruneBackups,
  recordBackupEntry,
  validateRestoreFile,
} from "@/core/services/backup.service";
import type { OpenFromBytes } from "@/core/services/backup.service";
import { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { runMigrations } from "@/db/migrations";
import { NodeSqliteDriver } from "./helpers/node.driver";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let trainerUser: ServiceActor;
let tempDirs: string[] = [];

beforeEach(async () => {
  db = createTestDb();
  owner = buildActor(
    await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "??????",
      username: "owner",
      password: "Owner@2026",
    }),
  );
  trainerUser = buildActor(
    await createUser(db, owner, {
      username: "trainer1",
      password: "Train@2026",
      fullName: "???? ???",
      roleId: "trainer",
    }),
  );
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gymbak-"));
  tempDirs.push(dir);
  return dir;
}

/** Builds a real on-disk SQLite database with migrations applied and one user. */
async function buildRealDbFile(): Promise<string> {
  const path = join(tempDir(), "source.db");
  const driver = new NodeSqliteDriver(path);
  const realDb = new Db(driver);
  runMigrations(realDb);
  await setup(realDb, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "???? ?????",
    username: "fileowner",
    password: "Owner@2026",
  });
  driver.close();
  return path;
}

const openFromBytesNode: OpenFromBytes = async (probeBytes) => {
  const dir = mkdtempSync(join(tmpdir(), "gymprobe-"));
  tempDirs.push(dir);
  const probePath = join(dir, "probe.db");
  writeFileSync(probePath, Buffer.from(probeBytes));
  const handle = new DatabaseSync(probePath);
  return {
    scalar: (sql: string, params?: ReadonlyArray<string | number | bigint | Uint8Array | null>) => {
      const row = handle.prepare(sql).get(...((params ?? []) as never[])) as
        | Record<string, unknown>
        | undefined;
      return row == null ? undefined : Object.values(row)[0];
    },
    close: () => handle.close(),
  };
};

describe("backup checksum and file naming", () => {
  it("computes deterministic fnv1a checksums", () => {
    const bytes = new TextEncoder().encode("gympro-backup");
    expect(computeChecksum(bytes)).toBe(computeChecksum(bytes));
    expect(computeChecksum(bytes)).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    expect(computeChecksum(new Uint8Array([1, 2, 3]))).not.toBe(
      computeChecksum(new Uint8Array([1, 2, 4])),
    );
  });

  it("builds timestamped .gymbak file names", () => {
    const name = buildBackupFileName(new Date(2026, 7, 24, 14, 5, 9, 123));
    expect(name).toBe("gympro-backup-20260824-140509123.gymbak");
    expect(name.endsWith(".gymbak")).toBe(true);
  });
});

describe("backups log", () => {
  it("records entries and lists newest first with permission checks", async () => {
    await recordBackupEntry(db, owner, {
      kind: "manual",
      fileName: "a.gymbak",
      sizeBytes: 123,
      checksum: computeChecksum(new Uint8Array([1])),
      verified: true,
    });
    await recordBackupEntry(db, owner, {
      kind: "auto",
      fileName: "b.gymbak",
      sizeBytes: 456,
      checksum: computeChecksum(new Uint8Array([2])),
      verified: true,
    });

    const entries = listBackupEntries(db, owner);
    expect(entries.map((e) => e.fileName)).toEqual(["b.gymbak", "a.gymbak"]);
    expect(entries[0].verified).toBe(true);

    expect(() => listBackupEntries(db, trainerUser)).toThrowError("errors.forbidden");

    expect(getLatestVerifiedBackup(db)?.fileName).toBe("b.gymbak");
  });

  it("prunes beyond retention and returns removed file names", async () => {
    for (let i = 0; i < 5; i += 1) {
      await recordBackupEntry(db, owner, {
        kind: "auto",
        fileName: `n${i}.gymbak`,
        sizeBytes: i,
        checksum: `fnv1a:${String(i).padStart(8, "0")}`,
        verified: true,
      });
    }
    const removed = pruneBackups(db, 2);
    expect(removed.sort()).toEqual(["n0.gymbak", "n1.gymbak", "n2.gymbak"]);
    expect(listBackupEntries(db, owner)).toHaveLength(2);
    expect(pruneBackups(db, 2)).toEqual([]);
  });
});

describe("validateRestoreFile", () => {
  it("rejects non-sqlite bytes before probing", async () => {
    await expect(validateRestoreFile(new Uint8Array(50), openFromBytesNode)).rejects.toMatchObject({
      messageKey: "errors.backupInvalidFile",
    });
    const fake = new TextEncoder().encode("NOT SQLITE FORMAT AT ALL........").slice(0, 200);
    await expect(validateRestoreFile(fake, openFromBytesNode)).rejects.toMatchObject({
      messageKey: "errors.backupInvalidFile",
    });
  });

  it("accepts a genuine migrated database file and reports metadata", async () => {
    const path = await buildRealDbFile();
    const bytes = readFileSync(path);
    const metadata = await validateRestoreFile(new Uint8Array(bytes), openFromBytesNode);
    expect(metadata.migrationVersion).toBe(32);
    expect(metadata.users).toBe(1);
    expect(metadata.members).toBe(0);
    expect(metadata.settings).toBeGreaterThan(0);
  });

  it("rejects corrupted databases via integrity_check", async () => {
    const path = await buildRealDbFile();
    const bytes = new Uint8Array(readFileSync(path));
    // overwrite a large chunk of table b-tree pages deep in the file
    const from = Math.floor(bytes.length / 2);
    bytes.fill(0xff, from, from + 16_384);
    await expect(validateRestoreFile(bytes, openFromBytesNode)).rejects.toMatchObject({
      messageKey: "errors.backupIntegrityFailed",
    });
  });
});

describe("collectDiagnostics", () => {
  it("requires diagnostics.view permission and reports integrity ok", async () => {
    expect(() => collectDiagnostics(db, trainerUser)).toThrowError("errors.forbidden");

    const report = collectDiagnostics(db, owner);
    expect(report.integrity).toBe("ok");
    expect(report.gymName).toBe("Yassen Mohamed Kotb | 01288536381");
    expect(report.userCount).toBeGreaterThanOrEqual(2);
    expect(report.lastBackupAt).toBeNull();
    expect(report.autoBackupHours).toBe(24);
  });
});
