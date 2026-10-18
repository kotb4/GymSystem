import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember, listMembers } from "@/core/services/members.service";
import { createClass, createClassSession, bookMember, listMemberBookings } from "@/core/services/classes.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let ownerActor: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "System Owner",
    username: "owner",
    password: "Password123!",
  });
  ownerActor = buildActor(ownerUser);
});

describe("M2 Features: Member Department Filtering & Booking Details", () => {
  it("filters members by department correctly", async () => {
    // Create members across different departments
    const m1 = await createMember(db, ownerActor, {
      fullName: "Member General",
      phone: "01011111111",
      department: "general",
    });
    const m2 = await createMember(db, ownerActor, {
      fullName: "Member Men",
      phone: "01022222222",
      department: "men",
    });
    const m3 = await createMember(db, ownerActor, {
      fullName: "Member Women",
      phone: "01033333333",
      department: "women",
    });

    // List all
    const all = listMembers(db, ownerActor, { department: "all" });
    expect(all.total).toBe(3);

    // Filter men
    const menOnly = listMembers(db, ownerActor, { department: "men" });
    expect(menOnly.total).toBe(1);
    expect(menOnly.items[0].id).toBe(m2.id);

    // Filter women
    const womenOnly = listMembers(db, ownerActor, { department: "women" });
    expect(womenOnly.total).toBe(1);
    expect(womenOnly.items[0].id).toBe(m3.id);

    // Filter general
    const generalOnly = listMembers(db, ownerActor, { department: "general" });
    expect(generalOnly.total).toBe(1);
    expect(generalOnly.items[0].id).toBe(m1.id);
  });

  it("joins class name, session date, and start time in listMemberBookings", async () => {
    const member = await createMember(db, ownerActor, {
      fullName: "Karate Trainee",
      phone: "01099999999",
      department: "general",
    });

    const cls = await createClass(db, ownerActor, {
      name: "أكاديمية الكاراتيه المتقدمة",
      capacity: 20,
    });

    const session = await createClassSession(db, ownerActor, cls.id, {
      sessionDate: todayKey(),
      startTime: "17:30",
      durationMin: 60,
    });

    await bookMember(db, ownerActor, {
      sessionId: session.id,
      memberId: member.id,
    });

    const bookings = listMemberBookings(db, ownerActor, member.id);
    expect(bookings.length).toBe(1);
    expect(bookings[0].className).toBe("أكاديمية الكاراتيه المتقدمة");
    expect(bookings[0].sessionDate).toBe(todayKey());
    expect(bookings[0].sessionStartTime).toBe("17:30");
  });
});
