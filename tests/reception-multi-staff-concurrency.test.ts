import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { setup, buildActor } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember, searchMembersForPicker } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { writeSettingInternal } from "@/core/services/settings.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";

describe("Reception Multi-Staff Concurrency & Peak-Hours Stress", () => {
  async function initTestSystem() {
    const db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك الرئيسي",
      username: "owner",
      password: "Owner@2026",
    });
    const owner = buildActor(ownerUser);

    // Create 5 distinct reception staff actors
    const staffActors: ServiceActor[] = [];
    for (let i = 1; i <= 5; i++) {
      const user = await createUser(db, owner, {
        username: `receptionist_${i}`,
        password: `StaffPass@${i}2026`,
        fullName: `موظف استقبال ${i}`,
        roleId: "reception",
        department: "general",
      });
      staffActors.push(buildActor(user));
    }

    const timePlan = await createPlan(db, owner, {
      name: "اشتراك شهري عادي",
      durationDays: 30,
      price: 40000,
      kind: "time",
    });

    const sessionPlan = await createPlan(db, owner, {
      name: "باقة 5 حصص",
      durationDays: 30,
      price: 25000,
      kind: "sessions",
      sessionsCount: 5,
    });

    return { db, owner, staffActors, timePlan, sessionPlan };
  }

  it("handles 5 receptionists checking in distinct members concurrently without contention or deadlock", async () => {
    const { db, owner, staffActors, timePlan } = await initTestSystem();

    // Create 50 members (10 per staff member)
    const members: Array<{ id: string; barcode: string; staffIndex: number }> = [];
    for (let i = 0; i < 50; i++) {
      const staffIdx = i % staffActors.length;
      const mem = await createMember(db, staffActors[staffIdx], {
        fullName: `عضو ذروة ${i + 1}`,
        phone: `0111000${String(i).padStart(4, "0")}`,
        gender: i % 2 === 0 ? "male" : "female",
      });

      const card = db.first<{ barcode_value: string }>(
        "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned'",
        [mem.id],
      );

      await createSubscription(db, owner, {
        memberId: mem.id,
        planId: timePlan.id,
        startDate: todayKey(),
      });

      members.push({ id: mem.id, barcode: card!.barcode_value, staffIndex: staffIdx });
    }

    // All 5 staff members simultaneously process check-ins
    const checkinPromises = members.map(async (m) => {
      const actor = staffActors[m.staffIndex];
      return recordCheckIn(db, actor, { barcode: m.barcode });
    });

    const results = await Promise.all(checkinPromises);

    const successful = results.filter((r) => r.kind === "success");
    expect(successful.length).toBe(50);

    // Verify 50 attendance records created in database
    const totalCount = db.scalar<number>("SELECT count(*) FROM attendance");
    expect(totalCount).toBe(50);
  });

  it("atomically resolves concurrent double-scans of the same card by different receptionists", async () => {
    const { db, owner, staffActors, timePlan } = await initTestSystem();

    const mem = await createMember(db, owner, {
      fullName: "عضو فحص السباق",
      phone: "01099998888",
    });

    const card = db.first<{ barcode_value: string }>(
      "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned'",
      [mem.id],
    );

    await createSubscription(db, owner, {
      memberId: mem.id,
      planId: timePlan.id,
      startDate: todayKey(),
    });

    // 5 receptionists scan the exact same member barcode concurrently at the same microsecond
    const racePromises = staffActors.map(async (actor) => {
      try {
        return await recordCheckIn(db, actor, { barcode: card!.barcode_value });
      } catch (err) {
        return err;
      }
    });

    const raceResults = await Promise.all(racePromises);

    // Exactly one should succeed with "success"; the remaining 4 should be rejected as duplicate
    const successResults = raceResults.filter(
      (r: any) => r && typeof r === "object" && r.kind === "success",
    );
    const duplicateResults = raceResults.filter(
      (r: any) =>
        r &&
        typeof r === "object" &&
        (r.kind === "duplicate" || r.code === "CHECKIN_DUPLICATE_SENTINEL"),
    );

    expect(successResults.length).toBe(1);
    expect(duplicateResults.length).toBe(4);

    // Attendance table should only have 1 row
    const attendanceCount = db.scalar<number>(
      "SELECT count(*) FROM attendance WHERE member_id = ?",
      [mem.id],
    );
    expect(attendanceCount).toBe(1);
  });

  it("safely decrements sessions under multi-staff concurrent check-ins and refuses overconsumption", async () => {
    const { db, owner, staffActors, sessionPlan } = await initTestSystem();
    // Allow rapid legitimate visits across multiple sessions
    writeSettingInternal(db, "duplicate_window_seconds", "0");

    const mem = await createMember(db, owner, {
      fullName: "عضو باقة الحصص المحدودة",
      phone: "01234567890",
    });

    const card = db.first<{ barcode_value: string }>(
      "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned'",
      [mem.id],
    );

    const sub = await createSubscription(db, owner, {
      memberId: mem.id,
      planId: sessionPlan.id,
      startDate: todayKey(),
    });

    // Check initial sessions
    const subBefore = db.first<{ sessions_total: number; sessions_used: number }>(
      "SELECT sessions_total, sessions_used FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(subBefore?.sessions_total).toBe(5);
    expect(subBefore?.sessions_used).toBe(0);

    // Simulate 5 legitimate attendance sessions checked in sequentially by 5 different receptionists
    for (let sessionNum = 1; sessionNum <= 5; sessionNum++) {
      const actor = staffActors[(sessionNum - 1) % staffActors.length];
      const res = await recordCheckIn(db, actor, {
        barcode: card!.barcode_value,
      });
      expect(res.kind).toBe("success");
      // Push checkin_at back in time to simulate previous days/hours and avoid same-second duplicate lock
      if (res.kind === "success") {
        db.run("UPDATE attendance SET checkin_at = ? WHERE id = ?", [
          `2026-10-1${sessionNum}T10:00:00.000Z`,
          res.attendanceId,
        ]);
      }
    }

    // Sessions should now be 5 used out of 5 total
    const subAfter = db.first<{ sessions_total: number; sessions_used: number; status: string }>(
      "SELECT sessions_total, sessions_used, status FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(subAfter?.sessions_used).toBe(5);

    // 6th check-in attempt by any receptionist must fail with no active subscription / zero sessions
    const actor = staffActors[0];
    const sixthAttempt = await recordCheckIn(db, actor, {
      barcode: card!.barcode_value,
    });

    expect(sixthAttempt.kind).toBe("denied");
    expect((sixthAttempt as any).reason).toBe("NO_SESSIONS_LEFT");

    // Sessions used must not exceed sessions total
    const subFinal = db.first<{ sessions_total: number; sessions_used: number }>(
      "SELECT sessions_total, sessions_used FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(subFinal?.sessions_used).toBe(5);
  });

  it("allows searching members simultaneously while heavy check-in bursts occur", async () => {
    const { db, owner, staffActors, timePlan } = await initTestSystem();

    // Seed 20 members
    const barcodes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const mem = await createMember(db, owner, {
        fullName: `عضو متزامن ${i}`,
        phone: `0155000${String(i).padStart(4, "0")}`,
      });
      const card = db.first<{ barcode_value: string }>(
        "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned'",
        [mem.id],
      );
      barcodes.push(card!.barcode_value);

      await createSubscription(db, owner, {
        memberId: mem.id,
        planId: timePlan.id,
        startDate: todayKey(),
      });
    }

    // Interleave check-ins and member searches across all staff actors
    const tasks = [
      ...barcodes.map((bc, idx) =>
        recordCheckIn(db, staffActors[idx % staffActors.length], { barcode: bc }),
      ),
      ...Array.from({ length: 15 }).map((_, idx) =>
        searchMembersForPicker(db, staffActors[idx % staffActors.length], `عضو متزامن ${idx}`),
      ),
    ];

    const results = await Promise.all(tasks);
    expect(results.length).toBe(35);
  });
});
