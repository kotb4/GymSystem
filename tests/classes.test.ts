import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import {
  createClass,
  listClasses,
  updateClass,
  createClassSession,
  listSessions,
  cancelClassSession,
  completeClassSession,
  bookMember,
  cancelBooking,
  setBookingStatus,
  createClassRecurrence,
  listClassRecurrences,
  generateRecurrenceWeeks,
  deactivateClassRecurrence,
  createClassWithPackage,
  saveSessionAttendanceRoster,
  payTrainerForSession,
  getClassProfitsReport,
  getTrainerProfile,
  listClassEnrolledMembers,
  recordDirectClassAttendance,
  recordBatchClassAttendance,
  parseScheduleSlots,
  formatScheduleText,
} from "@/core/services/classes.service";
import {
  createTrainer,
  updateTrainer,
  recordTrainerPayout,
  listTrainerPayouts,
  deleteTrainerPayout,
  getTrainerFinancialSummary,
} from "@/core/services/trainers.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

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
      fullName: "استقبال",
      roleId: "reception",
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

async function makeMember(name = "عضو كلاس") {
  return createMember(db, owner, {
    fullName: name,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function sessionsPlan() {
  return createPlan(db, owner, {
    name: `جلسات-${Math.random().toString(36).slice(2, 6)}`,
    durationDays: 30,
    price: 200,
    kind: "sessions",
    sessionsCount: 5,
  });
}

describe("classes CRUD", () => {
  it("creates, lists and updates a class", async () => {
    const cls = await createClass(db, owner, { name: "يوجا", capacity: 20, consumesSession: true });
    expect(cls.name).toBe("يوجا");
    expect(cls.consumesSession).toBe(true);
    expect(cls.capacity).toBe(20);

    const list = listClasses(db, owner);
    expect(list.length).toBeGreaterThanOrEqual(1);

    const updated = await updateClass(db, owner, cls.id, { capacity: 30 });
    expect(updated.capacity).toBe(30);
  });

  it("creates, lists and updates a combat class with discipline, category and level", async () => {
    const cls = await createClass(db, owner, {
      name: "كيك بوكسينج ناشئين",
      discipline: "kickboxing",
      category: "teens",
      level: "beginner",
      location: "بساط تاتامي",
      capacity: 15,
      consumesSession: true,
    });
    expect(cls.name).toBe("كيك بوكسينج ناشئين");
    expect(cls.discipline).toBe("kickboxing");
    expect(cls.category).toBe("teens");
    expect(cls.level).toBe("beginner");
    expect(cls.location).toBe("بساط تاتامي");

    // Filter by discipline
    const kickboxingList = listClasses(db, owner, { discipline: "kickboxing" });
    expect(kickboxingList.length).toBe(1);
    expect(kickboxingList[0].id).toBe(cls.id);

    const mmaList = listClasses(db, owner, { discipline: "mma" });
    expect(mmaList.length).toBe(0);

    const updated = await updateClass(db, owner, cls.id, {
      discipline: "muay_thai",
      level: "intermediate",
    });
    expect(updated.discipline).toBe("muay_thai");
    expect(updated.level).toBe("intermediate");
  });

  it("denies trainer from creating classes", async () => {
    await expect(createClass(db, trainer, { name: "ممنوع", capacity: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("class sessions", () => {
  it("creates and lists sessions", async () => {
    const cls = await createClass(db, owner, { name: "كارديو", capacity: 15 });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "10:00",
      durationMin: 60,
    });
    expect(session.classId).toBe(cls.id);
    expect(session.status).toBe("scheduled");

    const list = listSessions(db, owner, { classId: cls.id });
    expect(list.length).toBe(1);
  });

  it("cancels and completes sessions", async () => {
    const cls = await createClass(db, owner, { name: "ק鞭ك", capacity: 15 });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "11:00",
    });
    await cancelClassSession(db, owner, session.id, "إلغاء");
    let refreshed = listSessions(db, owner, { classId: cls.id, status: "all" });
    expect(refreshed[0].status).toBe("cancelled");

    const session2 = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "12:00",
    });
    const done = await completeClassSession(db, owner, session2.id);
    expect(done.status).toBe("done");
  });
});

describe("bookings", () => {
  it("books a member and cancels", async () => {
    const cls = await createClass(db, owner, { name: "بوكسينغ", capacity: 10 });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "14:00",
    });
    const m = await makeMember();
    const booking = await bookMember(db, owner, { sessionId: session.id, memberId: m.id });
    expect(booking.status).toBe("booked");

    await cancelBooking(db, owner, booking.id);
  });

  it("enforces capacity limit", async () => {
    const cls = await createClass(db, owner, { name: "سيكشن صغير", capacity: 1 });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "15:00",
    });
    const m1 = await makeMember("أول");
    const m2 = await makeMember("ثاني");

    await bookMember(db, owner, { sessionId: session.id, memberId: m1.id });
    await expect(
      bookMember(db, owner, { sessionId: session.id, memberId: m2.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows overrideCapacity with manage permission", async () => {
    const cls = await createClass(db, owner, { name: "أكمل", capacity: 1 });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "16:00",
    });
    const m1 = await makeMember("أول");
    const m2 = await makeMember("ثاني");

    await bookMember(db, owner, { sessionId: session.id, memberId: m1.id });
    const booking2 = await bookMember(db, owner, {
      sessionId: session.id,
      memberId: m2.id,
      overrideCapacity: true,
    });
    expect(booking2.status).toBe("booked");
  });

  it("rejects duplicate booking", async () => {
    const cls = await createClass(db, owner, { name: "تكرار", capacity: 10 });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "17:00",
    });
    const m = await makeMember();
    await bookMember(db, owner, { sessionId: session.id, memberId: m.id });
    await expect(
      bookMember(db, owner, { sessionId: session.id, memberId: m.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("session consumption", () => {
  it("consumes a session when marked attended", async () => {
    const plan = await sessionsPlan();
    const m = await makeMember("_SESSIONS_MEMBER");
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });

    const subBefore = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(Number(subBefore!.sessions_used)).toBe(0);

    const cls = await createClass(db, owner, { name: "استهلاك", capacity: 10, consumesSession: true });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "18:00",
    });
    const booking = await bookMember(db, owner, { sessionId: session.id, memberId: m.id });
    const attended = await setBookingStatus(db, owner, booking.id, "attended");
    expect(attended.status).toBe("attended");
    expect(attended.consumedSubscriptionId).toBe(sub.id);

    const subAfter = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(Number(subAfter!.sessions_used)).toBe(1);
  });
});

describe("class permission denials", () => {
  it("trainer only has classes.view", async () => {
    expect(() => listClasses(db, trainer)).not.toThrow();
    await expect(createClass(db, trainer, { name: "x", capacity: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("class recurrences", () => {
  // 2027-01-04 is a Monday; days 1 (Mon) and 4 (Thu) make this deterministic.
  const START = "2027-01-04";

  it("creates a recurrence and materializes sessions for the selected days", async () => {
    const cls = await createClass(db, owner, { name: "MMA", capacity: 10 });
    const res = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1, 4],
      startDate: START,
      startTime: "18:00",
      durationMin: 90,
      weeks: 2,
    });
    expect(res.created).toBe(4);
    expect(res.skipped).toBe(0);
    expect(res.recurrence.capacity).toBeNull();
    expect(res.recurrence.nextScheduledDate).toBe(START);

    const sessions = listSessions(db, owner, { classId: cls.id, status: "all" });
    expect(sessions).toHaveLength(4);
    for (const s of sessions) {
      expect(s.capacity).toBe(10);
      expect(s.durationMin).toBe(90);
      expect(s.startTime).toBe("18:00");
    }
  });

  it("falls back to class capacity unless overridden", async () => {
    const cls = await createClass(db, owner, { name: "كراتيه", capacity: 8 });
    const capped = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1],
      startDate: "2027-01-04",
      startTime: "18:00",
      capacity: 3,
      weeks: 1,
    });
    expect(capped.created).toBe(1);
    const session = listSessions(db, owner, { classId: cls.id, status: "all" })[0];
    expect(session.capacity).toBe(3);
  });

  it("skips dates already occupied by a session", async () => {
    const cls = await createClass(db, owner, { name: "بوكس", capacity: 10 });
    await createClassSession(db, owner, cls.id, { sessionDate: START, startTime: "18:00", durationMin: 60 });
    const res = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1],
      startDate: START,
      startTime: "18:00",
      weeks: 1,
    });
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("extends an existing recurrence with more weeks", async () => {
    const cls = await createClass(db, owner, { name: "كاراتي", capacity: 10 });
    const res = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1, 4],
      startDate: START,
      startTime: "18:00",
      weeks: 2,
    });
    expect(res.created).toBe(4);
    const extended = await generateRecurrenceWeeks(db, owner, res.recurrence.id, 1);
    expect(extended.created).toBe(2);
    expect(extended.skipped).toBe(0);
    expect(listSessions(db, owner, { classId: cls.id, status: "all" })).toHaveLength(6);
  });

  it("stops generating but keeps existing sessions", async () => {
    const cls = await createClass(db, owner, { name: "جودو", capacity: 10 });
    const res = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1],
      startDate: START,
      startTime: "18:00",
      weeks: 2,
    });
    await deactivateClassRecurrence(db, owner, res.recurrence.id);
    expect(listClassRecurrences(db, owner, { activeOnly: true })).toHaveLength(0);
    expect(listSessions(db, owner, { classId: cls.id, status: "all" })).toHaveLength(2);
    await expect(generateRecurrenceWeeks(db, owner, res.recurrence.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("validates input and permissions", async () => {
    const cls = await createClass(db, owner, { name: "تايكواندو", capacity: 10 });
    await expect(
      createClassRecurrence(db, owner, { classId: cls.id, daysOfWeek: [], startDate: START, startTime: "18:00" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createClassRecurrence(db, owner, { classId: cls.id, daysOfWeek: [1], startDate: START, startTime: "30:00" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createClassRecurrence(db, trainer, { classId: cls.id, daysOfWeek: [1], startDate: START, startTime: "18:00" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies trainer from managing recurrences", async () => {
    const cls = await createClass(db, owner, { name: "سباحة", capacity: 10 });
    const res = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1],
      startDate: START,
      startTime: "18:00",
      weeks: 1,
    });
    expect(() => listClassRecurrences(db, trainer)).not.toThrow();
    await expect(generateRecurrenceWeeks(db, trainer, res.recurrence.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deactivateClassRecurrence(db, trainer, res.recurrence.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("advanced class academy, roster attendance, profits & coach payouts", () => {
  it("creates class with all-in-one package and recurrence", async () => {
    const coach = await createTrainer(db, owner, {
      fullName: "كابتن أحمد",
      phone: "01099998888",
      defaultSessionFeeMinor: 15000,
    });

    const res = await createClassWithPackage(db, owner, {
      name: "أكاديمية الكيك بوكسينج",
      trainerId: coach.id,
      capacity: 12,
      defaultTrainerFeeMinor: 15000,
      package: {
        createPlan: true,
        planName: "باقة 12 حصة كيك بوكسينج",
        price: 600, // 600 EGP
        sessionCount: 12,
        durationDays: 30,
      },
      schedule: {
        daysOfWeek: [1, 3],
        startDate: "2027-02-01",
        startTime: "19:00",
        durationMin: 60,
        weeks: 2,
      },
    });

    expect(res.class.name).toBe("أكاديمية الكيك بوكسينج");
    expect(res.class.planId).toBeTruthy();
    expect(res.planId).toBeTruthy();
    const createdPlanRow = db.first<{ category: string; price: number }>(
      "SELECT category, price FROM membership_plans WHERE id = ?",
      [res.planId!],
    );
    expect(createdPlanRow?.category).toBe("academy");
    expect(createdPlanRow?.price).toBe(600);
    expect(res.recurrence).toBeDefined();

    const sessions = listSessions(db, owner, { classId: res.class.id, status: "all" });
    expect(sessions).toHaveLength(4);
    expect(sessions[0].trainerFeeMinor).toBe(15000);
  });

  it("saves attendance roster and consumes session from trainee subscription", async () => {
    const coach = await createTrainer(db, owner, { fullName: "كابتن سيف", phone: "01122223333" });
    const clsRes = await createClassWithPackage(db, owner, {
      name: "حصة ملاكمة",
      trainerId: coach.id,
      capacity: 10,
      defaultTrainerFeeMinor: 10000,
      package: {
        createPlan: true,
        planName: "باقة ملاكمة 8 حصص",
        price: 400,
        sessionCount: 8,
        durationDays: 30,
      },
    });

    const mem1 = await createMember(db, owner, { fullName: "مشترك 1", phone: "01011111111" });
    const mem2 = await createMember(db, owner, { fullName: "مشترك 2", phone: "01022222222" });

    // Subscribe mem1 to the class plan
    const sub1 = await createSubscription(db, owner, {
      memberId: mem1.id,
      planId: clsRes.planId!,
      startDate: todayKey(),
    });

    // Create session
    const session = await createClassSession(db, owner, clsRes.class.id, {
      sessionDate: todayKey(),
      startTime: "17:00",
      durationMin: 60,
    });

    // Book members
    const b1 = await bookMember(db, owner, { sessionId: session.id, memberId: mem1.id });
    const b2 = await bookMember(db, owner, { sessionId: session.id, memberId: mem2.id });

    // Save roster: mark b1 attended, b2 no_show
    const rosterRes = await saveSessionAttendanceRoster(db, owner, session.id, [
      { bookingId: b1.id, status: "attended" },
      { bookingId: b2.id, status: "no_show" },
    ]);

    expect(rosterRes.savedCount).toBe(2);
    expect(rosterRes.attendedCount).toBe(1);

    // Verify sub1 has consumed 1 session
    const sub1After = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
      [sub1.id],
    );
    expect(Number(sub1After!.sessions_used)).toBe(1);

    // Verify profits report
    const profits = getClassProfitsReport(db, owner, { classId: clsRes.class.id });
    expect(profits).toHaveLength(1);
    expect(profits[0].attendedCount).toBe(1);
    expect(profits[0].grossRevenueMinor).toBe(5000); // 40000 / 8 = 5000
    expect(profits[0].trainerFeeMinor).toBe(10000);
    expect(profits[0].netProfitMinor).toBe(-5000); // 5000 - 10000
  });

  it("pays trainer for session, marks session paid and generates expense", async () => {
    const coach = await createTrainer(db, owner, { fullName: "كابتن رامي", phone: "01233334444" });
    const cls = await createClass(db, owner, {
      name: "حصة خاصة",
      trainerId: coach.id,
      capacity: 10,
      defaultTrainerFeeMinor: 20000,
    });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: todayKey(),
      startTime: "18:00",
      durationMin: 60,
    });

    // Pay trainer
    const payRes = await payTrainerForSession(db, owner, {
      sessionId: session.id,
      amountMinor: 20000,
      methodCode: "cash",
      notes: "أتعاب كابتن رامي",
    });

    expect(payRes.session).toBeDefined();
    expect(payRes.expenseId).toBeTruthy();

    const sessDb = db.first<{ paid_to_trainer: number; expense_id: string }>(
      "SELECT paid_to_trainer, expense_id FROM class_sessions WHERE id = ?",
      [session.id],
    );
    expect(sessDb?.paid_to_trainer).toBe(1);
    expect(sessDb?.expense_id).toBe(payRes.expenseId);

    // Verify trainer profile
    const profile = getTrainerProfile(db, owner, coach.id);
    expect(profile.trainer.fullName).toBe("كابتن رامي");
    expect(profile.completedSessionsCount).toBe(1);
    expect(profile.totalEarningsMinor).toBe(20000);
    expect(profile.pendingEarningsMinor).toBe(0);

    // Second payout throws conflict
    await expect(
      payTrainerForSession(db, owner, { sessionId: session.id, amountMinor: 20000 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("handles detailed schedule slots with day-of-week and custom times", async () => {
    const slots = [
      { dayOfWeek: 0, startTime: "16:00", endTime: "17:30" }, // Sunday
      { dayOfWeek: 2, startTime: "18:00", endTime: "19:00" }, // Tuesday
    ];
    const cls = await createClass(db, owner, {
      name: "كاراتيه أطفال",
      capacity: 15,
      scheduleSlots: slots,
    });

    expect(cls.scheduleSlots).toHaveLength(2);
    expect(cls.scheduleSlots[0].dayOfWeek).toBe(0);
    expect(cls.scheduleSlots[0].startTime).toBe("16:00");
    expect(cls.scheduleSlots[0].endTime).toBe("17:30");

    expect(cls.scheduleText).toContain("الأحد (16:00 - 17:30)");
    expect(cls.scheduleText).toContain("الثلاثاء (18:00 - 19:00)");

    // Update schedule
    const updated = await updateClass(db, owner, cls.id, {
      scheduleSlots: [{ dayOfWeek: 5, startTime: "10:00" }],
    });
    expect(updated.scheduleText).toBe("الجمعة (10:00)");
  });

  it("executes direct class attendance and batch attendance with session deduction", async () => {
    const plan = await createPlan(db, owner, {
      name: "باقة ملاكمة 8 حصص",
      category: "academy",
      kind: "sessions",
      durationDays: 30,
      price: 500,
      sessionsCount: 8,
    });
    const cls = await createClass(db, owner, { name: "ملاكمة", capacity: 20, planId: plan.id });

    const m1 = await createMember(db, owner, { fullName: "مشترك 1", phone: "01011112222" });
    const m2 = await createMember(db, owner, { fullName: "مشترك 2", phone: "01033334444" });

    const sub1 = await createSubscription(db, owner, { memberId: m1.id, planId: plan.id, startDate: todayKey() });
    const sub2 = await createSubscription(db, owner, { memberId: m2.id, planId: plan.id, startDate: todayKey() });

    // List enrolled members
    const enrolled = listClassEnrolledMembers(db, owner, cls.id);
    expect(enrolled).toHaveLength(2);
    expect(enrolled[0].sessionsTotal).toBe(8);
    expect(enrolled[0].sessionsRemaining).toBe(8);

    // Direct check-in member 1
    const res1 = await recordDirectClassAttendance(db, owner, {
      memberId: m1.id,
      classId: cls.id,
      notes: "حضور أول حصة",
    });
    expect(res1.attendanceId).toBeTruthy();
    expect(res1.sessionsRemaining).toBe(7);

    // Batch check-in
    const batchRes = await recordBatchClassAttendance(db, owner, {
      classId: cls.id,
      memberIds: [m1.id, m2.id],
    });
    expect(batchRes.attendedCount).toBe(2);
    expect(batchRes.errors).toHaveLength(0);

    // Deduce class from subscription when classId omitted
    const autoClassRes = await recordDirectClassAttendance(db, owner, {
      memberId: m2.id,
      subscriptionId: sub2.id,
    });
    expect(autoClassRes.sessionsRemaining).toBe(6);
  });

  it("records direct trainer payout, deducts treasury ledger, and allows voiding", async () => {
    const coach = await createTrainer(db, owner, { fullName: "كابتن زياد", phone: "01599998888" });

    // Record cash payout
    const payout = await recordTrainerPayout(db, owner, {
      trainerId: coach.id,
      amountMinor: 150000, // 1500 EGP
      payoutType: "pt_commission",
      methodCode: "cash",
      notes: "مستحقات أكاديمية السباحة",
    });

    expect(payout.id).toBeTruthy();
    expect(payout.amountMinor).toBe(150000);
    expect(payout.expenseId).toBeTruthy();

    // Verify ledger
    const ledger = db.first<{ amount_minor: number; direction: number }>(
      "SELECT amount_minor, direction FROM financial_ledger WHERE ref_table = 'expenses' AND ref_id = ?",
      [payout.expenseId],
    );
    expect(ledger?.amount_minor).toBe(150000);
    expect(ledger?.direction).toBe(-1); // disbursement

    // List payouts
    const list = listTrainerPayouts(db, owner, coach.id);
    expect(list).toHaveLength(1);
    expect(list[0].amountMinor).toBe(150000);
    expect(list[0].trainerName).toBe("كابتن زياد");

    // Void / delete payout
    await deleteTrainerPayout(db, owner, payout.id);

    const listAfter = listTrainerPayouts(db, owner, coach.id);
    expect(listAfter).toHaveLength(0);
  });

  it("stores and retrieves trainer workingSchedule and calculates financial summary", async () => {
    const scheduleSlots = [
      { dayOfWeek: 6, dayNameAr: "السبت", startTime: "16:00", endTime: "22:00", isActive: true },
      { dayOfWeek: 1, dayNameAr: "الإثنين", startTime: "17:00", endTime: "21:00", isActive: true },
      { dayOfWeek: 5, dayNameAr: "الجمعة", startTime: "", endTime: "", isActive: false },
    ];

    const coach = await createTrainer(db, owner, {
      fullName: "كابتن طارق الشناوي",
      phone: "01099887766",
      defaultSessionFeeMinor: 7500, // 75 EGP
      workingSchedule: scheduleSlots,
    });

    expect(coach.workingSchedule).toHaveLength(3);
    expect(coach.workingSchedule![0].dayNameAr).toBe("السبت");
    expect(coach.workingSchedule![0].startTime).toBe("16:00");
    expect(coach.workingSchedule![2].isActive).toBe(false);

    // Update schedule
    const updated = await updateTrainer(db, owner, coach.id, {
      fullName: "كابتن طارق الشناوي (محدث)",
      workingSchedule: [
        { dayOfWeek: 0, dayNameAr: "الأحد", startTime: "10:00", endTime: "14:00", isActive: true },
      ],
    });
    expect(updated.workingSchedule).toHaveLength(1);
    expect(updated.workingSchedule![0].dayNameAr).toBe("الأحد");

    // Check financial summary initial
    const initialSummary = getTrainerFinancialSummary(db, owner, coach.id);
    expect(initialSummary.totalPaidMinor).toBe(0);
    expect(initialSummary.totalPtDuesMinor).toBe(0);
    expect(initialSummary.balanceDueMinor).toBe(0);

    // Make a payout
    await recordTrainerPayout(db, owner, {
      trainerId: coach.id,
      amountMinor: 50000,
      payoutType: "monthly_salary",
    });

    const summaryAfter = getTrainerFinancialSummary(db, owner, coach.id);
    expect(summaryAfter.totalPaidMinor).toBe(50000);
    expect(summaryAfter.payoutsCount).toBe(1);
  });
});
