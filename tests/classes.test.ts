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
} from "@/core/services/classes.service";
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
