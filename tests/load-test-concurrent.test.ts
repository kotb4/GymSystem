import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { setup, buildActor } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { getDashboardStats } from "@/core/services/dashboard.service";
import { getOpenSessionTotals } from "@/core/services/cash-session.service";
import { todayKey } from "@/core/dates";

describe("Test 1: Concurrent Load & Throughput Stress Test", () => {
  it("sustains heavy concurrent load across members, subscriptions, attendance, and reporting", async () => {
    const db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    });
    const owner = buildActor(ownerUser);

    // 1. Create a base subscription plan
    const plan = await createPlan(db, owner, {
      name: "خطة الضغط السريع 1 شهر",
      durationDays: 30,
      price: 50000, // 500 EGP
      kind: "time",
    });

    console.log("\n=======================================================");
    console.log("🚀 STARTING LOAD & THROUGHPUT STRESS TEST (TEST 1)");
    console.log("=======================================================");

    // 2. Batch generate 500 members with virtual cards
    const MEMBER_COUNT = 500;
    const t0 = performance.now();

    const createdMembers: Array<{ id: string; barcode: string }> = [];

    for (let i = 1; i <= MEMBER_COUNT; i++) {
      const mem = await createMember(db, owner, {
        fullName: `عضو فحص التحمل رقم ${i}`,
        phone: `0100000${String(i).padStart(4, "0")}`,
        gender: i % 2 === 0 ? "male" : "female",
      });

      // Fetch virtual card barcode created automatically for this member
      const card = db.first<{ barcode_value: string }>(
        "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned'",
        [mem.id]
      );
      createdMembers.push({ id: mem.id, barcode: card!.barcode_value });
    }

    const tMembers = performance.now();
    const memberTimeMs = tMembers - t0;
    const memberRps = (MEMBER_COUNT / (memberTimeMs / 1000)).toFixed(1);
    console.log(`✓ 1. Member Registrations: ${MEMBER_COUNT} members in ${memberTimeMs.toFixed(1)}ms (${memberRps} RPS)`);

    // 3. Concurrently create subscriptions and payments for all members
    const tSubStart = performance.now();
    const subPromises = createdMembers.map(async (m) => {
      const sub = await createSubscription(db, owner, {
        memberId: m.id,
        planId: plan.id,
        startDate: todayKey(),
      });
      await recordPayment(db, owner, {
        memberId: m.id,
        subscriptionId: sub.id,
        baseAmountMinor: 50000,
        paidAmountMinor: 50000,
        methodCode: "cash",
      });
      return sub;
    });
    await Promise.all(subPromises);
    const tSubEnd = performance.now();
    const subTimeMs = tSubEnd - tSubStart;
    const subRps = (MEMBER_COUNT / (subTimeMs / 1000)).toFixed(1);
    console.log(`✓ 2. Subscriptions, Payments & Ledger Ingestion: ${MEMBER_COUNT} subs + payments in ${subTimeMs.toFixed(1)}ms (${subRps} workflows/sec)`);

    // 4. Concurrent Check-in Blitz (All 200 members check-in concurrently)
    const latencies: number[] = [];
    const tCheckinStart = performance.now();

    const checkInPromises = createdMembers.map(async (m) => {
      const itemStart = performance.now();
      const res = await recordCheckIn(db, owner, { barcode: m.barcode });
      const itemElapsed = performance.now() - itemStart;
      latencies.push(itemElapsed);
      return res;
    });

    const checkinResults = await Promise.all(checkInPromises);
    const tCheckinEnd = performance.now();
    const checkinTimeMs = tCheckinEnd - tCheckinStart;
    const checkinRps = (MEMBER_COUNT / (checkinTimeMs / 1000)).toFixed(1);

    // Calculate Latency Metrics
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(2);
    const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);
    const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(2);
    const avgLatency = (latencies.reduce((sum, v) => sum + v, 0) / latencies.length).toFixed(2);

    console.log(`✓ 3. Concurrent Attendance Blitz: ${MEMBER_COUNT} check-ins in ${checkinTimeMs.toFixed(1)}ms (${checkinRps} RPS)`);
    console.log(`     Latencies: Avg: ${avgLatency}ms | p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms`);

    // Check all check-in results were successful
    const successCount = checkinResults.filter((r) => r.kind === "success").length;
    expect(successCount).toBe(MEMBER_COUNT);

    // 5. Query & Reporting Load Under Active State
    const tReportStart = performance.now();
    const REPORT_ROUNDS = 50;
    const reportPromises = Array.from({ length: REPORT_ROUNDS }).map(() =>
      Promise.all([
        getDashboardStats(db, owner, "today"),
        getOpenSessionTotals(db, owner, "gym"),
      ])
    );
    await Promise.all(reportPromises);
    const tReportEnd = performance.now();
    const reportTimeMs = tReportEnd - tReportStart;
    const reportRps = ((REPORT_ROUNDS * 2) / (reportTimeMs / 1000)).toFixed(1);

    console.log(`✓ 4. Heavy Dashboard & Treasury Aggregations: ${REPORT_ROUNDS * 2} reports in ${reportTimeMs.toFixed(1)}ms (${reportRps} queries/sec)`);

    // 6. Final Database Consistency & Integrity Verification
    const totalMembers = db.count("SELECT COUNT(*) FROM members");
    const totalSubs = db.count("SELECT COUNT(*) FROM member_subscriptions");
    const totalAttendances = db.count("SELECT COUNT(*) FROM attendance");
    const totalLedger = db.count("SELECT COUNT(*) FROM financial_ledger");
    const integrityCheck = db.first<{ integrity_check: string }>("PRAGMA integrity_check");

    console.log("\n--- VERIFICATION STATS ---");
    console.log(`Total Members In DB:     ${totalMembers}`);
    console.log(`Total Subscriptions:     ${totalSubs}`);
    console.log(`Total Attendances:       ${totalAttendances}`);
    console.log(`Financial Ledger Rows:   ${totalLedger}`);
    console.log(`SQLite PRAGMA Integrity: ${integrityCheck?.integrity_check}`);
    console.log("=======================================================\n");

    expect(totalMembers).toBe(MEMBER_COUNT);
    expect(totalSubs).toBe(MEMBER_COUNT);
    expect(totalAttendances).toBe(MEMBER_COUNT);
    expect(totalLedger).toBe(MEMBER_COUNT); // 1 ledger record per paid subscription
    expect(integrityCheck?.integrity_check).toBe("ok");
  });
});
