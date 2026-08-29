import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription, renewSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { createProduct } from "@/core/services/store.service";
import { queueMessage } from "@/core/services/crm.service";
import { createUser } from "@/core/services/users.service";
import { createTestDb } from "./helpers/test-db";
import { todayKey } from "@/core/dates";
import { getDashboardOverview, getDashboardSeries } from "@/core/services/dashboard.service";
import type { Db } from "@/db/engine";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;
let trainer: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
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
      password: "Train@2026",
      fullName: "المدرب",
      roleId: "trainer",
    }),
  );
});

function randomPhone() {
  return `011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

async function newMember(name = "عضو") {
  return createMember(db, owner, { fullName: `ك-${name}-${Math.floor(Math.random() * 1e9)}`, phone: randomPhone() });
}

async function seedSubWithPayment(priceMajor = 1000, paidMajor?: number) {
  const member = await newMember();
  const plan = await createPlan(db, owner, {
    name: `باقة-${Math.floor(Math.random() * 1e9)}`,
    durationDays: 30,
    price: priceMajor,
  });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  if (paidMajor !== undefined) {
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: Math.round(priceMajor * 100),
      paidAmountMinor: Math.round(paidMajor * 100),
      methodCode: "cash",
    });
  }
  return { member, plan, sub };
}

describe("dashboard aggregation — series + permissions", () => {
  it("buckets a today range into a single day point and sums ledger revenue from a full payment", async () => {
    await seedSubWithPayment(1000, 1000);

    const ov = getDashboardOverview(db, owner, "today");
    expect(ov.bucket).toBe("day");
    expect(ov.series.length).toBe(1);
    expect(ov.series[0].revenueMinor).toBe(100_000);
    expect(ov.series[0].expensesMinor).toBe(0);
    expect(ov.series[0].netMinor).toBe(100_000);
    expect(ov.finance).not.toBeNull();
    expect(ov.finance!.revenue.current).toBe(100_000);
    expect(ov.finance!.expenses.current).toBe(0);
    expect(ov.finance!.net.current).toBe(100_000);
  });

  it("picks day vs month buckets by span length", () => {
    expect(getDashboardSeries(db, owner, "7d").bucket).toBe("day");
    expect(getDashboardSeries(db, owner, "30d").bucket).toBe("day");
    expect(getDashboardSeries(db, owner, "year").bucket).toBe("month");
    expect(getDashboardSeries(db, owner, "year").series.length).toBeGreaterThan(1);
  });

  it("counts new members, renewals and attendance in growth + series", async () => {
    const a = await seedSubWithPayment(1000, 1000); // member a, 1 sub
    const b = await newMember("ب"); // member b, first sub + renewal
    const planB = await createPlan(db, owner, { name: `باقة-${Math.floor(Math.random() * 1e9)}`, durationDays: 30, price: 500 });
    const firstB = await createSubscription(db, owner, { memberId: b.id, planId: planB.id });
    await renewSubscription(db, owner, firstB.id); // successor → renewal

    // direct attendance rows for today
    db.run(
      "INSERT INTO attendance (id, member_id, checkin_at) VALUES (?, ?, ?), (?, ?, ?)",
      [crypto.randomUUID(), a.member.id, `${todayKey()} 09:00:00`, crypto.randomUUID(), a.member.id, `${todayKey()} 11:00:00`],
    );

    const ov = getDashboardOverview(db, owner, "today");
    expect(ov.growth).not.toBeNull();
    expect(ov.growth!.newMembers.current).toBe(2);
    expect(ov.growth!.renewals.current).toBe(1);
    expect(ov.growth!.attendance.current).toBe(2);
    const checksTotal = ov.series.reduce((s, p) => s + p.checks, 0);
    expect(checksTotal).toBe(2);
  });

  it("aggregates outstanding for a partially paid subscription", async () => {
    await seedSubWithPayment(1000, 500);
    const ov = getDashboardOverview(db, owner, "today");
    expect(ov.operations).not.toBeNull();
    expect(ov.operations!.outstandingMembers).toBe(1);
    expect(ov.operations!.outstandingTotalMinor).toBe(50_000);
  });

  it("counts low-stock products for the owner and the reception", async () => {
    await createProduct(db, owner, { name: "مشروب", costMinor: 500, priceMinor: 1000, stockQty: 0, minStockQty: 5 });
    const ownerOv = getDashboardOverview(db, owner, "today");
    expect(ownerOv.store).not.toBeNull();
    expect(ownerOv.store!.lowStock).toBe(1);
    const recOv = getDashboardOverview(db, reception, "today");
    expect(recOv.store).not.toBeNull();
  });

  it("gates finance/operations/store/crm behind the actor's permissions", async () => {
    await seedSubWithPayment(1000, 1000); // revenue row so data exists
    await createProduct(db, owner, { name: "مشروب", costMinor: 500, priceMinor: 1000, stockQty: 0, minStockQty: 5 });

    const trainerOv = getDashboardOverview(db, trainer, "today");
    // trainer only has members.view: no finance, operations, store, or crm
    expect(trainerOv.finance).toBeNull();
    expect(trainerOv.operations).toBeNull();
    expect(trainerOv.store).toBeNull();
    expect(trainerOv.pendingCrmMessages).toBe(0);
    // but members + growth are visible and include seed data
    expect(trainerOv.members).not.toBeNull();
    expect(trainerOv.growth).not.toBeNull();

    // reception has payments/view + subscriptions/view + store/view
    const recOv = getDashboardOverview(db, reception, "today");
    expect(recOv.finance).not.toBeNull();
    expect(recOv.operations).not.toBeNull();
    expect(recOv.store).not.toBeNull();
  });

  it("counts pending CRM messages for roles with crm.send only", async () => {
    const member = await newMember("رسائل"); // has phone → status pending
    await queueMessage(db, owner, { memberId: member.id, customBody: "مرحباً بكم" });
    expect(getDashboardOverview(db, owner, "today").pendingCrmMessages).toBe(1);
    expect(getDashboardOverview(db, reception, "today").pendingCrmMessages).toBe(1);
    expect(getDashboardOverview(db, trainer, "today").pendingCrmMessages).toBe(0);
  });

  it("does not leak revenue to a role that cannot view finance", async () => {
    await seedSubWithPayment(1000, 1000);
    const trainerOv = getDashboardOverview(db, trainer, "today");
    expect(trainerOv.series[0].revenueMinor).toBe(0);
    expect(trainerOv.series[0].expensesMinor).toBe(0);
  });
});
