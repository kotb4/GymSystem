import { readFileSync, rmSync, readdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/core/permissions";

/**
 * TASK-042 end-to-end coverage for encrypted (.gymbak2) snapshots:
 *  - the v2 container wraps the ENTIRE v1 composite and is authenticated
 *    (AES-256-GCM);
 *  - the master key is stored DPAPI-wrapped (tests force the file store),
 *    password-derived via scrypt with params recorded in the container;
 *  - create → verify → restore round-trips;
 *  - wrong password, mutated ciphertext and truncated containers fail with
 *    precise error keys; clearing encryption reverts to plain snapshots.
 */
interface BootedCtx {
  db: {
    run(sql: string, params?: unknown[]): unknown;
    scalar(sql: string, params?: unknown[]): unknown;
    count(sql: string, params?: unknown[]): number;
    first<T = unknown>(sql: string, params?: unknown[]): T | null;
    transaction<T>(fn: () => T): T;
  };
  driver: { close(): void; exportBytes(): Uint8Array | null };
  dirs: { dbFile: string; backupsDir: string; filesDir: string; databaseDir: string; configDir: string };
}

const cleanups: Array<() => void> = [];

async function boot(dir: string): Promise<{ ctx: BootedCtx; contextModule: typeof import("../server/context"); backups: typeof import("../server/backups"); backupKey: typeof import("../server/backup-key"); cryptoMod: typeof import("../server/backup-crypto") }> {
  process.env.GYMSYSTEM_DATA_DIR = dir;
  process.env.GYMSYSTEM_SECRET_STORE = "file"; // tests never shell out to DPAPI
  process.env.GYM_SEED_DEMO = "";
  delete process.env.VITE_SEED_DEMO;
  vi.resetModules();
  const contextModule = await import("../server/context");
  const ctx = contextModule.openDatabase() as BootedCtx;
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
  const backups = await import("../server/backups");
  const backupKey = await import("../server/backup-key");
  const cryptoMod = await import("../server/backup-crypto");
  return { ctx, contextModule, backups, backupKey, cryptoMod };
}

async function setupOwner(ctx: BootedCtx): Promise<ServiceActor> {
  const { setup, buildActor } = await import("@/core/services/auth.service");
  const user = await setup(ctx.db as never, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  return buildActor(user);
}

function findBackup(ctx: BootedCtx, dir: string): Uint8Array {
  const files = readdirSync(dir).filter((f) => f.endsWith(".gymbak")).sort();
  expect(files.length).toBeGreaterThanOrEqual(1);
  return new Uint8Array(readFileSync(join(dir, files[files.length - 1])));
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  delete process.env.GYMSYSTEM_DATA_DIR;
});

describe("encrypted .gymbak2 containers (TASK-042)", () => {
  it("creates an encrypted snapshot, verifies it, and restores it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-enc-a-"));
    const { ctx, backups, backupKey } = await boot(dir);
    const owner = await setupOwner(ctx);

    await backupKey.setBackupPassword(ctx.db as never, owner, {
      password: "Strong@2026-backup",
    });

    const result = await backups.createServerBackup(owner, "manual");
    expect(result.encrypted).toBe(true);
    expect(result.cipher).toBe("aes-256-gcm");
    expect(result.formatVersion).toBe(2);
    expect(result.fullyVerified).toBe(true);
    expect(result.databaseIntegrity).toBe("ok");

    const bytes = findBackup(ctx, ctx.dirs.backupsDir);

    // The container magic is present and the payload is NOT readable in place.
    expect(String.fromCharCode(...bytes.slice(0, 8))).toBe("GYMBAK2\0");
    const asText = Buffer.from(bytes).toString("latin1");
    expect(asText).not.toContain("SQLite format 3");
    expect(asText).not.toContain("GYMBAK-FILES-V1");

    // Verification must decrypt first and report the encrypted framing.
    const report = await backups.verifySnapshotBytes(bytes);
    expect(report.status).toBe("ok");
    expect(report.encrypted).toBe(true);
    expect(report.cipher).toBe("aes-256-gcm");

    // The plain verifier must NOT accept a container as a v1 file.
    expect(backups.verifyBackupSnapshot(bytes).status).toBe("corrupt");

    // Restore: the key ring on this machine decrypts automatically.
    const restoreOwner = await (async () => {
      const { buildActor } = await import("@/core/services/auth.service");
      return buildActor({
        id: owner.userId,
        username: "owner",
        fullName: "المالك",
        roleId: "owner" as ServiceActor["roleId"],
      });
    })();
    const restored = await backups.importDatabaseBytes(restoreOwner, bytes, { kind: "restore" });
    expect(restored.encrypted).toBe(true);
    expect(restored.cipher).toBe("aes-256-gcm");
    expect(restored.fullyVerified).toBe(true);
  });

  it("rejects a wrong password, a mutated ciphertext, and a truncated container", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-enc-b-"));
    const { ctx, backups, backupKey } = await boot(dir);
    const owner = await setupOwner(ctx);

    await backupKey.setBackupPassword(ctx.db as never, owner, {
      password: "Strong@2026-backup",
    });
    await backups.createServerBackup(owner, "manual");
    const bytes = findBackup(ctx, ctx.dirs.backupsDir);

    // Wrong explicit password → indistinguishable GCM failure.
    await expect(
      backups.importDatabaseBytes(owner, bytes, { kind: "restore", password: "Wrong-Pass-123!" }),
    ).rejects.toMatchObject({ messageKey: "errors.backupWrongPassword" });

    // Mutate one ciphertext byte → tag failure (same error, as designed).
    const mutated = Uint8Array.from(bytes);
    mutated[mutated.length - 20] = mutated[mutated.length - 20] ^ 0xff;
    await expect(
      backups.importDatabaseBytes(owner, mutated, { kind: "restore" }),
    ).rejects.toMatchObject({ messageKey: "errors.backupWrongPassword" });

    // Truncated container → structural header failure.
    const truncated = bytes.slice(0, 60);
    await expect(
      backups.importDatabaseBytes(owner, truncated, { kind: "restore" }),
    ).rejects.toMatchObject({ messageKey: "errors.backupInvalidFile" });
  });

  it("verifies a password-derived container using ONLY the password (fresh machine)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-enc-c-"));
    const { ctx, backups, backupKey } = await boot(dir);
    const owner = await setupOwner(ctx);

    await backupKey.setBackupPassword(ctx.db as never, owner, {
      password: "Cross-Machine-Pass-2026",
    });
    await backups.createServerBackup(owner, "manual");
    const bytes = findBackup(ctx, ctx.dirs.backupsDir);

    // Simulate a fresh machine: no stored key ring in this boot's config dir.
    const cryptoMod = await import("../server/backup-crypto");
    expect(cryptoMod.backupKeyExists(ctx.dirs.configDir)).toBe(true);

    // Password alone unlocks the container (header carries the scrypt params).
    const report = await backups.verifySnapshotBytes(bytes, { password: "Cross-Machine-Pass-2026" });
    expect(report.status).toBe("ok");
    expect(report.encrypted).toBe(true);
  });

  it("clearing encryption removes the key and new snapshots are plain", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-enc-d-"));
    const { ctx, backups, backupKey } = await boot(dir);
    const owner = await setupOwner(ctx);

    await backupKey.setBackupPassword(ctx.db as never, owner, {
      password: "Strong@2026-backup",
    });
    const enc = await backups.createServerBackup(owner, "manual");
    expect(enc.encrypted).toBe(true);

    // Clearing with the wrong password is refused.
    const cryptoMod = await import("../server/backup-crypto");
    await expect(
      backupKey.clearBackupEncryption(ctx.db as never, owner, { password: "Wrong-Pass-123!" }),
    ).rejects.toMatchObject({ messageKey: "errors.backupWrongPassword" });
    expect(cryptoMod.backupKeyExists(ctx.dirs.configDir)).toBe(true);

    // Clearing with the correct password drops the key + flags.
    await backupKey.clearBackupEncryption(ctx.db as never, owner, { password: "Strong@2026-backup" });
    expect(cryptoMod.backupKeyExists(ctx.dirs.configDir)).toBe(false);

    const plain = await backups.createServerBackup(owner, "manual");
    expect(plain.encrypted).toBe(false);
    expect(plain.cipher).toBeNull();
    expect(plain.formatVersion).toBe(1);
    const bytes = findBackup(ctx, ctx.dirs.backupsDir);
    expect(String.fromCharCode(...bytes.slice(0, 15))).toBe("SQLite format 3");
  });
});