import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import {
  listLiveOccupants,
  recordCheckIn,
  recordCheckOut,
} from "@/core/services/attendance.service";
import { assignCardByBarcode, registerCard } from "@/core/services/cards.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";
import { todayKey } from "@/core/dates";
import { SETTING_KEYS, updateSetting } from "@/core/services/settings.service";

let db: Db;
let owner: ServiceActor;

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
});

describe("Live Gym Occupants & Dynamic Workout Countdown", () => {
  it("lists live occupants in the gym with calculated elapsed time and remaining countdown", async () => {
    // 1. Create member, plan, and subscription
    const member = await createMember(db, owner, {
      fullName: "محمد علي",
      phone: "01011112222",
      gender: "male",
    });

    const plan = await createPlan(db, owner, {
      name: "باقة شهر صالة",
      durationDays: 30,
      price: 500,
    });

    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: todayKey(),
      price: 500,
    });

    await registerCard(db, owner, { barcodeValue: "TEST-BC-01" });
    await assignCardByBarcode(db, owner, { barcodeValue: "TEST-BC-01", memberId: member.id });

    // 2. Initial state: 0 live occupants
    const initial = listLiveOccupants(db, owner);
    expect(initial.totalNow).toBe(0);
    expect(initial.occupants).toHaveLength(0);

    // 3. Member checks in
    const checkin = await recordCheckIn(db, owner, { barcode: "TEST-BC-01" });
    expect(checkin.kind).toBe("success");

    // 4. Verify member is listed as a live occupant
    const live = listLiveOccupants(db, owner);
    expect(live.totalNow).toBe(1);
    expect(live.occupants).toHaveLength(1);

    const occ = live.occupants[0];
    expect(occ.memberId).toBe(member.id);
    expect(occ.fullName).toBe("محمد علي");
    expect(occ.memberCode).toBe(member.memberCode);
    expect(occ.planName).toBe("باقة شهر صالة");
    expect(occ.durationMinutes).toBe(120); // default
    expect(occ.isOverdue).toBe(false);
    expect(occ.minutesElapsed).toBeGreaterThanOrEqual(0);
    expect(occ.minutesRemaining).toBeLessThanOrEqual(120);

    // 5. Member checks out
    const checkoutRes = await recordCheckOut(db, owner, member.id, occ.attendanceId);
    expect(checkoutRes.kind).toBe("success");

    // 6. Member is removed from live occupants
    const afterCheckout = listLiveOccupants(db, owner);
    expect(afterCheckout.totalNow).toBe(0);
    expect(afterCheckout.occupants).toHaveLength(0);
  });

  it("respects custom occupancy duration setting from settings", async () => {
    // Set custom duration = 60 minutes
    updateSetting(db, owner, SETTING_KEYS.occupancyDurationMinutes, "60");

    const member = await createMember(db, owner, {
      fullName: "خالد سعيد",
      phone: "01033334444",
      gender: "male",
    });

    const plan = await createPlan(db, owner, {
      name: "باقة 60 دقيقة",
      durationDays: 30,
      price: 300,
    });

    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: todayKey(),
      price: 300,
    });

    await registerCard(db, owner, { barcodeValue: "TEST-BC-02" });
    await assignCardByBarcode(db, owner, { barcodeValue: "TEST-BC-02", memberId: member.id });

    await recordCheckIn(db, owner, { barcode: "TEST-BC-02" });

    const live = listLiveOccupants(db, owner);
    expect(live.durationMinutes).toBe(60);
    expect(live.occupants[0].durationMinutes).toBe(60);
  });

  it("automatically checks out overdue occupants when autoCheckoutOverdue setting is enabled", async () => {
    updateSetting(db, owner, SETTING_KEYS.occupancyDurationMinutes, "45");
    updateSetting(db, owner, SETTING_KEYS.autoCheckoutOverdue, "1");

    const member = await createMember(db, owner, {
      fullName: "عمر كمال",
      phone: "01077778888",
      gender: "male",
    });

    const plan = await createPlan(db, owner, {
      name: "باقة 45 دقيقة",
      durationDays: 30,
      price: 200,
    });

    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: todayKey(),
      price: 200,
    });

    // Insert an attendance record from 60 minutes ago (exceeding 45 mins)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const checkinTimeAgo = `${today} ${pad(now.getHours() - 1)}:${pad(now.getMinutes())}:00`;

    db.run(
      "INSERT INTO attendance (id, member_id, checkin_at, created_by) VALUES (?, ?, ?, ?)",
      ["att-auto-1", member.id, checkinTimeAgo, owner.userId]
    );

    // When listLiveOccupants is called, it should auto-checkout the overdue occupant
    const live = listLiveOccupants(db, owner);
    expect(live.totalNow).toBe(0);
    expect(live.occupants).toHaveLength(0);

    // Verify database record has checkout_at populated
    const record = db.first<{ checkout_at: string | null }>("SELECT checkout_at FROM attendance WHERE id = 'att-auto-1'");
    expect(record?.checkout_at).not.toBeNull();
  });
});
