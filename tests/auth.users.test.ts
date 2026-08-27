import { beforeEach, describe, expect, it } from "vitest";
import { toAppError } from "@/core/errors";
import {
  buildActor,
  changeOwnPassword,
  login,
  needsSetup,
  setup,
} from "@/core/services/auth.service";
import { listAuditLogs, recordAudit } from "@/core/services/audit.service";
import { readAllSettings, updateSetting } from "@/core/services/settings.service";
import {
  createUser,
  listUsers,
  resetPassword,
  setUserActive,
  updateUser,
} from "@/core/services/users.service";
import { createTestDb } from "./helpers/test-db";
import type { Db } from "@/db/engine";

let db: Db;
let ownerActor: ReturnType<typeof buildActor>;

async function seedOwner(): Promise<ReturnType<typeof buildActor>> {
  const owner = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "Ø§Ù„Ù…Ø§Ù„Ùƒ Ø§Ù„Ø£ÙˆÙ„",
    username: "owner",
    password: "Owner@2026",
  });
  return buildActor(owner);
}

beforeEach(async () => {
  db = createTestDb();
  ownerActor = await seedOwner();
});

describe("setup", () => {
  it("creates the first owner and gym settings", () => {
    expect(needsSetup(db)).toBe(false);
    expect(readAllSettings(db, ownerActor)["gym_name"]).toBe("Yassen Mohamed Kotb | 01288536381");
    const audit = listAuditLogs(db, ownerActor, {});
    expect(audit.items.some((i) => i.action === "SETUP_COMPLETED")).toBe(true);
  });

  it("refuses a second setup", async () => {
    await expect(
      setup(db, { gymName: "x", ownerFullName: "y", username: "other", password: "Password1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("login", () => {
  it("logs in with correct credentials and stamps last_login_at", async () => {
    const user = await login(db, { username: "OWNER", password: "Owner@2026" });
    expect(user.username).toBe("owner");
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("rejects wrong password without leaking username existence", async () => {
    const missing = login(db, { username: "ghost", password: "whatever1" });
    const wrong = login(db, { username: "owner", password: "wrong-pass-1" });
    await expect(missing).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(wrong).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("locks the account after five failed attempts", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(login(db, { username: "owner", password: "bad-pass-1" })).rejects.toBeTruthy();
    }
    await expect(login(db, { username: "owner", password: "Owner@2026" })).rejects.toMatchObject({
      code: "LOCKED",
    });
    const failedAudits = listAuditLogs(db, ownerActor, {}).items.filter((i) => i.action === "AUTH_LOGIN_FAILED");
    expect(failedAudits.length).toBe(5);
    expect(failedAudits[0].metadata).toMatchObject({ lockedForSeconds: expect.any(Number) });
  });

  it("resets failed counter on success", async () => {
    await expect(login(db, { username: "owner", password: "bad-pass-1" })).rejects.toBeTruthy();
    await login(db, { username: "owner", password: "Owner@2026" });
    const user = await login(db, { username: "owner", password: "Owner@2026" });
    expect(user.id).toBeTruthy();
  });
});

describe("user management + authorization", () => {
  it("owner creates users and lists them", async () => {
    const created = await createUser(db, ownerActor, {
      username: "reception",
      password: "Recep@2026",
      fullName: "Ù…ÙˆØ¸Ù Ø§Ù„Ø§Ø³ØªÙ‚Ø¨Ø§Ù„",
      roleId: "reception",
    });
    expect(created.roleId).toBe("reception");
    expect(listUsers(db, ownerActor).length).toBe(2);
  });

  it("enforces users.manage permission at service level", async () => {
    const reception = await createUser(db, ownerActor, {
      username: "reception",
      password: "Recep@2026",
      fullName: "Ù…ÙˆØ¸Ù Ø§Ù„Ø§Ø³ØªÙ‚Ø¨Ø§Ù„",
      roleId: "reception",
    });
    const receptionActor = buildActor(reception);
    await expect(
      createUser(db, receptionActor, receptionActor, {
        username: "sneaky",
        password: "Sneaky@123",
        fullName: "Ù…ØªØ³Ù„Ù„",
        roleId: "trainer",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks changing role of the last active owner", async () => {
    await expect(
      updateUser(db, ownerActor, ownerActor.userId, { roleId: "manager" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("blocks deactivating self or the last active owner", async () => {
    await expect(setUserActive(db, ownerActor, ownerActor.userId, false)).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
  });

  it("resets password and clears lockout state", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(login(db, { username: "owner", password: "bad-pass-2" })).rejects.toBeTruthy();
    }
    await resetPassword(db, ownerActor, ownerActor.userId, "NewPass@2026");
    const user = await login(db, { username: "owner", password: "NewPass@2026" });
    expect(user.username).toBe("owner");
  });

  it("validates password strength on creation", async () => {
    await expect(
      createUser(db, ownerActor, {
        username: "weakpw",
        password: "short",
        fullName: "Ø¶Ø¹ÙŠÙ",
        roleId: "trainer",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createUser(db, ownerActor, {
        username: "weakpw",
        password: "lettersonly",
        fullName: "Ø¶Ø¹ÙŠÙ",
        roleId: "trainer",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects duplicate usernames case-insensitively", async () => {
    await expect(
      createUser(db, ownerActor, {
        username: "OWNER",
        password: "Another@1",
        fullName: "Ù…ÙƒØ±Ø±",
        roleId: "manager",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("change own password", () => {
  it("requires current password", async () => {
    await expect(
      changeOwnPassword(db, ownerActor, "wrong-current", "Changed@123"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await changeOwnPassword(db, ownerActor, "Owner@2026", "Changed@123");
    await expect(login(db, { username: "owner", password: "Changed@123" })).resolves.toBeTruthy();
  });
});

describe("settings service", () => {
  it("updates editable settings with permission and audits them", async () => {
    await updateSetting(db, ownerActor, "gym_name", "Updated Gym Name");
    expect(readAllSettings(db, ownerActor)["gym_name"]).toBe("Updated Gym Name");
    const audits = listAuditLogs(db, ownerActor, {}).items.filter((i) => i.action === "SETTINGS_UPDATED");
    expect(audits.length).toBe(1);
  });

  it("rejects unknown setting keys", async () => {
    await expect(
      updateSetting(db, ownerActor, "hacker_key", "x"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("audit log listing", () => {
  it("paginates newest-first", async () => {
    recordAudit(db, ownerActor, "AUTH_LOGOUT", "user", ownerActor.userId);
    recordAudit(db, ownerActor, "AUTH_LOGOUT", "user", ownerActor.userId);
    const page1 = listAuditLogs(db, ownerActor, { page: 1, pageSize: 2 });
    const page2 = listAuditLogs(db, ownerActor, { page: 2, pageSize: 2 });
    expect(page1.total).toBeGreaterThanOrEqual(3);
    expect(page2.items.length).toBeGreaterThan(0);
    expect(page1.items[0].id).toBeGreaterThan(page2.items[0].id);
  });

  it("filters by action", () => {
    recordAudit(db, ownerActor, "AUTH_LOGOUT", "user", null);
    const onlyLogins = listAuditLogs(db, ownerActor, { action: "AUTH_LOGIN" });
    expect(onlyLogins.items.every((i) => i.action === "AUTH_LOGIN")).toBe(true);
    expect(toAppError(new Error("x"))).toBeNull();
  });
});
