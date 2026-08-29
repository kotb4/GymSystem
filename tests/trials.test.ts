import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { assignCardByBarcode } from "@/core/services/cards.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import * as trials from "@/core/services/trials.service";
import { countExpiredTrials } from "@/core/services/trials.service";
import * as leads from "@/core/services/lead.service";
import { todayKey, addDaysKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let trainer: ServiceActor;

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
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "مدرب",
      roleId: "trainer",
    }),
  );
});

async function trialMember(name: string) {
  return createMember(db, owner, { fullName: name });
}

describe("trial authorization", () => {
  it("denies trainer without trials.view / trials.create / trials.manage", async () => {
    await expect(
      trials.createTrial(db, trainer, { trialType: "day_1", leadId: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => trials.listTrials(db, trainer, {})).toThrow();
    expect(() => trials.getTrial(db, trainer, "nope")).toThrow();
    expect(() => trials.trialStats(db, trainer)).toThrow();
  });
});

describe("trial creation + dates", () => {
  it("creates an active fixed-length trial and auto-computes end date", async () => {
    const member = await trialMember("محمود تجربة");
    const tr = await trials.createTrial(db, owner, {
      trialType: "day_3",
      memberId: member.id,
      startDate: todayKey(),
    });
    expect(tr.status).toBe("active");
    expect(tr.endDate).toBe(addDaysKey(todayKey(), 2));
    expect(tr.planName).toBeNull();
    expect(tr.memberId).toBe(member.id);
  });

  it("marks a lapsed window as expired even before the sweep", async () => {
    const past = addDaysKey(todayKey(), -5);
    const tr = await trials.createTrial(db, owner, {
      trialType: "custom",
      startDate: addDaysKey(todayKey(), -5),
      endDate: past,
    });
    expect(tr.status).toBe("expired");
    expect(tr.effectiveStatus).toBe("expired");
  });

  it("rejects invalid type, end date, department, and phone", async () => {
    await expect(
      trials.createTrial(db, owner, { trialType: "nope" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      trials.createTrial(db, owner, { trialType: "custom", endDate: "" }),
    ).rejects.toMatchObject({ messageKey: "errors.trialEndDateRequired" });
    await expect(
      trials.createTrial(db, owner, {
        trialType: "custom",
        startDate: todayKey(),
        endDate: addDaysKey(todayKey(), -1),
      }),
    ).rejects.toMatchObject({ messageKey: "errors.trialDateRange" });
    await expect(
      trials.createTrial(db, owner, { trialType: "day_1", department: "ghost" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      trials.createTrial(db, owner, { trialType: "day_1", phone: "123" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an inactive plan", async () => {
    const plan = await createPlan(db, owner, { name: "باقة", durationDays: 30, price: 300 });
    await expect(
      trials.createTrial(db, owner, { trialType: "day_1", preferredPlanId: "missing" }),
    ).rejects.toMatchObject({ messageKey: "errors.trialPlanInvalid" });
  });
});

describe("trial list + stats", () => {
  it("filters listTrials by status and search", async () => {
    const a = await trialMember("أحمد التجربة");
    const b = await trialMember("منى التجربة");
    await trials.createTrial(db, owner, { trialType: "day_7", memberId: a.id });
    const bTrial = await trials.createTrial(db, owner, { trialType: "day_1", memberId: b.id });
    await trials.cancelTrial(db, owner, bTrial.id, "غير راغب");

    const active = trials.listTrials(db, owner, { status: "active" });
    expect(active.items.length).toBe(1);
    expect(active.items[0].memberId).toBe(a.id);

    const bySearch = trials.listTrials(db, owner, { search: "منى" });
    expect(bySearch.total).toBe(1);

    const stats = trials.trialStats(db, owner);
    expect(stats.total).toBe(2);
    expect(stats.cancelled).toBe(1);
  });
});

describe("trial check-in authority", () => {
  it("lets a member with an active trial window check in without a subscription", async () => {
    const member = await trialMember("عضو تجربة يحضر");
    await trials.createTrial(db, owner, {
      trialType: "day_3",
      memberId: member.id,
      startDate: todayKey(),
    });
    const { card } = await assignCardByBarcode(db, owner, {
      barcodeValue: "GYM-TRL001",
      memberId: member.id,
    });
    const result = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.planName).toBe("trial:day_3");
      expect(result.subscriptionEndsAt).toBe(addDaysKey(todayKey(), 2));
    }
  });

  it("denies a member with no subscription and no active trial", async () => {
    const member = await trialMember("عضو بدون اشتراك");
    const { card } = await assignCardByBarcode(db, owner, {
      barcodeValue: "GYM-TRL002",
      memberId: member.id,
    });
    const result = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(result).toMatchObject({ kind: "denied", reason: "NO_ACTIVE_SUBSCRIPTION" });
  });

  it("does not authorize a trial whose window already lapsed", async () => {
    const member = await trialMember("عضو تجربة منتهية");
    await trials.createTrial(db, owner, {
      trialType: "custom",
      memberId: member.id,
      startDate: addDaysKey(todayKey(), -5),
      endDate: addDaysKey(todayKey(), -3),
    });
    expect(trials.activeTrialForMember(db, member.id, todayKey())).toBeNull();
    const { card } = await assignCardByBarcode(db, owner, {
      barcodeValue: "GYM-TRL003",
      memberId: member.id,
    });
    const result = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(result).toMatchObject({ kind: "denied", reason: "NO_ACTIVE_SUBSCRIPTION" });
  });
});

describe("trial lifecycle", () => {
  it("sweeps lapsed-but-still-active trials and counts expired", async () => {
    const member = await trialMember("عضو محافظة");
    const tr = await trials.createTrial(db, owner, {
      trialType: "custom",
      memberId: member.id,
      startDate: addDaysKey(todayKey(), -5),
      endDate: addDaysKey(todayKey(), -3),
    });
    expect(tr.status).toBe("expired");
    expect(countExpiredTrials(db)).toBe(0);
    // force a stale "active" record whose window has passed
    db.run("UPDATE trials SET status = 'active' WHERE id = ?", [tr.id]);
    expect(countExpiredTrials(db)).toBe(1);
    const changed = trials.sweepExpiredTrials(db, owner);
    expect(changed).toBe(1);
    expect(trials.getTrial(db, owner, tr.id).status).toBe("expired");
  });

  it("expireTrial rejects while the window is still open", async () => {
    const member = await trialMember("عضو تجربة الآن");
    const tr = await trials.createTrial(db, owner, { trialType: "day_7", memberId: member.id });
    await expect(trials.expireTrial(db, owner, tr.id)).rejects.toMatchObject({
      messageKey: "errors.trialNotYetExpired",
    });
  });

  it("cancels a trial with a reason and blocks further edits", async () => {
    const member = await trialMember("عضو إلغاء");
    const tr = await trials.createTrial(db, owner, { trialType: "day_1", memberId: member.id });
    const cancelled = await trials.cancelTrial(db, owner, tr.id, "اختار مكان آخر");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("اختار مكان آخر");
    await expect(
      trials.cancelTrial(db, owner, tr.id, "مرة أخرى"),
    ).rejects.toMatchObject({ messageKey: "errors.trialNotEditable" });
  });
});

describe("trial conversion", () => {
  it("converts an unlinked trial into a member and optionally attaches a subscription", async () => {
    const plan = await createPlan(db, owner, { name: "باقة شهر", durationDays: 30, price: 300 });
    const lead = await leads.createLead(db, owner, {
      fullName: "ليلى التجربة",
      phone: "01050000001",
      source: "walk_in",
      department: "general",
    });
    const tr = await trials.createTrial(db, owner, {
      trialType: "day_7",
      leadId: lead.id,
      notes: "مهتم",
    });
    expect(tr.memberName).toBe("ليلى التجربة");
    const res = await trials.convertTrial(db, owner, {
      trialId: tr.id,
      planId: plan.id,
      price: 300,
    });
    expect(res.linkedExisting).toBe(false);
    expect(res.subscriptionId).toBeTruthy();
    expect(res.memberCode).toBeTruthy();

    const got = trials.getTrial(db, owner, tr.id);
    expect(got.status).toBe("converted");
    expect(got.convertedMemberId).toBe(res.memberId);
  });

  it("rejects converting the same trial twice", async () => {
    const lead = await leads.createLead(db, owner, {
      fullName: "منة التجربة",
      phone: "01050000002",
      source: "facebook",
    });
    const tr = await trials.createTrial(db, owner, { trialType: "day_1", leadId: lead.id });
    await trials.convertTrial(db, owner, { trialId: tr.id });
    await expect(
      trials.convertTrial(db, owner, { trialId: tr.id }),
    ).rejects.toMatchObject({ messageKey: "errors.trialAlreadyConverted" });
  });

  it("errors when converting to a new member without a name", async () => {
    const tr = await trials.createTrial(db, owner, { trialType: "day_1", phone: null });
    await expect(
      trials.convertTrial(db, owner, { trialId: tr.id }),
    ).rejects.toMatchObject({ messageKey: "errors.trialNameRequired" });
  });
});
