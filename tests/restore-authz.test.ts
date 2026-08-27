import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/core/permissions";

/**
 * F-01 regression coverage: database restore/import authorization.
 * The gate lives inside server/backups.ts importDatabaseBytes so these tests
 * exercise the real function against a real on-disk SQLite context.
 */

interface BootedContext {
  db: {
    run(sql: string, params?: unknown[]): unknown;
    scalar(sql: string, params?: unknown[]): unknown;
    count(sql: string, params?: unknown[]): number;
    transaction<T>(fn: () => T): T;
  };
  driver: { close(): void; exportBytes(): Uint8Array | null };
  dirs: { dbFile: string };
}

const cleanups: Array<() => void> = [];

async function boot(): Promise<BootedContext> {
  const dir = mkdtempSync(join(tmpdir(), "gym-restore-authz-"));
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

function legacySystemActor(): ServiceActor {
  return { userId: "legacy-import", username: "system", roleId: "owner" };
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  delete process.env.GYMSYSTEM_DATA_DIR;
});

describe("restore/import authorization (audit F-01)", () => {
  it("allows the owner to restore a valid snapshot", async () => {
    const ctx = await boot();
    const owner = await setupOwner(ctx);
    const { importDatabaseBytes } = await import("../server/backups");
    const bytes = ctx.driver.exportBytes()!;
    const report = (await importDatabaseBytes(owner, bytes, {
      kind: "restore",
    })) as { schemaVersion: number };
    expect(report.schemaVersion).toBeGreaterThanOrEqual(6);
  });

  it("allows a role granted backup.restore (manager) to restore", async () => {
    const ctx = await boot();
    const owner = await setupOwner(ctx);
    const { createUser } = await import("@/core/services/users.service");
    const { buildActor } = await import("@/core/services/auth.service");
    const managerRow = await createUser(ctx.db as never, owner, {
      username: "manager",
      password: "Manager@2026",
      fullName: "المدير",
      roleId: "manager",
    });
    const { importDatabaseBytes } = await import("../server/backups");
    const bytes = ctx.driver.exportBytes()!;
    await expect(
      importDatabaseBytes(buildActor(managerRow), bytes, { kind: "restore" }),
    ).resolves.toBeTruthy();
  });

  it("denies trainer and reception roles from restoring", async () => {
    const ctx = await boot();
    const owner = await setupOwner(ctx);
    const { createUser, countActiveOwners } = await import("@/core/services/users.service");
    const { buildActor } = await import("@/core/services/auth.service");
    const trainerRow = await createUser(ctx.db as never, owner, {
      username: "trainer",
      password: "Trainer@2026",
      fullName: "المدرب",
      roleId: "trainer",
    });
    const receptionRow = await createUser(ctx.db as never, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "الاستقبال",
      roleId: "reception",
    });
    const bytes = ctx.driver.exportBytes()!;
    const { importDatabaseBytes } = await import("../server/backups");

    await expect(
      importDatabaseBytes(buildActor(trainerRow), bytes, { kind: "restore" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      importDatabaseBytes(buildActor(receptionRow), bytes, { kind: "restore" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(countActiveOwners(ctx.db as never)).toBe(1);
  });

  it("keeps first-run legacy import working without any owner (synthetic system actor)", async () => {
    const sourceCtx = await boot();
    await setupOwner(sourceCtx);
    sourceCtx.db.transaction(() => {
      sourceCtx.db.run("DROP INDEX IF EXISTS idx_files_kind");
      sourceCtx.db.run("DROP TABLE files");
      sourceCtx.db.run("ALTER TABLE members DROP COLUMN photo_file_id");
      sourceCtx.db.run("ALTER TABLE employees DROP COLUMN salary_type");
      sourceCtx.db.run("ALTER TABLE employees DROP COLUMN salary_base_minor");
      sourceCtx.db.run("DELETE FROM settings WHERE key = 'allow_negative_stock'");
      sourceCtx.db.run("DELETE FROM schema_migrations WHERE version > 5");
    });
    const legacyBytes = sourceCtx.driver.exportBytes()!;
    sourceCtx.driver.close();

    const freshCtx = await boot();
    const { countActiveOwners } = await import("@/core/services/users.service");
    expect(countActiveOwners(freshCtx.db as never)).toBe(0);

    const { importDatabaseBytes } = await import("../server/backups");
    const report = (await importDatabaseBytes(legacySystemActor(), legacyBytes, {
      kind: "legacy_import",
    })) as { schemaVersion: number };

    const reopened = (await import("../server/context")).getDbContext() as unknown as BootedContext;
    expect(countActiveOwners(reopened.db as never)).toBe(1);
    expect(Number(reopened.db.scalar("SELECT MAX(version) FROM schema_migrations"))).toBe(12);
    expect(report.schemaVersion).toBeLessThanOrEqual(5);

    cleanups.push(() => {
      try {
        reopened.driver.close();
      } catch {
        /* noop */
      }
    });
  });

  it("preserves the legacy-import v6 rejection (existing behavior)", async () => {
    const ctx = await boot();
    await setupOwner(ctx);
    const v6Bytes = ctx.driver.exportBytes()!;
    await boot();
    const { importDatabaseBytes } = await import("../server/backups");
    await expect(
      importDatabaseBytes(legacySystemActor(), v6Bytes, { kind: "legacy_import" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
