import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/core/permissions";

/**
 * F-02 regression coverage: backup create/download authorization.
 * Gates live inside server/backups.ts createServerBackup/readSnapshotBytes,
 * exercised here against a real on-disk SQLite context.
 */

interface BootedContext {
  db: {
    run(sql: string, params?: unknown[]): unknown;
    scalar(sql: string, params?: unknown[]): unknown;
    count(sql: string, params?: unknown[]): number;
    transaction<T>(fn: () => T): T;
  };
  driver: { close(): void; exportBytes(): Uint8Array | null };
  dirs: { backupsDir: string; dbFile: string };
}

const cleanups: Array<() => void> = [];

async function boot(): Promise<BootedContext> {
  const dir = mkdtempSync(join(tmpdir(), "gym-backup-authz-"));
  process.env.GYMSYSTEM_DATA_DIR = dir;
  delete process.env.VITE_SEED_DEMO;
  process.env.GYM_SEED_DEMO = "";
  vi.resetModules();
  const context = await import("../server/context");
  const ctx = context.openDatabase() as BootedContext;
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
  return ctx;
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

async function createUser(ctx: BootedContext, owner: ServiceActor, roleId: "manager" | "trainer" | "reception"): Promise<ServiceActor> {
  const { createUser: create } = await import("@/core/services/users.service");
  const { buildActor } = await import("@/core/services/auth.service");
  const passwordByRole = {
    manager: "Manager@2026",
    trainer: "Trainer@2026",
    reception: "Recep@2026",
  } as const;
  const row = await create(ctx.db as never, owner, {
    username: roleId,
    password: passwordByRole[roleId],
    fullName: roleId,
    roleId,
  });
  return buildActor(row);
}

function gymbakCount(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".gymbak")).length;
  } catch {
    return 0;
  }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  delete process.env.GYMSYSTEM_DATA_DIR;
});

describe("backup create/download authorization (audit F-02)", () => {
  it("allows the owner to create a snapshot and download its bytes", async () => {
    const ctx = await boot();
    const owner = await setupOwner(ctx);
    const { createServerBackup, readSnapshotBytes } = await import("../server/backups");

    const result = await createServerBackup(owner, "manual");
    expect(result.fileName).toMatch(/\.gymbak$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(gymbakCount(ctx.dirs.backupsDir)).toBe(1);

    const bytes = readSnapshotBytes(owner, result.fileName);
    const header = Buffer.from(bytes.slice(0, 16)).toString("latin1");
    expect(header).toBe("SQLite format 3\0");
  });

  it("allows a role granted backup.create/backup.restore (manager) for both operations", async () => {
    const ctx = await boot();
    const manager = await createUser(ctx, await setupOwner(ctx), "manager");
    const { createServerBackup, readSnapshotBytes } = await import("../server/backups");

    const result = await createServerBackup(manager, "manual");
    expect(gymbakCount(ctx.dirs.backupsDir)).toBe(1);

    const bytes = readSnapshotBytes(manager, result.fileName);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("denies trainer and reception from creating AND leaves no artifact", async () => {
    const ctx = await boot();
    const owner = await setupOwner(ctx);
    const trainer = await createUser(ctx, owner, "trainer");
    const reception = await createUser(ctx, owner, "reception");
    const { createServerBackup } = await import("../server/backups");

    await expect(createServerBackup(trainer, "manual")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(createServerBackup(reception, "manual")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(gymbakCount(ctx.dirs.backupsDir)).toBe(0);
  });

  it("denies trainer and reception from downloading an existing snapshot", async () => {
    const ctx = await boot();
    const owner = await setupOwner(ctx);
    const trainer = await createUser(ctx, owner, "trainer");
    const reception = await createUser(ctx, owner, "reception");
    const { createServerBackup, readSnapshotBytes } = await import("../server/backups");

    const { fileName } = await createServerBackup(owner, "manual");

    expect(() => readSnapshotBytes(trainer, fileName)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => readSnapshotBytes(reception, fileName)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});
