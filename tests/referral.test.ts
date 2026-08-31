import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  createReferral,
  convertReferral,
  cancelReferral,
  getReferralStats,
  listTopReferrers,
  listReferralRewards,
  updateReferralSettings,
  getReferralSettings,
  getMemberReferralCode,
  listReferrals,
} from "@/core/services/referral.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;

async function member(name = "عضو", phone?: string) {
  return createMember(db, owner, { fullName: name, ...(phone ? { phone } : {}) });
}

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "الأنور",
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
});

describe("referral: create + list", () => {
  it("creates a pending referral and assigns the referrer a referral code", async () => {
    const referrer = await member("المحيل", "01011111111");
    const before = getMemberReferralCode(db, owner, referrer.id);
    const created = createReferral(db, owner, {
      referrerMemberId: referrer.id,
      referredName: "المحال إليه",
      referredPhone: "01022222222",
    });
    expect(created.status).toBe("pending");
    expect(created.referrerId).toBe(referrer.id);
    expect(created.referralCode).toBe(before);
    const list = listReferrals(db, owner, { referrerId: referrer.id });
    expect(list.total).toBe(1);
  });

  it("rejects a blank referred name", async () => {
    const referrer = await member("المحيل");
    expect(() =>
      createReferral(db, owner, { referrerMemberId: referrer.id, referredName: " " }),
    ).toThrow();
  });

  it("self-referral via matching phone is rejected", async () => {
    const referrer = await member("المحيل", "01011111111");
    expect(() =>
      createReferral(db, owner, {
        referrerMemberId: referrer.id,
        referredName: "نفسي",
        referredPhone: "01011111111",
      }),
    ).toThrow();
  });
});

describe("referral: conversion grants reward", () => {
  it("converts a pending referral to joined and records a granted reward", async () => {
    const referrer = await member("المحيل", "01011111111");
    const referred = await member("العضو الجديد", "01033333333");
    const referral = createReferral(db, owner, {
      referrerMemberId: referrer.id,
      referredName: referred.fullName,
    });
    const converted = convertReferral(db, owner, referral.id, referred.id);
    expect(converted.status).toBe("joined");
    expect(converted.referredMemberId).toBe(referred.id);
    expect(converted.convertedAt).toBeTruthy();

    const rewards = listReferralRewards(db, owner, referrer.id);
    expect(rewards).toHaveLength(1);
    expect(rewards[0].status).toBe("granted");
    expect(rewards[0].rewardValue).toBe(getReferralSettings(db, owner).rewardValue);
  });

  it("blocks duplicate reward when the member is already a joined referral", async () => {
    const referrer = await member("المحيل", "01011111111");
    const referred = await member("العضو", "01033333333");
    const r1 = createReferral(db, owner, { referrerMemberId: referrer.id, referredName: "أحمد" });
    convertReferral(db, owner, r1.id, referred.id);
    const r2 = createReferral(db, owner, { referrerMemberId: referrer.id, referredName: "بيتر" });
    expect(() => convertReferral(db, owner, r2.id, referred.id)).toThrow();
  });

  it("refuses to convert a referral that is already processed", async () => {
    const referrer = await member("المحيل");
    const referred = await member("العضو");
    const referral = createReferral(db, owner, { referrerMemberId: referrer.id, referredName: "أحمد" });
    convertReferral(db, owner, referral.id, referred.id);
    expect(() => convertReferral(db, owner, referral.id, referred.id)).toThrow();
  });
});

describe("referral: cancellation", () => {
  it("cancels a pending referral only", async () => {
    const referrer = await member("المحيل");
    const referral = createReferral(db, owner, { referrerMemberId: referrer.id, referredName: "أحمد" });
    const cancelled = cancelReferral(db, owner, referral.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("refuses to cancel a joined referral", async () => {
    const referrer = await member("المحيل");
    const referred = await member("العضو");
    const referral = createReferral(db, owner, { referrerMemberId: referrer.id, referredName: "أحمد" });
    convertReferral(db, owner, referral.id, referred.id);
    expect(() => cancelReferral(db, owner, referral.id)).toThrow();
  });
});

describe("referral: settings + stats", () => {
  it("allows configuring reward settings as manager", async () => {
    const s = updateReferralSettings(db, manager, { rewardType: "credit", rewardValue: 5000 });
    expect(s.rewardType).toBe("credit");
    expect(s.rewardValue).toBe(5000);
  });

  it("computes stats and top referrers", async () => {
    const a = await member("المحيل أ");
    const b = await member("المحيل ب");
    const ra1 = createReferral(db, owner, { referrerMemberId: a.id, referredName: "أحمد1" });
    const ra2 = createReferral(db, owner, { referrerMemberId: a.id, referredName: "أحمد2" });
    createReferral(db, owner, { referrerMemberId: b.id, referredName: "بيتر1" });
    const referred = await member("المنضم");
    convertReferral(db, owner, ra1.id, referred.id);
    cancelReferral(db, owner, ra2.id);

    const stats = getReferralStats(db, owner);
    expect(stats.totalReferrals).toBe(3);
    expect(stats.convertedReferrals).toBe(1);
    expect(stats.pendingReferrals).toBe(1);
    expect(stats.cancelledReferrals).toBe(1);
    expect(stats.totalRewardsGranted).toBe(1);

    const top = listTopReferrers(db, owner);
    expect(top[0].referrerId).toBe(a.id);
    expect(top[0].convertedReferrals).toBe(1);
  });

  it("scopes stats to a single referrer", async () => {
    const a = await member("المحيل أ");
    const b = await member("المحيل ب");
    createReferral(db, owner, { referrerMemberId: a.id, referredName: "أحمد1" });
    createReferral(db, owner, { referrerMemberId: b.id, referredName: "بيتر1" });
    const stats = getReferralStats(db, owner, a.id);
    expect(stats.totalReferrals).toBe(1);
  });
});

describe("referral: permissions", () => {
  it("denies referral creation without referrals.manage", async () => {
    const referrer = await member("المحيل");
    expect(() =>
      createReferral(db, reception, { referrerMemberId: referrer.id, referredName: "أحمد" }),
    ).toThrow();
  });

  it("denies viewing stats without referrals.view", async () => {
    const trainerUser = await createUser(db, owner, {
      username: "trainer",
      password: "Trainer@2026",
      fullName: "المدرب",
      roleId: "trainer",
    });
    const trainer = buildActor(trainerUser);
    expect(() => getReferralStats(db, trainer)).toThrow();
  });
});
