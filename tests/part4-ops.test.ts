import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  createTrainer,
  listTrainers,
  setTrainerActive,
  updateTrainer,
} from "@/core/services/trainers.service";
import {
  cancelTrainingPlan,
  createTrainingPlan,
  endTrainingPlan,
  listTrainingPlans,
  sweepExpiredPlans,
  updateTrainingPlan,
} from "@/core/services/training-plans.service";
import { collectNotifications } from "@/core/services/notifications.service";
import { getAttendanceAnalytics } from "@/core/services/attendance-analytics.service";
import { getStaffActivity } from "@/core/services/staff-activity.service";
import { getExpiryThresholds, updateSetting } from "@/core/services/settings.service";
import {
  assignCardByBarcode,
  registerCard,
  registerCardsBulk,
  reportCardLost,
} from "@/core/services/cards.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { recordPayment } from "@/core/services/payments.service";
import {
  createMember,
  setMemberStatus,
} from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
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
      gymName: "جيم برو",
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

async function activeMemberWithSub(name: string) {
  const member = await createMember(db, owner, { fullName: name });
  const plan = await createPlan(db, owner, { name: `${name}-باقة`, durationDays: 30, price: 300 });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  return { member, sub };
}

describe("trainers service", () => {
  it("creates trainers with validation and normalizes optional fields", async () => {
    const trainer = await createTrainer(db, owner, {
      fullName: "كريم السيد",
      phone: "01000000001",
      specialization: "كمال أجسام",
    });
    expect(trainer.isActive).toBe(true);
    expect(trainer.phone).toBe("01000000001");
    expect(trainer.email).toBeNull();

    await expect(createTrainer(db, owner, { fullName: "ا" })).rejects.toMatchObject({
      messageKey: "errors.fullNameRequired",
    });
    await expect(
      createTrainer(db, owner, { fullName: "مدرب تاني", phone: "01000000001" }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "errors.trainerPhoneTaken" });
    await expect(
      createTrainer(db, owner, { fullName: "مدرب ثالث", email: "not-an-email" }),
    ).rejects.toMatchObject({ messageKey: "errors.emailInvalid" });
  });

  it("enforces permission matrix for trainers module", async () => {
    await expect(
      createTrainer(db, reception, { fullName: "ممنوع من الإنشاء" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(() => listTrainers(db, trainerUser)).toThrowError("errors.forbidden");
    expect(listTrainers(db, reception)).toHaveLength(0);
  });

  it("updates trainer data and blocks deactivation while plans are active", async () => {
    const trainer = await createTrainer(db, owner, { fullName: "حسن علي" });
    const { member } = await activeMemberWithSub("عضو خطة");
    await createTrainingPlan(db, owner, {
      memberId: member.id,
      trainerId: trainer.id,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 30),
    });

    await expect(setTrainerActive(db, owner, trainer.id, false)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "errors.trainerHasActivePlans",
    });

    const plans = listTrainingPlans(db, owner).items;
    const ended = await endTrainingPlan(db, owner, plans[0].id);
    expect(ended.status).toBe("ended");

    await setTrainerActive(db, owner, trainer.id, false);
    expect(listTrainers(db, owner)[0].isActive).toBe(false);

    const updated = await updateTrainer(db, owner, trainer.id, {
      fullName: "حسن علي محمد",
      specialization: "لياقة",
    });
    expect(updated.fullName).toBe("حسن علي محمد");
  });
});

describe("training plans service", () => {
  it("creates plans only for active members with valid date ranges and overlap guard", async () => {
    const trainer = await createTrainer(db, owner, { fullName: "سيف إسلام" });
    const { member } = await activeMemberWithSub("متدرب");

    await expect(
      createTrainingPlan(db, owner, {
        memberId: member.id,
        trainerId: trainer.id,
        startDate: todayKey(),
        endDate: addDaysKey(todayKey(), -10),
      }),
    ).rejects.toMatchObject({ messageKey: "errors.trainingPlanDateRange" });

    const archived = await createMember(db, owner, { fullName: "مؤرشف" });
    await setMemberStatus(db, owner, archived.id, "archived");
    await expect(
      createTrainingPlan(db, owner, {
        memberId: archived.id,
        trainerId: trainer.id,
        startDate: todayKey(),
        endDate: addDaysKey(todayKey(), 7),
      }),
    ).rejects.toMatchObject({ messageKey: "errors.memberArchived" });

    const plan = await createTrainingPlan(db, owner, {
      memberId: member.id,
      trainerId: trainer.id,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 14),
      notes: "تركيز على الظهر",
    });
    expect(plan.status).toBe("active");

    await expect(
      createTrainingPlan(db, owner, {
        memberId: member.id,
        trainerId: trainer.id,
        startDate: addDaysKey(todayKey(), 7),
        endDate: addDaysKey(todayKey(), 21),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "errors.trainingPlanOverlap" });
  });

  it("updates and transitions plans with guards", async () => {
    const trainerA = await createTrainer(db, owner, { fullName: "أحمد مدرب" });
    const trainerB = await createTrainer(db, owner, { fullName: "محمود مدرب" });
    const { member } = await activeMemberWithSub("مشترك خطة");
    const plan = await createTrainingPlan(db, owner, {
      memberId: member.id,
      trainerId: trainerA.id,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 30),
    });

    const updated = await updateTrainingPlan(db, owner, plan.id, {
      trainerId: trainerB.id,
      endDate: addDaysKey(todayKey(), 60),
    });
    expect(updated.trainerId).toBe(trainerB.id);

    const cancelled = await cancelTrainingPlan(db, owner, plan.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(updateTrainingPlan(db, owner, plan.id, { notes: "x" })).rejects.toMatchObject({
      messageKey: "errors.trainingPlanNotEditable",
    });
    await expect(endTrainingPlan(db, owner, plan.id)).rejects.toMatchObject({
      messageKey: "errors.trainingPlanNotEditable",
    });
  });

  it("sweeps expired plans automatically without touching current ones", async () => {
    const trainer = await createTrainer(db, owner, { fullName: "مدرب سويتش" });
    const { member } = await activeMemberWithSub("سويت");
    const pastEnd = addDaysKey(todayKey(), -5);
    db.run(
      "INSERT INTO training_plans (id, member_id, trainer_id, start_date, end_date, status, created_at, updated_at)\nVALUES ('plan-past', ?, ?, '2020-01-01', ?, 'active', '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
      [member.id, trainer.id, pastEnd],
    );
    const current = await createTrainingPlan(db, owner, {
      memberId: member.id,
      trainerId: trainer.id,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 10),
    });

    expect(sweepExpiredPlans(db, owner)).toBe(1);
    expect(listTrainingPlans(db, owner, { status: "active" }).items.map((p) => p.id)).toEqual([
      current.id,
    ]);
    expect(listTrainingPlans(db, owner, { status: "ended" }).items[0].id).toBe("plan-past");
    expect(sweepExpiredPlans(db, owner)).toBe(0);
  });
});

describe("notifications engine", () => {
  it("reports expired subs, expiry buckets, balances, lost cards and backup staleness", async () => {
    const expiringToday = await activeMemberWithSub("ينتهي اليوم");
    db.run(
      "UPDATE member_subscriptions SET start_date = ?, end_date = ? WHERE id = ?",
      [addDaysKey(todayKey(), -29), todayKey(), expiringToday.sub.id],
    );
    const expired = await activeMemberWithSub("منتهي");
    db.run(
      "UPDATE member_subscriptions SET start_date = ?, end_date = ? WHERE id = ?",
      [addDaysKey(todayKey(), -33), addDaysKey(todayKey(), -3), expired.sub.id],
    );

    // outstanding balance via a partial payment
    await recordPayment(db, reception, {
      memberId: expired.member.id,
      subscriptionId: expired.sub.id,
      baseAmountMinor: 30_000,
      paidAmountMinor: 10_000,
      methodCode: "cash",
    });

    const lostCard = await registerCard(db, reception, { barcodeValue: "GYM-555001" });
    await reportCardLost(db, owner, lostCard.id);

    const items = collectNotifications(db, owner);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("expired")?.count).toBe(1);
    expect(byId.get("expiry:1")?.count).toBe(1);
    expect(byId.get("expiry:3")).toBeDefined();
    expect(byId.get("expiry:7")).toBeDefined();
    expect(byId.get("balance")?.count).toBe(2);
    expect(byId.get("card_lost")?.count).toBe(1);
    expect(byId.get("backup")).toBeDefined();
  });

  it("filters notifications by permissions for restricted roles", async () => {
    const { member, sub } = await activeMemberWithSub("متأخر الدفع");
    await recordPayment(db, reception, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 30_000,
      paidAmountMinor: 5_000,
      methodCode: "cash",
    });

    const itemsTrainer = collectNotifications(db, trainerUser);
    expect(itemsTrainer.find((i) => i.id === "balance")).toBeUndefined();
    expect(itemsTrainer.find((i) => i.id === "card_lost")).toBeUndefined();

    const itemsReception = collectNotifications(db, reception);
    expect(itemsReception.find((i) => i.id === "balance")?.count).toBe(1);
  });

  it("reads configured expiry thresholds with defaults", async () => {
    expect(getExpiryThresholds(db)).toEqual([1, 3, 7]);
    await updateSetting(db, owner, "notify_expiry_days", "14,2");
    expect(getExpiryThresholds(db)).toEqual([2, 14]);
  });
});

describe("attendance analytics", () => {
  it("aggregates visits, unique members, daily series and top/least members", async () => {
    const a = await activeMemberWithSub("منتظم");
    const b = await activeMemberWithSub("نادر");
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-321001", memberId: a.member.id });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-321002", memberId: b.member.id });

    await recordCheckIn(db, reception, { barcode: "GYM-321001" });
    await recordCheckIn(db, reception, { barcode: "GYM-321002" });

    const analytics = getAttendanceAnalytics(db, owner, {
      fromKey: addDaysKey(todayKey(), -7),
      toKey: todayKey(),
    });
    expect(analytics.visits).toBe(2);
    expect(analytics.uniqueMembers).toBe(2);
    expect(analytics.daily).toHaveLength(8);
    expect(analytics.peakHours.reduce((sum, h) => sum + h.count, 0)).toBe(2);
    expect(analytics.topMembers[0].visits).toBeGreaterThan(0);
    expect(analytics.leastMembers.length).toBeLessThanOrEqual(5);

    expect(() =>
      getAttendanceAnalytics(db, owner, { fromKey: "2026-05-10", toKey: "2026-05-01" }),
    ).toThrowError("errors.invalidRange");
  });

  it("denies analytics to users without checkin history permission", () => {
    expect(() =>
      getAttendanceAnalytics(db, trainerUser, { fromKey: todayKey(), toKey: todayKey() }),
    ).toThrowError("errors.forbidden");
  });
});

describe("staff activity report", () => {
  it("groups audit actions per user within a range", async () => {
    const trainer = await createTrainer(db, owner, { fullName: "مدرب تقارير" });
    const { member } = await activeMemberWithSub("عضو تدقيق");
    await createTrainingPlan(db, owner, {
      memberId: member.id,
      trainerId: trainer.id,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 5),
    });

    const report = getStaffActivity(db, owner, {
      fromKey: addDaysKey(todayKey(), -1),
      toKey: addDaysKey(todayKey(), 1),
    });
    expect(report.totalActions).toBeGreaterThan(0);
    const ownerEntries = report.entries.filter((e) => e.userName === "owner");
    expect(ownerEntries.some((e) => e.action === "TRAINER_CREATED")).toBe(true);
    expect(ownerEntries.some((e) => e.action === "TRAINING_PLAN_CREATED")).toBe(true);
  });
});

describe("settings validation (part 4 keys)", () => {
  it("validates scanner/expiry settings and normalizes thresholds", async () => {
    await updateSetting(db, owner, "scanner_enabled", "0");
    await updateSetting(db, owner, "scanner_prefix", "ABC");
    await updateSetting(db, owner, "notify_expiry_days", "7,1,3,3");
    expect(getExpiryThresholds(db)).toEqual([1, 3, 7]);

    await expect(updateSetting(db, owner, "scanner_enabled", "yes")).rejects.toMatchObject({
      messageKey: "errors.settingBoolInvalid",
    });
    await expect(updateSetting(db, owner, "scanner_min_length", "500")).rejects.toMatchObject({
      messageKey: "errors.settingValueInvalid",
    });
    await expect(updateSetting(db, owner, "notify_expiry_days", "1;2")).rejects.toMatchObject({
      messageKey: "errors.settingExpiryDaysInvalid",
    });
    await expect(updateSetting(db, owner, "unknown_key", "x")).rejects.toMatchObject({
      messageKey: "errors.settingKeyInvalid",
    });
    await expect(updateSetting(db, owner, "date_format", "iso")).rejects.toMatchObject({
      messageKey: "errors.settingDateFormatInvalid",
    });
  });
});

describe("bulk card registration", () => {
  it("registers valid barcodes and reports duplicates/existing/invalid", async () => {
    await registerCard(db, reception, { barcodeValue: "GYM-800001" });

    const result = await registerCardsBulk(db, reception, {
      values: [
        "",
        "GYM-800002",
        "GYM-800003",
        "GYM-800002",
        "GYM-800001",
        "bad code!",
        "GYM-800004 ",
      ],
    });
    expect(result.registered.sort()).toEqual(["GYM-800002", "GYM-800003", "GYM-800004"]);
    expect(result.duplicateInBatch).toEqual(["GYM-800002"]);
    expect(result.existing).toEqual(["GYM-800001"]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reason).toBe("format");

    const again = await registerCardsBulk(db, reception, { values: ["GYM-800002"] });
    expect(again.registered).toEqual([]);
    expect(again.existing).toEqual(["GYM-800002"]);

    // audit is only written when at least one card was inserted
    expect(
      db.count("SELECT COUNT(*) FROM audit_logs WHERE action = 'CARD_BULK_REGISTERED'"),
    ).toBe(1);
  });

  it("requires cards.register permission", async () => {
    await expect(
      registerCardsBulk(db, trainerUser, { values: ["GYM-900001"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
