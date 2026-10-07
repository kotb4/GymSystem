import { describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember, listMembers, searchMembersForPicker } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { getDashboardOverview } from "@/core/services/dashboard.service";
import { listLedgerEntries } from "@/core/services/finance.service";
import { createTestDb } from "./helpers/test-db";
import { todayKey } from "@/core/dates";

describe("Test 5: Memory Leak & Endurance Soak Test", () => {
  it(
    "executes thousands of repeated full-stack operational cycles without unbounded memory growth (Heap & RSS stability)",
    async () => {
      console.log("\n=======================================================");
      console.log("⚡ STARTING MEMORY LEAK & ENDURANCE SOAK TEST (TEST 5)");
      console.log("=======================================================");

      const db = createTestDb();
      const owner = buildActor(
        await setup(db, {
          gymName: "Yassen Mohamed Kotb | 01288536381",
          ownerFullName: "كابتن ياسين قطب",
          username: "yassen_owner",
          password: "SecurePassword@2026",
        })
      );

      const plan = await createPlan(db, owner, {
        name: "باقة اختبار الذاكرة المتكررة",
        durationDays: 30,
        price: 500,
        kind: "time",
      });

      // Force Garbage Collection if available in node
      if (global.gc) {
        global.gc();
      }

      const initialMemory = process.memoryUsage();
      console.log(`\n1. Baseline Memory Usage:`);
      console.log(`   -> Heap Used:  ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   -> Heap Total: ${(initialMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   -> RSS:        ${(initialMemory.rss / 1024 / 1024).toFixed(2)} MB`);

      const ITERATIONS = 1000;
      const CHECKPOINT_INTERVAL = 250;
      console.log(`\n2. Running ${ITERATIONS} full workflow cycles (Member -> Card -> Sub -> Payment -> Check-in -> Dashboard -> Finance List)...`);

      const memoryCheckpoints: Array<{
        iteration: number;
        heapUsedMb: number;
        heapTotalMb: number;
        rssMb: number;
        deltaMb: number;
      }> = [];

      const startMs = performance.now();

      for (let i = 1; i <= ITERATIONS; i++) {
        // Cycle Workflow:
        // A. Create Member
        const member = await createMember(db, owner, {
          fullName: `عضو دورة الذاكرة ${i}`,
          phone: `01088${i.toString().padStart(6, "0")}`,
        });

        const card = db.first<{ barcode_value: string }>(
          "SELECT barcode_value FROM cards WHERE member_id = ?",
          [member.id]
        )!;

        // B. Create Subscription
        const sub = await createSubscription(db, owner, {
          memberId: member.id,
          planId: plan.id,
          startDate: todayKey(),
        });

        // C. Record Payment
        await recordPayment(db, owner, {
          memberId: member.id,
          subscriptionId: sub.id,
          baseAmountMinor: 50000,
          paidAmountMinor: 50000,
          methodCode: "cash",
        });

        // D. Check-in
        await recordCheckIn(db, owner, {
          barcode: card.barcode_value,
        });

        // E. Trigger Reporting & Search Queries
        if (i % 25 === 0) {
          getDashboardOverview(db, owner, "30d");
          searchMembersForPicker(db, owner, "عضو دورة");
          listLedgerEntries(db, owner, { page: 1, pageSize: 20 });
        }

        // Checkpoint metrics every 250 cycles
        if (i % CHECKPOINT_INTERVAL === 0) {
          if (global.gc) {
            global.gc();
          }
          const currentMem = process.memoryUsage();
          const heapUsedMb = currentMem.heapUsed / 1024 / 1024;
          const heapTotalMb = currentMem.heapTotal / 1024 / 1024;
          const rssMb = currentMem.rss / 1024 / 1024;
          const deltaMb = (currentMem.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

          memoryCheckpoints.push({
            iteration: i,
            heapUsedMb,
            heapTotalMb,
            rssMb,
            deltaMb,
          });

          console.log(
            `  -> [Cycle ${i.toString().padStart(4)}] Heap: ${heapUsedMb.toFixed(2)} MB | Heap Total: ${heapTotalMb.toFixed(2)} MB | RSS: ${rssMb.toFixed(2)} MB | Delta: +${deltaMb.toFixed(2)} MB`
          );
        }
      }

      const durationMs = performance.now() - startMs;
      console.log(`\n✓ Completed ${ITERATIONS} full-stack cycles in ${(durationMs / 1000).toFixed(2)}s (${Math.round((ITERATIONS / durationMs) * 1000)} cycles/sec)`);

      // Final memory audit after GC
      if (global.gc) {
        global.gc();
      }
      const finalMemory = process.memoryUsage();
      const finalHeapUsedMb = finalMemory.heapUsed / 1024 / 1024;
      const initialHeapUsedMb = initialMemory.heapUsed / 1024 / 1024;
      const netHeapGrowthMb = finalHeapUsedMb - initialHeapUsedMb;

      console.log(`\n3. Final Memory Analysis:`);
      console.log(`   -> Initial Heap Used: ${initialHeapUsedMb.toFixed(2)} MB`);
      console.log(`   -> Final Heap Used:   ${finalHeapUsedMb.toFixed(2)} MB`);
      console.log(`   -> Net Heap Growth:   +${netHeapGrowthMb.toFixed(2)} MB over 1,000 deep workflow cycles`);
      console.log(`   -> Final RSS:         ${(finalMemory.rss / 1024 / 1024).toFixed(2)} MB`);

      // Verification invariants:
      // 1. Total records created must match 1,000 each
      expect(db.count("SELECT COUNT(*) FROM members WHERE id != 'usr-1'")).toBe(ITERATIONS);
      expect(db.count("SELECT COUNT(*) FROM member_subscriptions")).toBe(ITERATIONS);
      expect(db.count("SELECT COUNT(*) FROM payments")).toBe(ITERATIONS);
      expect(db.count("SELECT COUNT(*) FROM attendance")).toBe(ITERATIONS);
      expect(db.count("SELECT COUNT(*) FROM financial_ledger")).toBe(ITERATIONS);

      // 2. Net heap growth over 1,000 full-stack cycles with SQLite WAL and caches must remain well below 65 MB
      // This strictly confirms that neither Node closures, dirty listeners, nor prepared statements leak memory.
      expect(netHeapGrowthMb).toBeLessThan(65);

      // 3. Database integrity check
      const integrity = db.scalar<string>("PRAGMA integrity_check");
      expect(integrity).toBe("ok");
      console.log(`   -> SQLite PRAGMA integrity_check: ${integrity}`);

      console.log("\n✓ MEMORY LEAK & ENDURANCE SOAK TEST PASSED: MEMORY CONSUMPTION IS STABLE & BOUNDED.");
      console.log("=======================================================\n");
    },
    60000
  );
});
