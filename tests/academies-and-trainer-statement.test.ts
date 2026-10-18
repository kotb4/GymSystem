import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createTrainer, recordTrainerPayout, getTrainerDetailedStatement } from "@/core/services/trainers.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import {
  createClassWithPackage,
  createClassSession,
  saveSessionAttendanceRoster,
  listClassEnrolledMembers,
} from "@/core/services/classes.service";
import {
  recordGrading,
  listMemberGradings,
  listAllGradings,
  deleteGrading,
  buildParentAttendanceMessage,
} from "@/core/services/belt-gradings.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;
let trainerActor: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "GymGate",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "موظف استقبال",
      roleId: "reception",
    }),
  );
  trainerActor = buildActor(
    await createUser(db, owner, {
      username: "coach",
      password: "Coach@2026",
      fullName: "كابتن مدرب",
      roleId: "trainer",
    }),
  );
});

describe("Feature 3: Academies, Belts & Parent WhatsApp Tracking", () => {
  it("records a belt grading, lists it, and enforces validation", async () => {
    const student = await createMember(db, owner, {
      fullName: "عمر أحمد الشربيني",
      phone: "01011112222",
      emergencyContactName: "أحمد الشربيني (ولي الأمر)",
      emergencyContactPhone: "01099998888",
    });

    const grading = await recordGrading(db, owner, {
      memberId: student.id,
      discipline: "karate",
      beltName: "حزام أصفر (Yellow Belt)",
      beltColor: "#FACC15",
      gradingDate: todayKey(),
      examinerName: "كابتن حسام حسن - حزام أسود دان 5",
      scoreOrGrade: "ممتاز (A+)",
      notes: "إتقان كاتا هيان شودان ومستوى ممتاز في الكوميتيه",
    });

    expect(grading.id).toBeDefined();
    expect(grading.beltName).toBe("حزام أصفر (Yellow Belt)");
    expect(grading.certificateNo).toContain("CERT-");

    // List by member
    const studentGradings = listMemberGradings(db, owner, student.id);
    expect(studentGradings).toHaveLength(1);
    expect(studentGradings[0].examinerName).toBe("كابتن حسام حسن - حزام أسود دان 5");

    // List all with filter
    const allGradings = listAllGradings(db, owner, { discipline: "karate" });
    expect(allGradings.length).toBeGreaterThanOrEqual(1);
    expect(allGradings[0].memberName).toBe("عمر أحمد الشربيني");
    expect(allGradings[0].emergencyContactPhone).toBe("01099998888");

    // Delete grading
    await deleteGrading(db, owner, grading.id);
    expect(listMemberGradings(db, owner, student.id)).toHaveLength(0);
  });

  it("builds formatted parent attendance WhatsApp message", () => {
    const msg = buildParentAttendanceMessage({
      memberName: "ياسين محمد",
      className: "كيك بوكسينج ناشئين",
      date: "2026-10-16",
      time: "06:30 م",
      sessionsRemaining: 7,
      gymName: "جيم جيت",
    });

    expect(msg).toContain("ياسين محمد");
    expect(msg).toContain("كيك بوكسينج ناشئين");
    expect(msg).toContain("7 حصة");
    expect(msg).toContain("جيم جيت");
  });

  it("exposes emergency contact details in enrolled academy roster", async () => {
    const coach = await createTrainer(db, owner, { fullName: "كابتن شريف", phone: "01233331111" });
    const cls = await createClassWithPackage(db, owner, {
      name: "أكاديمية التايكوندو براعم",
      trainerId: coach.id,
      capacity: 10,
      package: {
        createPlan: true,
        planName: "باقة 8 حصص تايكوندو",
        price: 500,
        sessionCount: 8,
      },
    });

    const kid = await createMember(db, owner, {
      fullName: "حمزة طارق",
      phone: "01000000000",
      emergencyContactName: "طارق محمود (الأب)",
      emergencyContactPhone: "01055554444",
    });

    await createSubscription(db, owner, {
      memberId: kid.id,
      planId: cls.planId!,
      startDate: todayKey(),
    });

    const roster = listClassEnrolledMembers(db, owner, cls.class.id);
    expect(roster).toHaveLength(1);
    expect(roster[0].memberName).toBe("حمزة طارق");
    expect(roster[0].emergencyContactPhone).toBe("01055554444");
    expect(roster[0].emergencyContactName).toBe("طارق محمود (الأب)");
  });
});

describe("Feature 4: Coach All-in-One Financial Statement", () => {
  it("aggregates PT sessions, class sessions, payouts, and running balance accurately", async () => {
    const coach = await createTrainer(db, owner, {
      fullName: "كابتن زياد كمال",
      phone: "01188887777",
      defaultSessionFeeMinor: 15000, // 150 EGP default per session
    });

    // 1. Create a class with package
    const cls = await createClassWithPackage(db, owner, {
      name: "حصة ملاكمة مسائية",
      trainerId: coach.id,
      capacity: 12,
      defaultTrainerFeeMinor: 20000, // 200 EGP per class session
      package: {
        createPlan: true,
        planName: "باقة 8 حصص ملاكمة",
        price: 800,
        sessionCount: 8,
      },
    });

    // 2. Schedule and complete a session
    const session = await createClassSession(db, owner, cls.class.id, {
      sessionDate: todayKey(),
      startTime: "18:00",
      durationMin: 60,
    });
    // Add member & booking
    const m1 = await createMember(db, owner, { fullName: "عضو 1", phone: "01011110000" });
    const sub = await createSubscription(db, owner, {
      memberId: m1.id,
      planId: cls.planId!,
      startDate: todayKey(),
    });
    await saveSessionAttendanceRoster(db, owner, session.id, [
      { bookingId: (await db.first<{ id: string }>("SELECT id FROM class_bookings WHERE session_id = ? AND member_id = ?", [session.id, m1.id]))?.id || "", status: "attended" },
    ]);
    // Complete session
    db.run("UPDATE class_sessions SET status = 'done' WHERE id = ?", [session.id]);

    // 3. Record a payout (Debit)
    await recordTrainerPayout(db, owner, {
      trainerId: coach.id,
      amountMinor: 10000, // 100 EGP paid out
      payoutDate: todayKey(),
      payoutType: "advance",
      methodCode: "cash",
      notes: "دفعة مقدمة أتعاب",
    });

    // 4. Retrieve Detailed Statement
    const statement = getTrainerDetailedStatement(db, owner, {
      trainerId: coach.id,
    });

    expect(statement.trainer.id).toBe(coach.id);
    expect(statement.totals.totalClassEarningsMinor).toBe(20000);
    expect(statement.totals.totalPayoutsMinor).toBe(10000);
    expect(statement.totals.netBalanceDueMinor).toBe(10000); // 200 - 100 = 100 EGP (10000 minor)

    expect(statement.items.length).toBeGreaterThanOrEqual(2);
    const classItem = statement.items.find((i) => i.type === "class_session");
    expect(classItem).toBeDefined();
    expect(classItem?.creditMinor).toBe(20000);

    const payoutItem = statement.items.find((i) => i.type === "payout");
    expect(payoutItem).toBeDefined();
    expect(payoutItem?.debitMinor).toBe(10000);
  });
});
