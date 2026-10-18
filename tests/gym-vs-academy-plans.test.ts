import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan, listPlans, getPlan, updatePlan } from "@/core/services/plans.service";
import { createTrainer, listTrainers } from "@/core/services/trainers.service";
import { listSessions } from "@/core/services/classes.service";
import {
  createSubscription,
  listMemberSubscriptions,
} from "@/core/services/subscriptions.service";
import { addDaysKey, todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "GymGate",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
});

describe("Gym vs Academy Plan Separation (Concurrent Subscriptions)", () => {
  it("allows creating plans with category gym and academy, and filters them", async () => {
    const gymPlan = await createPlan(db, owner, {
      name: "باقة الجيم الشهرية",
      durationDays: 30,
      price: 500,
      kind: "time",
      category: "gym",
    });
    expect(gymPlan.category).toBe("gym");

    const academyPlan = await createPlan(db, owner, {
      name: "أكاديمية الكاراتيه",
      durationDays: 30,
      price: 600,
      kind: "sessions",
      sessionsCount: 12,
      category: "academy",
    });
    expect(academyPlan.category).toBe("academy");

    const allPlans = await listPlans(db, owner, false);
    expect(allPlans.length).toBeGreaterThanOrEqual(2);

    const onlyGym = await listPlans(db, owner, false, "gym");
    expect(onlyGym.some((p) => p.id === gymPlan.id)).toBe(true);
    expect(onlyGym.some((p) => p.id === academyPlan.id)).toBe(false);

    const onlyAcademy = await listPlans(db, owner, false, "academy");
    expect(onlyAcademy.some((p) => p.id === academyPlan.id)).toBe(true);
    expect(onlyAcademy.some((p) => p.id === gymPlan.id)).toBe(false);
  });

  it("permits simultaneous active Gym and Academy subscriptions on identical dates without conflict", async () => {
    const member = await createMember(db, owner, {
      fullName: "أحمد علي",
      phone: "01000000001",
      gender: "male",
    });

    const gymPlan = await createPlan(db, owner, {
      name: "اشتراك الجيم 30 يوم",
      durationDays: 30,
      price: 450,
      kind: "time",
      category: "gym",
    });

    const karatePlan = await createPlan(db, owner, {
      name: "أكاديمية كاراتيه - 12 حصة",
      durationDays: 30,
      price: 700,
      kind: "sessions",
      sessionsCount: 12,
      category: "academy",
    });

    const today = todayKey();

    // 1. Create Gym Subscription
    const gymSub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: gymPlan.id,
      startDate: today,
    });
    expect(gymSub.id).toBeDefined();
    expect(gymSub.category).toBe("gym");

    // 2. Attempt to create another Gym Subscription on the same dates -> must fail with overlap
    await expect(
      createSubscription(db, owner, {
        memberId: member.id,
        planId: gymPlan.id,
        startDate: today,
      }),
    ).rejects.toMatchObject({
      messageKey: "errors.subscriptionOverlap",
    });

    // 3. Create Academy Subscription on the EXACT SAME DATES -> must succeed!
    const academySub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: karatePlan.id,
      startDate: today,
    });
    expect(academySub.id).toBeDefined();
    expect(academySub.category).toBe("academy");

    // Verify both are present and active
    const subs = await listMemberSubscriptions(db, owner, member.id);
    expect(subs.length).toBe(2);
    expect(subs.filter((s) => s.status === "active").length).toBe(2);
    expect(subs.some((s) => s.category === "gym")).toBe(true);
    expect(subs.some((s) => s.category === "academy")).toBe(true);

    // 4. Attempt to create a duplicate of the same Karate Academy Subscription on overlapping dates -> must fail
    await expect(
      createSubscription(db, owner, {
        memberId: member.id,
        planId: karatePlan.id,
        startDate: today,
      }),
    ).rejects.toMatchObject({
      messageKey: "errors.subscriptionOverlap",
    });

    // 5. Create a DIFFERENT Academy subscription (e.g. Swimming) on the same dates -> must succeed!
    const swimmingPlan = await createPlan(db, owner, {
      name: "أكاديمية السباحة",
      durationDays: 30,
      price: 800,
      kind: "sessions",
      sessionsCount: 8,
      category: "academy",
    });

    const swimSub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: swimmingPlan.id,
      startDate: today,
    });
    expect(swimSub.id).toBeDefined();
    expect(swimSub.category).toBe("academy");

    const allMemberSubs = await listMemberSubscriptions(db, owner, member.id);
    expect(allMemberSubs.length).toBe(3);
  });

  it("automatically materializes class and sessions when creating an academy plan with schedule and trainer", async () => {
    const trainer = await createTrainer(db, owner, {
      fullName: "كابتن محمود",
      phone: "01099887766",
    });

    const academyPlan = await createPlan(db, owner, {
      name: "أكاديمية الملاكمة للمبتدئين",
      durationDays: 30,
      price: 650,
      kind: "sessions",
      sessionsCount: 8,
      category: "academy",
      trainerId: trainer.id,
      capacity: 12,
      scheduleSlots: [
        { dayOfWeek: 0, startTime: "17:00", endTime: "18:00" },
        { dayOfWeek: 2, startTime: "17:00", endTime: "18:00" },
      ],
    });

    expect(academyPlan.trainerId).toBe(trainer.id);
    expect(academyPlan.trainerName).toBe("كابتن محمود");
    expect(academyPlan.classId).toBeDefined();

    // Verify trainer has assigned academy
    const trainers = await listTrainers(db, owner, {});
    const tr = trainers.find((t) => t.id === trainer.id);
    expect(tr?.assignedAcademies).toContain("أكاديمية الملاكمة للمبتدئين");

    // Verify class sessions materialized
    const sessions = await listSessions(db, owner, {
      classId: academyPlan.classId!,
      status: "all",
    });
    expect(sessions.length).toBeGreaterThanOrEqual(4);

    // Verify getPlan works
    const fetchedPlan = await getPlan(db, owner, academyPlan.id);
    expect(fetchedPlan?.name).toBe("أكاديمية الملاكمة للمبتدئين");
    expect(fetchedPlan?.trainerName).toBe("كابتن محمود");
    expect(fetchedPlan?.scheduleSlots?.length).toBe(2);

    // Update plan with new capacity and schedule
    await updatePlan(db, owner, academyPlan.id, {
      capacity: 15,
      scheduleSlots: [
        { dayOfWeek: 1, startTime: "19:00", endTime: "20:00" },
      ],
    });

    const updatedPlan = await getPlan(db, owner, academyPlan.id);
    expect(updatedPlan?.capacity).toBe(15);
    expect(updatedPlan?.scheduleSlots?.length).toBe(1);
  });
});
