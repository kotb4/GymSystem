import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  createSubscription,
  freezeSubscription,
  unfreezeSubscription,
  listSubscriptionFreezes,
} from "@/core/services/subscriptions.service";
import { createPlan } from "@/core/services/plans.service";
import { writeSettingInternal, SETTING_KEYS } from "@/core/services/settings.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";
import { addDaysKey, todayKey, diffDaysKeys } from "@/core/dates";

let db: Db;
let owner: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Test Gym",
    ownerFullName: "Owner",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
});

describe("enhanced freeze system - explicit date range", () => {
  it("creates a freeze row with start_date, end_date, duration_days and notes", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 1" });
    const plan = await createPlan(db, owner, { name: "شهري 30", durationDays: 30, price: 300 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const today = todayKey();
    const endDate = addDaysKey(today, 5);
    await freezeSubscription(db, owner, sub.id, {
      startDate: today,
      endDate,
      reason: "سفر",
      notes: "إجازة عائلية",
    });

    const freezes = listSubscriptionFreezes(db, owner, sub.id);
    expect(freezes).toHaveLength(1);
    const f = freezes[0];
    expect(f.startDate).toBe(today);
    expect(f.endDate).toBe(endDate);
    expect(f.durationDays).toBe(diffDaysKeys(today, endDate) + 1);
    expect(f.reason).toBe("سفر");
    expect(f.notes).toBe("إجازة عائلية");
    expect(f.actualResumeDate).toBeNull();
  });

  it("defaults startDate to today when not provided", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 2" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const today = todayKey();
    const endDate = addDaysKey(today, 3);
    await freezeSubscription(db, owner, sub.id, { endDate });
    const freezes = listSubscriptionFreezes(db, owner, sub.id);
    expect(freezes[0].startDate).toBe(today);
    expect(freezes[0].endDate).toBe(endDate);
  });

  it("rejects freeze when endDate is missing", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 3" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    await expect(
      freezeSubscription(db, owner, sub.id, { endDate: "" as unknown as string })
    ).rejects.toMatchObject({ messageKey: "errors.freezeEndDateInvalid" });
  });

  it("rejects freeze when endDate is before startDate", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 4" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const today = todayKey();
    const startDate = addDaysKey(today, 3);
    const endDate = addDaysKey(today, 1);
    await expect(
      freezeSubscription(db, owner, sub.id, { startDate, endDate })
    ).rejects.toMatchObject({ messageKey: "errors.freezeEndDateInvalid" });
  });

  it("rejects freeze when dates are outside the subscription window", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 5" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const subEnd = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [
        sub.id,
      ])!
    ).end_date;
    const beyondEnd = addDaysKey(subEnd, 5);
    await expect(
      freezeSubscription(db, owner, sub.id, { endDate: beyondEnd })
    ).rejects.toMatchObject({ messageKey: "errors.freezeEndDateInvalid" });
  });

  it("rejects overlapping open freezes on the same subscription", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 6" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const today = todayKey();
    const end1 = addDaysKey(today, 3);
    await freezeSubscription(db, owner, sub.id, { endDate: end1 });
    await expect(
      freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(today, 5) })
    ).rejects.toMatchObject({ messageKey: "errors.subscriptionAlreadyFrozen" });
  });

  it("any unfreeze extends by actual elapsed days; a same-day freeze/unfreeze grants 0 days", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 7" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    writeSettingInternal(db, SETTING_KEYS.freezeExtendsExpiry, "0");
    const today = todayKey();
    const freezeEnd = addDaysKey(today, 2);
    const endBefore = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [
        sub.id,
      ])!
    ).end_date;
    // Freeze starts today, unfreeze happens today (unfreeze date == start date):
    // manual unfreeze is allowed, but no full calendar day elapsed → 0 days added.
    await freezeSubscription(db, owner, sub.id, { endDate: freezeEnd });
    const updated = await unfreezeSubscription(db, owner, sub.id);
    expect(updated.endDate).toBe(endBefore);
    const after = db.first<{ frozen_days: number }>(
      "SELECT frozen_days FROM member_subscriptions WHERE id = ?",
      [sub.id]
    );
    expect(Number(after?.frozen_days)).toBe(0);
  });

  it("unfreezing a freeze that started on a previous day extends by the elapsed days", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 7b" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    writeSettingInternal(db, SETTING_KEYS.freezeExtendsExpiry, "0");
    const today = todayKey();
    const endBefore = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [
        sub.id,
      ])!
    ).end_date;
    // Create a freeze starting today, then backdate its start_date so it spans
    // yesterday + today (inclusive endpoints) before the same-day unfreeze → +2 days.
    await freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(today, 2) });
    db.run("UPDATE subscription_freezes SET start_date = ? WHERE subscription_id = ?", [
      addDaysKey(today, -1),
      sub.id,
    ]);
    const updated = await unfreezeSubscription(db, owner, sub.id);
    const expected = addDaysKey(endBefore, 2);
    expect(updated.endDate).toBe(expected);
    const after = db.first<{ frozen_days: number }>(
      "SELECT frozen_days FROM member_subscriptions WHERE id = ?",
      [sub.id]
    );
    expect(Number(after?.frozen_days)).toBe(2);
  });

  it("auto-unfreeze on check-in respects the freeze_extends_expiry setting (off)", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 8" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    writeSettingInternal(db, SETTING_KEYS.freezeExtendsExpiry, "0");
    const today = todayKey();
    const freezeEnd = addDaysKey(today, 2);
    const endBefore = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [
        sub.id,
      ])!
    ).end_date;
    await freezeSubscription(db, owner, sub.id, { endDate: freezeEnd });
    const { assignCardByBarcode } = await import("@/core/services/cards.service");
    const { card } = await assignCardByBarcode(db, owner, { memberId: m.id, barcodeValue: `GYM-F1-${m.id.slice(0, 4)}` });
    await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    const after = db.first<{ end_date: string; status: string; frozen_days: number }>(
      "SELECT end_date, status, frozen_days FROM member_subscriptions WHERE id = ?",
      [sub.id]
    )!;
    expect(after.status).toBe("active");
    expect(after.end_date).toBe(endBefore);
    expect(Number(after.frozen_days)).toBe(0);
  });

  it("auto-unfreeze on check-in extends end_date when setting is on", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 9" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    writeSettingInternal(db, SETTING_KEYS.freezeExtendsExpiry, "1");
    const today = todayKey();
    const freezeEnd = addDaysKey(today, 2);
    const endBefore = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [
        sub.id,
      ])!
    ).end_date;
    await freezeSubscription(db, owner, sub.id, { endDate: freezeEnd });
    // Backdate the freeze start so it spans yesterday + today (inclusive
    // endpoints) by the same-day auto-unfreeze → +2 days (non-same-day extends).
    db.run("UPDATE subscription_freezes SET start_date = ? WHERE subscription_id = ?", [
      addDaysKey(today, -1),
      sub.id,
    ]);
    const { assignCardByBarcode } = await import("@/core/services/cards.service");
    const { card } = await assignCardByBarcode(db, owner, { memberId: m.id, barcodeValue: `GYM-F2-${m.id.slice(0, 4)}` });
    await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    const after = db.first<{ end_date: string; status: string }>(
      "SELECT end_date, status FROM member_subscriptions WHERE id = ?",
      [sub.id]
    )!;
    const actualFrozenDays = 2;
    const expected = addDaysKey(endBefore, actualFrozenDays);
    expect(after.end_date).toBe(expected);
    expect(after.status).toBe("active");
  });

  it("enforces package allowed freeze count", async () => {
    const { createPackage } = await import("@/core/services/packages.service");
    const pkg = await createPackage(db, owner, {
      name: "باقة تجميد",
      model: "time",
      durationDays: 60,
      price: 60000,
      allowedFreezes: 1,
      freezeAllowanceDays: 30,
    });
    const m = await createMember(db, owner, { fullName: "عضو 10" });
    const sub = await createSubscription(db, owner, {
      memberId: m.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    const today = todayKey();
    const end1 = addDaysKey(today, 1);
    await freezeSubscription(db, owner, sub.id, { endDate: end1 });
    await unfreezeSubscription(db, owner, sub.id);
    await expect(
      freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(today, 2) })
    ).rejects.toMatchObject({ messageKey: "errors.freezeMaxReached" });
  });

  it("rejects a freeze that would exceed the cumulative days allowance (bypass guard)", async () => {
    const { createPackage } = await import("@/core/services/packages.service");
    const pkg = await createPackage(db, owner, {
      name: "باقة أيام تجميد",
      model: "time",
      durationDays: 60,
      price: 60000,
      allowedFreezes: 99,
      freezeAllowanceDays: 7,
    });
    const m = await createMember(db, owner, { fullName: "عضو 11" });
    const sub = await createSubscription(db, owner, {
      memberId: m.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    const today = todayKey();

    // Simulate 5 of the 7 allowed days already consumed (as would accumulate over
    // past freezes), leaving 2 remaining.
    db.run("UPDATE member_subscriptions SET frozen_days = 5 WHERE id = ?", [sub.id]);

    // A within-allowance freeze (5 + 2 = 7, not > 7) is still permitted.
    await expect(
      freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(today, 1) })
    ).resolves.toBeTruthy();
    await unfreezeSubscription(db, owner, sub.id);

    // Reset to the reported "5 consumed" state, then the 30-day request
    // (5 + 30 = 35 > 7) must be rejected.
    db.run("UPDATE member_subscriptions SET frozen_days = 5 WHERE id = ?", [sub.id]);
    await expect(
      freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(today, 29) })
    ).rejects.toMatchObject({ messageKey: "errors.freezeAllowanceExhausted" });
  });

  it("repeated same-day freeze/unfreeze does NOT inflate the expiry (phantom-day guard)", async () => {
    const m = await createMember(db, owner, { fullName: "عضو 12" });
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 200 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const today = todayKey();
    const endBefore = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [
        sub.id,
      ])!
    ).end_date;

    // The reported exploit: the same-day cycle repeated 3 times must NOT add
    // 3 free days. Each freeze+unfreeze happens on the same calendar day.
    for (let i = 0; i < 3; i++) {
      await freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(today, 2) });
      await unfreezeSubscription(db, owner, sub.id);
    }

    const after = db.first<{ end_date: string; frozen_days: number }>(
      "SELECT end_date, frozen_days FROM member_subscriptions WHERE id = ?",
      [sub.id],
    )!;
    expect(after.end_date).toBe(endBefore);
    expect(Number(after.frozen_days)).toBe(0);
  });
});
