import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { assignCardByBarcode, registerCard } from "@/core/services/cards.service";
import {
  createPortalToken,
  getLiveGymOccupancy,
  getMemberPortalProfile,
  getMemberPortalUrl,
  verifyPortalToken,
} from "@/core/services/member-portal.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";
import { todayKey } from "@/core/dates";
import {
  SETTING_KEYS,
  getOccupancyDurationMinutes,
  updateSetting,
} from "@/core/services/settings.service";

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

describe("Member Portal & Live Gym Occupancy", () => {
  it("generates and verifies secure portal tokens", async () => {
    const member = await createMember(db, owner, {
      fullName: "أحمد محمود",
      phone: "01000000001",
      gender: "male",
    });

    const token = createPortalToken(db, member.id, member.memberCode);
    expect(token).toBeTruthy();
    expect(token).toContain(".");

    const verified = verifyPortalToken(db, token);
    expect(verified.memberId).toBe(member.id);
    expect(verified.memberCode).toBe(member.memberCode);

    // Tampered token fails
    const tampered = token + "xyz";
    expect(() => verifyPortalToken(db, tampered)).toThrow();
  });

  it("calculates live occupancy accurately and returns it in portal profile", async () => {
    // 1. Initial live occupancy should be 0
    const initialLive = getLiveGymOccupancy(db);
    expect(initialLive.occupancyNow).toBe(0);
    expect(initialLive.gymName).toBe("Yassen Mohamed Kotb | 01288536381");

    // 2. Register member and card and subscription
    const member = await createMember(db, owner, {
      fullName: "محمد صلاح",
      phone: "01000000002",
      gender: "male",
    });

    const plan = await createPlan(db, owner, {
      name: "اشتراك شهري",
      durationDays: 30,
      price: 500,
    });

    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: todayKey(),
    });

    const card = await registerCard(db, owner, {
      barcodeValue: "CRD-998877",
      kind: "physical",
    });
    await assignCardByBarcode(db, owner, {
      barcodeValue: card.barcodeValue,
      memberId: member.id,
    });

    // 3. Member checks in
    const checkin = await recordCheckIn(db, owner, { barcode: "CRD-998877" });
    expect(checkin.kind).toBe("success");

    // 4. Live occupancy must now be 1
    const occupancyAfterCheckin = getLiveGymOccupancy(db);
    expect(occupancyAfterCheckin.occupancyNow).toBe(1);

    // 5. Unauthenticated request without token must fail
    expect(() => getMemberPortalProfile(db, { code: member.memberCode })).toThrow(/errors\.portalTokenRequired/);

    const token = createPortalToken(db, member.id, member.memberCode);
    const profile = getMemberPortalProfile(db, { token });
    expect(profile.member.fullName).toBe("محمد صلاح");
    expect(profile.liveOccupancyNow).toBe(1);
    expect(profile.subscription).not.toBeNull();
    expect(profile.subscription?.planName).toBe("اشتراك شهري");
    expect(profile.attendance.length).toBe(1);

    // 6. Fetch member portal URL
    const portalUrlData = getMemberPortalUrl(db, owner, member.id, "http://127.0.0.1:8890");
    expect(portalUrlData.url).toContain("/#/portal?");
    expect(portalUrlData.token).toBeTruthy();
    expect(portalUrlData.liveOccupancy).toBe(1);

    // 7. Verify portal profile retrieval via signed token
    const tokenProfile = getMemberPortalProfile(db, { token: portalUrlData.token });
    expect(tokenProfile.member.id).toBe(member.id);
    expect(tokenProfile.liveOccupancyNow).toBe(1);
  });

  it("respects custom occupancy duration setting from settings", async () => {
    expect(getOccupancyDurationMinutes(db)).toBe(120);

    // Update setting to 60 minutes
    await updateSetting(db, owner, SETTING_KEYS.occupancyDurationMinutes, "60");
    expect(getOccupancyDurationMinutes(db)).toBe(60);

    // Rejects out of range
    await expect(updateSetting(db, owner, SETTING_KEYS.occupancyDurationMinutes, "5")).rejects.toThrow();
  });
});
