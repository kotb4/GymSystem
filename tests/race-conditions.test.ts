import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { setup, buildActor } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { todayKey } from "@/core/dates";

describe("Test 2: Race Conditions & Double-Submit Protection Test", () => {
  it("prevents double-payments, duplicate check-ins, and duplicate subscriptions in concurrent races", async () => {
    const db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    });
    const owner = buildActor(ownerUser);

    console.log("\n=======================================================");
    console.log("⚡ STARTING RACE CONDITIONS & DOUBLE-SUBMIT TEST (TEST 2)");
    console.log("=======================================================");

    // 1. Setup a test member and a session-based plan (e.g. 10 sessions)
    const member = await createMember(db, owner, {
      fullName: "كابتن فحص التضارب والسباق",
      phone: "01099887766",
    });

    const card = db.first<{ barcode_value: string }>(
      "SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'assigned'",
      [member.id]
    );
    const barcode = card!.barcode_value;

    const sessionPlan = await createPlan(db, owner, {
      name: "باقة 10 حصص دقيقة",
      durationDays: 30,
      price: 1000, // 1,000 EGP (100,000 piastres)
      kind: "sessions",
      sessionsCount: 10,
    });

    // -------------------------------------------------------------
    // SCENARIO A: Concurrent Double Subscription Race
    // (User double-clicks "Create Subscription" button in same millisecond)
    // -------------------------------------------------------------
    console.log("Testing Scenario A: Concurrent Subscription Overlap Race...");
    const subPromises = [
      createSubscription(db, owner, {
        memberId: member.id,
        planId: sessionPlan.id,
        startDate: todayKey(),
      }),
      createSubscription(db, owner, {
        memberId: member.id,
        planId: sessionPlan.id,
        startDate: todayKey(),
      }),
    ];

    const subResults = await Promise.allSettled(subPromises);
    const successfulSubs = subResults.filter((r) => r.status === "fulfilled");
    const rejectedSubs = subResults.filter((r) => r.status === "rejected");

    console.log(`  -> Successful subscriptions created: ${successfulSubs.length}`);
    console.log(`  -> Rejected conflicting subscriptions: ${rejectedSubs.length}`);
    if (rejectedSubs.length > 0) {
      console.log("  -> Rejection reasons:", rejectedSubs.map((r: any) => r.reason?.message ?? r.reason));
    }

    // Exactly 1 must succeed and 1 must be rejected due to overlap collision
    expect(successfulSubs.length).toBe(1);
    expect(rejectedSubs.length).toBe(1);

    const activeSub = (successfulSubs[0] as PromiseFulfilledResult<any>).value;
    console.log("  -> activeSub:", activeSub);

    // -------------------------------------------------------------
    // SCENARIO B: Concurrent Double Payment Race
    // (User double-clicks "Record Payment" to pay full amount in same millisecond)
    // -------------------------------------------------------------
    console.log("\nTesting Scenario B: Concurrent Double-Payment Race on Remaining Balance...");
    console.log("  -> activeSub id:", activeSub?.id);
    const payPromises = [
      recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: activeSub.id,
        baseAmountMinor: 100000,
        paidAmountMinor: 100000,
        methodCode: "cash",
      }),
      recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: activeSub.id,
        baseAmountMinor: 100000,
        paidAmountMinor: 100000,
        methodCode: "cash",
      }),
    ];

    const payResults = await Promise.allSettled(payPromises);
    const successfulPays = payResults.filter((r) => r.status === "fulfilled");
    const rejectedPays = payResults.filter((r) => r.status === "rejected");

    console.log(`  -> Successful payments recorded: ${successfulPays.length}`);
    console.log(`  -> Rejected overcharging payments: ${rejectedPays.length}`);
    if (rejectedPays.length > 0) {
      console.log("  -> Payment rejection reasons:", rejectedPays.map((r: any) => r.reason?.message ?? r.reason));
    }

    // Exactly 1 payment of 1,000 EGP must pass; the duplicate MUST be rejected
    expect(successfulPays.length).toBe(1);
    expect(rejectedPays.length).toBe(1);

    // Verify ledger has exactly 1 entry for this payment
    const ledgerCount = db.count(
      "SELECT COUNT(*) FROM financial_ledger WHERE member_id = ? AND entry_type = 'payment'",
      [member.id]
    );
    expect(ledgerCount).toBe(1);

    // -------------------------------------------------------------
    // SCENARIO C: Concurrent Rapid-Scan / Double Check-in Race
    // (Barcode scanner double-triggers or twin scanners scan member simultaneously)
    // -------------------------------------------------------------
    console.log("\nTesting Scenario C: Concurrent Double Check-in Race (Rapid Scan Window)...");
    
    // Member has 10 sessions. A duplicate scan must NOT consume 2 sessions!
    const scanPromises = [
      recordCheckIn(db, owner, { barcode }),
      recordCheckIn(db, owner, { barcode }),
    ];

    const scanResults = await Promise.all(scanPromises);
    const checkinSuccesses = scanResults.filter((r) => r.kind === "success");
    const checkinDuplicates = scanResults.filter((r) => r.kind === "duplicate");

    console.log(`  -> Successful check-in entries: ${checkinSuccesses.length}`);
    console.log(`  -> Detected duplicate scan warnings: ${checkinDuplicates.length}`);
    console.log("  -> Scan results details:", JSON.stringify(scanResults, null, 2));

    expect(checkinSuccesses.length).toBe(1);
    expect(checkinDuplicates.length).toBe(1);

    // Verify session consumption in DB: exactly 1 session consumed (9 remaining)
    const updatedSub = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
      [activeSub.id]
    );
    console.log(`  -> Sessions used in database: ${updatedSub?.sessions_used} / 10`);
    expect(updatedSub?.sessions_used).toBe(1);

    // Verify attendance table: exactly 1 row recorded for this member today
    const attendanceCount = db.count(
      "SELECT COUNT(*) FROM attendance WHERE member_id = ? AND deleted_at IS NULL",
      [member.id]
    );
    expect(attendanceCount).toBe(1);

    console.log("\n✓ ALL 3 RACE-CONDITION SAFEGUARDS VERIFIED AND PASSING.");
    console.log("=======================================================\n");
  });
});
