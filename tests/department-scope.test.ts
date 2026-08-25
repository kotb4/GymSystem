import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  listMemberSubscriptions,
  listSubscriptions,
  renewSubscription,
} from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { getMemberStoreDebtTotal } from "@/core/services/store.service";
import { listAssessments } from "@/core/services/inbody.service";
import { bookMember } from "@/core/services/classes.service";
import { createTrainingPlan, endTrainingPlan } from "@/core/services/training-plans.service";
import { createTrainer } from "@/core/services/trainers.service";
import { queueMessage } from "@/core/services/crm.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let menReception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "جيم الأقسام",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  menReception = buildActor(
    await createUser(db, owner, {
      username: "men-recep",
      password: "Recep@2026",
      fullName: "استقبال رجال",
      roleId: "reception",
      department: "men",
    }),
  );
});

async function member(fullName: string, department: "men" | "women") {
  return createMember(db, owner, {
    fullName,
    department,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function activeSub(memberId: string, name: string) {
  const plan = await createPlan(db, owner, { name, durationDays: 30, price: 300 });
  return createSubscription(db, owner, { memberId, planId: plan.id });
}

describe("department scoping beyond members service (audit F-04 / ADR-004)", () => {
  it("blocks men-section staff from women-section subscriptions, payments and member reads", async () => {
    const women = await member("عضوة قسم السيدات", "women");
    await activeSub(women.id, "سيدات شهري");
    await recordPayment(db, owner, {
      memberId: women.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 50_000,
      methodCode: "cash",
    });

    await expect(
      (async () => {
        const { createSubscription: cs } = await import("@/core/services/subscriptions.service");
        const plan = await createPlan(db, owner, { name: "مشترك", durationDays: 7, price: 100 });
        return cs(db, menReception, { memberId: women.id, planId: plan.id });
      })(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      recordPayment(db, menReception, {
        memberId: women.id,
        baseAmountMinor: 10_000,
        paidAmountMinor: 10_000,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(() => listMemberSubscriptions(db, menReception, women.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => getMemberStoreDebtTotal(db, menReception, women.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => listAssessments(db, menReception, women.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );

    const womensList = listSubscriptions(db, menReception, {});
    expect(womensList.total).toBe(0);
  });

  it("allows the same staff to operate on their own section", async () => {
    const men = await member("عضو قسم الرجال", "men");
    const sub = await activeSub(men.id, "رجال شهري");

    const payment = await recordPayment(db, menReception, {
      memberId: men.id,
      subscriptionId: sub.id,
      baseAmountMinor: 20_000,
      paidAmountMinor: 20_000,
      methodCode: "cash",
    });
    expect(payment.paidAmountMinor).toBe(20_000);
    expect(listMemberSubscriptions(db, menReception, men.id).length).toBeGreaterThan(0);

    await expect(
      renewSubscription(db, menReception, sub.id, {}),
    ).resolves.toBeTruthy();
  });

  it("guards classes bookings, training plans and CRM per section", async () => {
    const women = await member("عضوة حصص", "women");
    const men = await member("عضو حصص", "men");
    const trainer = await createTrainer(db, owner, {
      fullName: "المدرب العام",
      joinedDate: "2026-01-01",
    });

    const { createClass, createClassSession } = await import("@/core/services/classes.service");
    const cls = await createClass(db, owner, { name: "كروس فيت", capacity: 10 });
    const session = await createClassSession(db, owner, cls.id, { sessionDate: new Date().toISOString().slice(0, 10), startTime: "18:00" });

    await expect(
      bookMember(db, menReception, { sessionId: session.id, memberId: women.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      bookMember(db, menReception, { sessionId: session.id, memberId: men.id }),
    ).resolves.toBeTruthy();

    const womenPlan = await createTrainingPlan(db, owner, {
      memberId: women.id,
      trainerId: trainer.id,
      startDate: "2026-08-01",
      endDate: "2026-09-01",
    });
    expect(() => endTrainingPlan(db, menReception, womenPlan.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );

    await expect(
      queueMessage(db, menReception, { memberId: women.id, customBody: "رسالة تجربة" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("honors an explicit members.view_all_departments grant as a bypass", async () => {
    const { buildActor: ba } = await import("@/core/services/auth.service");
    const managerRow = await createUser(db, owner, {
      username: "scope-manager",
      password: "Manager@2026",
      fullName: "مدير عام",
      roleId: "trainer",
      department: "men",
    });
    db.run(
      "INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('trainer', 'members.view_all_departments')",
    );
    db.run(
      "INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('trainer', 'subscriptions.view')",
    );
    db.run(
      "INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('trainer', 'members.view')",
    );
    const { loadPermissionsCache } = await import("@/core/services/permissions.service");
    loadPermissionsCache(db);
    const manager = ba(managerRow);

    const women = await member("عضوة للتفويض", "women");
    expect(listMemberSubscriptions(db, manager, women.id)).toEqual([]);
  });
});
