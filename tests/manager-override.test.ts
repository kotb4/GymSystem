import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  hasManagerOverridePin,
  setManagerOverridePin,
  verifyManagerOverride,
} from "@/core/services/manager-override.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "GymGate Test",
    ownerFullName: "مالك النظام",
    username: "gymowner",
    password: "OwnerPassword123",
  });
  owner = buildActor(ownerUser);

  const recepUser = await createUser(db, owner, {
    username: "recep1",
    password: "RecepPassword123",
    fullName: "موظف الاستقبال",
    roleId: "reception",
    department: "men",
  });
  reception = buildActor(recepUser);
});

describe("Manager Override Service (R7)", () => {
  it("manages PIN configuration with permissions and length validation", () => {
    expect(hasManagerOverridePin(db)).toBe(false);

    // Receptionist without settings.edit cannot set PIN
    expect(() => setManagerOverridePin(db, reception, "1234")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );

    // Owner can set 4-6 digit PIN
    expect(() => setManagerOverridePin(db, owner, "12")).toThrow(
      expect.objectContaining({ messageKey: "errors.managerOverrideInvalidPin" }),
    );
    expect(() => setManagerOverridePin(db, owner, "1234567")).toThrow(
      expect.objectContaining({ messageKey: "errors.managerOverrideInvalidPin" }),
    );
    expect(() => setManagerOverridePin(db, owner, "abcd")).toThrow(
      expect.objectContaining({ messageKey: "errors.managerOverrideInvalidPin" }),
    );

    setManagerOverridePin(db, owner, "5678");
    expect(hasManagerOverridePin(db)).toBe(true);
  });

  it("authorizes cross-department operations via fast numeric PIN and records audit", async () => {
    setManagerOverridePin(db, owner, "9876");

    // Invalid PIN rejection
    await expect(
      verifyManagerOverride(db, reception, {
        pin: "0000",
        reason: "تسجيل دخول مشترك قسم السيدات",
      }),
    ).rejects.toMatchObject({
      messageKey: "errors.managerOverrideInvalidPin",
    });

    // Valid PIN authorization
    const result = await verifyManagerOverride(db, reception, {
      pin: "9876",
      reason: "تسجيل دخول مشترك قسم السيدات",
      entityType: "member",
      entityId: "mem-123",
    });

    expect(result.success).toBe(true);
    expect(result.authorizedBy).toBe("gymowner");
    expect(result.roleId).toBe("owner");
    expect(result.token).toBeDefined();

    // Verify audit log
    const auditRow = db.first<{
      action: string;
      user_id: string;
      user_name: string;
      entity_type: string;
      entity_id: string;
      metadata: string;
    }>("SELECT * FROM audit_logs WHERE action = 'MANAGER_OVERRIDE' ORDER BY id DESC LIMIT 1");

    expect(auditRow).toBeDefined();
    expect(auditRow!.user_id).toBe(reception.userId);
    expect(auditRow!.entity_type).toBe("member");
    expect(auditRow!.entity_id).toBe("mem-123");

    const meta = JSON.parse(auditRow!.metadata);
    expect(meta.authorizedBy).toBe("gymowner");
    expect(meta.managerRole).toBe("owner");
    expect(meta.reason).toBe("تسجيل دخول مشترك قسم السيدات");
  });

  it("authorizes operations via Manager username and password fallback", async () => {
    const managerUser = await createUser(db, owner, {
      username: "gymmanager",
      password: "ManagerPass@2026",
      fullName: "مدير الفرع",
      roleId: "manager",
      department: "general",
    });

    // Wrong password
    await expect(
      verifyManagerOverride(db, reception, {
        username: "gymmanager",
        password: "WrongPassword",
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    // Valid manager credentials
    const result = await verifyManagerOverride(db, reception, {
      username: "gymmanager",
      password: "ManagerPass@2026",
      reason: "تخطي الحد المالي",
    });

    expect(result.success).toBe(true);
    expect(result.authorizedBy).toBe("gymmanager");
    expect(result.managerId).toBe(managerUser.id);
    expect(result.roleId).toBe("manager");
  });

  it("rejects non-manager / non-owner credentials", async () => {
    await createUser(db, owner, {
      username: "trainer1",
      password: "TrainerPass@2026",
      fullName: "مدرب جيم",
      roleId: "trainer",
      department: "general",
    });

    await expect(
      verifyManagerOverride(db, reception, {
        username: "trainer1",
        password: "TrainerPass@2026",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "errors.managerOverrideNotAuthorized",
    });
  });

  it("allows a user with members.view_all_departments grant to authorize override", async () => {
    await createUser(db, owner, {
      username: "supervisor",
      password: "SuperPassword@2026",
      fullName: "مشرف عام",
      roleId: "trainer",
      department: "general",
    });
    db.run(
      "INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('trainer', 'members.view_all_departments')",
    );
    const { loadPermissionsCache } = await import("@/core/services/permissions.service");
    loadPermissionsCache(db);

    const result = await verifyManagerOverride(db, reception, {
      username: "supervisor",
      password: "SuperPassword@2026",
      reason: "تصريح مشرف",
    });

    expect(result.success).toBe(true);
    expect(result.authorizedBy).toBe("supervisor");
  });
});

describe("Database Migration v66 Indexes (R8)", () => {
  it("creates all 5 performance indexes for reception peak hours", () => {
    const indexes = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index'",
    );
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_cards_barcode_status");
    expect(indexNames).toContain("idx_subs_member_status_dates");
    expect(indexNames).toContain("idx_attendance_member_checkin");
    expect(indexNames).toContain("idx_payments_sub_status");
    expect(indexNames).toContain("idx_cash_sessions_box_opened");
  });
});
