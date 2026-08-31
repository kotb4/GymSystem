import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  getRolePermissions,
  setRolePermissions,
  loadPermissionsCache,
} from "@/core/services/permissions.service";
import { roleHasPermission } from "@/core/permissions";
import { updateUser } from "@/core/services/users.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";
import { runMigrations } from "@/db/migrations";

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "الأنور",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  manager = buildActor(
    await createUser(db, owner, {
      username: "manager",
      password: "Manager@2026",
      fullName: "المدير",
      roleId: "manager",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "الاستقبال",
      roleId: "reception",
    }),
  );
});

describe("owner absolutism + manager permission control (ADR-007 / migration v7)", () => {
  it("migration v7 grants settings.edit to the manager exactly once and is idempotent", () => {
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = 'manager' AND permission_code = 'settings.edit'",
      ),
    ).toBe(1);

    runMigrations(db); // re-run must be a no-op
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = 'manager' AND permission_code = 'settings.edit'",
      ),
    ).toBe(1);
  });

  it("the owner passes every permission check literally, including destructive deletes", () => {
    for (const perm of [
      "members.purge",
      "members.delete",
      "payments.void",
      "payments.refund",
      "store.void_sale",
      "subscriptions.cancel",
      "settings.edit",
      "users.manage",
    ] as const) {
      expect(roleHasPermission("owner", perm)).toBe(true);
    }
  });

  it("lets the manager edit subordinate-role permissions and persists the change", async () => {
    loadPermissionsCache(db);
    const before = getRolePermissions(db, manager);
    expect(before.trainer).toContain("members.view");

    await setRolePermissions(db, manager, "trainer", ["members.view", "classes.view"]);

    const after = getRolePermissions(db, manager);
    expect(after.trainer.sort()).toEqual(["classes.view", "members.view"]);
    // runtime cache reflects DB after committed write via engine dirty hook in server;
    // here we re-load explicitly to prove persistence source of truth:
    loadPermissionsCache(db);
    expect(roleHasPermission("trainer", "subscriptions.view")).toBe(false);
  });

  it("still protects the owner row from edits even for an empowered manager", async () => {
    loadPermissionsCache(db);
    setRolePermissions(db, manager, "owner", []); // silent no-op by design

    const ownerRow = getRolePermissions(db, manager).owner;
    expect(ownerRow.length).toBeGreaterThan(60);
  });

  it("denies roles without settings.edit from editing anything", () => {
    expect(() => setRolePermissions(db, reception, "trainer", [])).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("blocks a manager from escalating by editing their own role's permissions", () => {
    loadPermissionsCache(db);
    expect(() =>
      setRolePermissions(db, manager, "manager", ["users.manage", "settings.edit"]),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    // subordinate roles remain editable
    expect(() => setRolePermissions(db, manager, "reception", ["members.view"])).not.toThrow();
  });

  it("blocks a manager from promoting a user to owner via updateUser", async () => {
    await expect(
      updateUser(db, manager, (await createUser(db, owner, {
        username: "cashier",
        password: "Cashier@2026",
        fullName: "أمين الصندوق",
        roleId: "reception",
      })).id, { roleId: "owner" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks a manager from creating an owner user", async () => {
    await expect(
      createUser(db, manager, {
        username: "fakeowner",
        password: "Fake@2026",
        fullName: "مالك مزيف",
        roleId: "owner",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
