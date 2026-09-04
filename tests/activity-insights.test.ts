import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { assignCardByBarcode, registerCard } from "@/core/services/cards.service";
import {
  createMember,
  setMemberStatus,
} from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { updateSetting } from "@/core/services/settings.service";
import { getRetentionInsights } from "@/core/services/activity-insights.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { addDaysKey, todayKey } from "@/core/dates";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;
let trainerUser: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  owner = buildActor(
    await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
  trainerUser = buildActor(
    await createUser(db, owner, {
      username: "trainer1",
      password: "Train@2026",
      fullName: "مدرب أول",
      roleId: "trainer",
    }),
  );
});

async function activeMemberWithCard(name: string, department?: "general" | "men" | "women") {
  const member = await createMember(db, owner, { fullName: name, department });
  const plan = await createPlan(db, owner, { name: `${name}-باقة`, durationDays: 30, price: 300 });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  const barcode = `GYM-${900000 + Math.floor(Math.random() * 10000)}`;
  const card = await registerCard(db, reception, { barcodeValue: barcode });
  await assignCardByBarcode(db, reception, { barcodeValue: barcode, memberId: member.id });
  return { member, sub, card };
}

// Force a given attendance row's checkin timestamp (recordCheckIn stamps 'now').
function insertCheckInAt(memberId: string, cardId: string, subscriptionId: string, onKey: string) {
  db.run(
    "INSERT INTO attendance (id, member_id, card_id, subscription_id, checkin_at, created_by, notes)\nVALUES (?, ?, ?, ?, ? || ' 12:00:00', NULL, NULL)",
    [crypto.randomUUID(), memberId, cardId, subscriptionId, onKey],
  );
}

describe("retention insights", () => {
  it("flags inactive members, splits new vs returning, and reports averages/dow/department", async () => {
    // A: visited today, first-ever visit today -> "new", 1 in-range visit
    const active = await activeMemberWithCard("منتظم");
    await recordCheckIn(db, reception, { barcode: active.card.barcodeValue });

    // B: active sub, but no visit ever -> "inactive"
    const drifting = await activeMemberWithCard("متراجع", "women");

    // C: first visit 2 days ago (in-range) + today -> "new" with 2 visits
    const fresh = await activeMemberWithCard("وافد جديد", "men");
    insertCheckInAt(fresh.member.id, fresh.card.id, fresh.sub.id, addDaysKey(todayKey(), -2));
    await recordCheckIn(db, reception, { barcode: fresh.card.barcodeValue });

    // R: first visit 10 days ago (before range) + today -> "returning"
    const returning = await activeMemberWithCard("عائد", "general");
    insertCheckInAt(returning.member.id, returning.card.id, returning.sub.id, addDaysKey(todayKey(), -10));
    await recordCheckIn(db, reception, { barcode: returning.card.barcodeValue });

    const range = { fromKey: addDaysKey(todayKey(), -7), toKey: todayKey() };
    const insights = getRetentionInsights(db, owner, range);

    // default inactive threshold
    expect(insights.inactiveThresholdDays).toBe(7);
    const inactiveIds = insights.inactiveMembers.map((m) => m.memberId);
    expect(inactiveIds).toContain(drifting.member.id);
    expect(inactiveIds).not.toContain(active.member.id);
    expect(inactiveIds).not.toContain(fresh.member.id);
    expect(inactiveIds).not.toContain(returning.member.id);

    // visitor split: A + C are new, R returns
    expect(insights.visitorSplit.newMembers).toBe(2);
    expect(insights.visitorSplit.returning).toBe(1);
    const uniqueVisitors = insights.visitorSplit.newMembers + insights.visitorSplit.returning;
    expect(uniqueVisitors).toBe(3);

    // visits: A(1) + C(2) + R(1) = 4 ; avg = 4 / 3
    expect(insights.totalVisitors).toBe(4);
    expect(insights.avgCheckinsPerVisitingMember).toBeCloseTo(4 / 3, 2);

    // day-of-week buckets sum to total visits and cover all 7 days
    expect(insights.byDayOfWeek).toHaveLength(7);
    expect(insights.byDayOfWeek.reduce((s, p) => s + p.count, 0)).toBe(insights.totalVisitors);

    // department split sums to total visits; men section gets C's 2 visits
    expect(insights.byDepartment.reduce((s, p) => s + p.count, 0)).toBe(insights.totalVisitors);
    expect(insights.byDepartment.find((p) => p.department === "men")?.count).toBe(2);
  });

  it("denies users without reports.view", () => {
    expect(() =>
      getRetentionInsights(db, reception, { fromKey: todayKey(), toKey: todayKey() }),
    ).toThrowError("errors.forbidden");
    expect(() =>
      getRetentionInsights(db, trainerUser, { fromKey: todayKey(), toKey: todayKey() }),
    ).toThrowError("errors.forbidden");
  });

  it("validates range dates", () => {
    expect(() =>
      getRetentionInsights(db, owner, { fromKey: "2026-05-10", toKey: "2026-05-01" }),
    ).toThrowError("errors.invalidRange");
    expect(() =>
      getRetentionInsights(db, owner, { fromKey: "not-a-date", toKey: "2026-05-01" }),
    ).toThrowError("errors.invalidDate");
  });

  it("respects the configured inactive_days threshold", async () => {
    await updateSetting(db, owner, "inactive_days", "2");
    const drifting = await activeMemberWithCard("متراجع قصير");
    const insights = getRetentionInsights(db, owner, {
      fromKey: addDaysKey(todayKey(), -7),
      toKey: todayKey(),
    });
    expect(insights.inactiveThresholdDays).toBe(2);
    expect(insights.inactiveMembers.map((m) => m.memberId)).toContain(drifting.member.id);
  });

  it("excludes archived and non-active members from the inactive list", async () => {
    await setMemberStatus(db, owner, (await activeMemberWithCard("مؤرشف")).member.id, "archived");
    const insights = getRetentionInsights(db, owner, {
      fromKey: addDaysKey(todayKey(), -7),
      toKey: todayKey(),
    });
    expect(insights.inactiveMembers.map((m) => m.memberName)).not.toContain("مؤرشف");
  });
});