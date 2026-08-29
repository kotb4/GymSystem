import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
} from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { createTrainingPlan } from "@/core/services/training-plans.service";
import {
  getMemberOverview,
  listAuditForMember,
} from "@/core/services/member-profile.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import type { AppError } from "@/core/errors";
import { createTestDb } from "./helpers/test-db";
import { addDaysKey, todayKey } from "@/core/dates";

function syncAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected function to throw an AppError");
}

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;
let trainer: ServiceActor;
let menStaff: ServiceActor;
let menMemberId: string;
let womenMemberId: string;

function randomPhone() {
  return `01${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Test Gym",
    ownerFullName: "Owner",
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
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Trainer@2026",
      fullName: "المدرب",
      roleId: "trainer",
    }),
  );
  menStaff = buildActor(
    await createUser(db, owner, {
      username: "menstaff",
      password: "MenStaff@2026",
      fullName: "موظف رجال",
      roleId: "reception",
      department: "men",
    }),
  );
  const menMember = await createMember(db, owner, {
    fullName: "عضو رجال",
    phone: randomPhone(),
    department: "men",
  });
  const womenMember = await createMember(db, owner, {
    fullName: "عضو نساء",
    phone: randomPhone(),
    department: "women",
  });
  menMemberId = menMember.id;
  womenMemberId = womenMember.id;
});

describe("member-profile service — getMemberOverview", () => {
  it("returns null activeSubscription and zero visits for a new member with no activity", async () => {
    const result = getMemberOverview(db, owner, menMemberId);
    expect(result.activeSubscription).toBeNull();
    expect(result.nextSubDaysLeft).toBeNull();
    expect(result.lastAttendanceAt).toBeNull();
    expect(result.visitsThisMonth).toBe(0);
  });

  it("populates activeSubscription, days-left, last-visit and visitsThisMonth for an active member", async () => {
    const plan = await createPlan(db, owner, { name: "باقة شهرية", durationDays: 30, price: 1000 });
    const sub = await createSubscription(db, owner, { memberId: menMemberId, planId: plan.id });
    const card = await import("@/core/services/cards.service").then((m) =>
      m.assignCardByBarcode(db, owner, {
        memberId: menMemberId,
        barcodeValue: `GYM-T-${menMemberId.slice(0, 4)}`,
      }),
    );
    await recordCheckIn(db, owner, { barcode: card.card.barcodeValue });
    const result = getMemberOverview(db, owner, menMemberId);
    expect(result.activeSubscription).not.toBeNull();
    expect(result.activeSubscription?.id).toBe(sub.id);
    expect(result.nextSubDaysLeft).toBeGreaterThan(20);
    expect(result.lastAttendanceAt).toBeTruthy();
    expect(result.visitsThisMonth).toBe(1);
  });

  it("throws FORBIDDEN when a men-section staff calls it for a women-section member", async () => {
    expect(syncAppError(() => getMemberOverview(db, menStaff, womenMemberId)).code).toBe("FORBIDDEN");
  });

  it("throws NOT_FOUND for an unknown member id", async () => {
    expect(syncAppError(() => getMemberOverview(db, owner, "missing-id")).code).toBe("NOT_FOUND");
  });

  it("reception actor (has members.view) can read overview but trainer also can", async () => {
    expect(() => getMemberOverview(db, reception, menMemberId)).not.toThrow();
    expect(() => getMemberOverview(db, trainer, menMemberId)).not.toThrow();
  });
});

describe("member-profile service — listAuditForMember", () => {
  it("returns the member-created audit entry plus child-entity entries for the same member", async () => {
    const plan = await createPlan(db, owner, { name: "باقة اختبار", durationDays: 30, price: 1000 });
    const sub = await createSubscription(db, owner, { memberId: menMemberId, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: menMemberId,
      subscriptionId: sub.id,
      baseAmountMinor: 100000,
      paidAmountMinor: 50000,
      methodCode: "cash",
    });
    const trainerRow = db.first<{ id: string }>(
      "SELECT id FROM trainers WHERE is_active = 1 LIMIT 1",
    );
    if (trainerRow) {
      await createTrainingPlan(db, owner, {
        memberId: menMemberId,
        trainerId: trainerRow.id,
        startDate: todayKey(),
        endDate: addDaysKey(todayKey(), 30),
      });
    }
    const result = listAuditForMember(db, owner, menMemberId, { pageSize: 100 });
    const actions = result.items.map((i) => i.action);
    expect(actions).toContain("MEMBER_CREATED");
    expect(actions).toContain("SUBSCRIPTION_CREATED");
    expect(actions).toContain("PAYMENT_RECORDED");
    if (trainerRow) {
      expect(actions).toContain("TRAINING_PLAN_CREATED");
    }
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it("rejects trainer and reception actors with FORBIDDEN", async () => {
    expect(syncAppError(() => listAuditForMember(db, trainer, menMemberId)).code).toBe("FORBIDDEN");
    expect(syncAppError(() => listAuditForMember(db, reception, menMemberId)).code).toBe("FORBIDDEN");
  });

  it("allows manager to read the timeline", async () => {
    const result = listAuditForMember(db, manager, menMemberId, { pageSize: 10 });
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("enforces department isolation: men staff cannot read women member timeline", async () => {
    expect(syncAppError(() => listAuditForMember(db, menStaff, womenMemberId)).code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for an unknown member id", async () => {
    expect(syncAppError(() => listAuditForMember(db, owner, "missing-id")).code).toBe("NOT_FOUND");
  });

  it("does not leak entries from a different member's audit trail", async () => {
    const other = await createMember(db, owner, { fullName: "عضو آخر", phone: randomPhone() });
    const plan = await createPlan(db, owner, { name: "باقة أخرى", durationDays: 30, price: 500 });
    const sub = await createSubscription(db, owner, { memberId: other.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: other.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50000,
      paidAmountMinor: 50000,
      methodCode: "cash",
    });
    const result = listAuditForMember(db, owner, menMemberId, { pageSize: 100 });
    const refs = result.items.map((i) => i.entityId);
    expect(refs).not.toContain(sub.id);
    expect(refs).not.toContain(other.id);
  });
});
