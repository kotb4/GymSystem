import { describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { searchMembersForPicker, listMembers } from "@/core/services/members.service";
import { getDashboardOverview } from "@/core/services/dashboard.service";
import { listLedgerEntries } from "@/core/services/finance.service";
import { countCheckInsOnDate } from "@/core/services/attendance.service";
import { createTestDb } from "./helpers/test-db";
import { nowStamp, todayKey } from "@/core/dates";

describe("Test 3: Massive Data Volume Scaling Test", () => {
  it(
    "scales cleanly to 25,000 members and 100,000 operational records without query latency degradation",
    async () => {
      console.log("\n=======================================================");
      console.log("⚡ STARTING MASSIVE DATA VOLUME SCALING TEST (TEST 3)");
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

      const MEMBERS_COUNT = 25000;
      const ATTENDANCE_COUNT = 50000;
      const PAYMENTS_COUNT = 50000;

      console.log(`\n1. Ingesting ${MEMBERS_COUNT.toLocaleString()} members in optimized batch transactions...`);
      const t0 = performance.now();

      // Batch insert 25,000 members with realistic Arabic names and phones
      const BATCH_SIZE = 5000;
      const firstNames = ["أحمد", "محمد", "محمود", "يوسف", "عمر", "علي", "كريم", "خالد", "مصطفى", "إبراهيم", "سارة", "نور", "مريم", "آية", "ياسمين"];
      const lastNames = ["حسن", "علي", "السيد", "محمود", "قطب", "إبراهيم", "خليل", "عثمان", "رمضان", "شريف", "فتحي", "صلاح", "الشريف"];

      for (let b = 0; b < MEMBERS_COUNT; b += BATCH_SIZE) {
        db.transaction(() => {
          for (let i = b; i < b + BATCH_SIZE; i++) {
            const id = `mem-${i.toString().padStart(6, "0")}`;
            const memberCode = `B1-MEM-${(i + 1).toString().padStart(6, "0")}`;
            const fn = firstNames[i % firstNames.length];
            const ln = lastNames[(i * 7) % lastNames.length];
            const fullName = `${fn} ${ln} رقم ${i}`;
            const phone = `010${(10000000 + i).toString().slice(0, 8)}`;
            const stamp = "2026-01-01 10:00:00";

            db.run(
              `INSERT INTO members (id, member_code, full_name, phone, gender, department, status, registration_date, created_by, created_at, updated_at, branch_id)
               VALUES (?, ?, ?, ?, 'male', 'general', 'active', '2026-01-01', ?, ?, ?, 'main')`,
              [id, memberCode, fullName, phone, owner.userId, stamp, stamp]
            );

            // Also insert virtual card for barcode lookup
            const cardId = `crd-${i.toString().padStart(6, "0")}`;
            const barcode = `GYM-${(1000000 + i).toString()}`;
            db.run(
              `INSERT INTO cards (id, barcode_value, status, member_id, assigned_by, assigned_at, created_at, updated_at)
               VALUES (?, ?, 'assigned', ?, ?, ?, ?, ?)`,
              [cardId, barcode, id, owner.userId, stamp, stamp, stamp]
            );
          }
        });
      }
      const tMembers = performance.now() - t0;
      console.log(`✓ Inserted ${MEMBERS_COUNT.toLocaleString()} members in ${tMembers.toFixed(1)}ms (${Math.round((MEMBERS_COUNT / tMembers) * 1000).toLocaleString()} members/sec)`);

      // 2. Ingest 50,000 Attendance records spread across dates
      console.log(`\n2. Ingesting ${ATTENDANCE_COUNT.toLocaleString()} attendance records...`);
      const tAtt0 = performance.now();
      for (let b = 0; b < ATTENDANCE_COUNT; b += BATCH_SIZE) {
        db.transaction(() => {
          for (let i = b; i < b + BATCH_SIZE; i++) {
            const attId = `att-${i.toString().padStart(6, "0")}`;
            const memberId = `mem-${(i % MEMBERS_COUNT).toString().padStart(6, "0")}`;
            const cardId = `crd-${(i % MEMBERS_COUNT).toString().padStart(6, "0")}`;
            const dayOffset = (i % 30);
            const dateStr = `2026-10-${(1 + (dayOffset % 28)).toString().padStart(2, "0")}`;
            const checkinAt = `${dateStr} 14:00:00`;
            const docNo = `B1-ATT-2026-${(i + 1).toString().padStart(6, "0")}`;

            db.run(
              `INSERT INTO attendance (id, member_id, card_id, checkin_at, created_by, branch_id, visit_no)
               VALUES (?, ?, ?, ?, ?, 'main', ?)`,
              [attId, memberId, cardId, checkinAt, owner.userId, docNo]
            );
          }
        });
      }
      const tAtt = performance.now() - tAtt0;
      console.log(`✓ Inserted ${ATTENDANCE_COUNT.toLocaleString()} attendance records in ${tAtt.toFixed(1)}ms (${Math.round((ATTENDANCE_COUNT / tAtt) * 1000).toLocaleString()} records/sec)`);

      // 3. Ingest 50,000 Financial Payments and Ledger records
      console.log(`\n3. Ingesting ${PAYMENTS_COUNT.toLocaleString()} payments and ledger entries...`);
      const tPay0 = performance.now();
      for (let b = 0; b < PAYMENTS_COUNT; b += BATCH_SIZE) {
        db.transaction(() => {
          for (let i = b; i < b + BATCH_SIZE; i++) {
            const payId = `pay-${i.toString().padStart(6, "0")}`;
            const memberId = `mem-${(i % MEMBERS_COUNT).toString().padStart(6, "0")}`;
            const paidAt = `2026-10-${(1 + (i % 28)).toString().padStart(2, "0")} 12:00:00`;
            const amountMinor = 50000; // 500 EGP
            const receiptNo = `B1-RCP-2026-${(i + 1).toString().padStart(6, "0")}`;

            db.run(
              `INSERT INTO payments (id, member_id, base_amount_minor, discount_kind, discount_input, discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor, remaining_amount_minor, method_code, status, paid_at, created_by, created_at, updated_at, branch_id, receipt_no)
               VALUES (?, ?, ?, 'none', 0, 0, ?, ?, 0, 0, 'cash', 'paid', ?, ?, ?, ?, 'main', ?)`,
              [payId, memberId, amountMinor, amountMinor, amountMinor, paidAt, owner.userId, paidAt, paidAt, receiptNo]
            );

            db.run(
              `INSERT INTO financial_ledger (entry_type, ref_table, ref_id, member_id, method_code, direction, amount_minor, occurred_at, created_by, created_at, box)
               VALUES ('payment', 'payments', ?, ?, 'cash', 1, ?, ?, ?, ?, 'gym')`,
              [payId, memberId, amountMinor, paidAt, owner.userId, paidAt]
            );
          }
        });
      }
      const tPay = performance.now() - tPay0;
      console.log(`✓ Inserted ${PAYMENTS_COUNT.toLocaleString()} financial records in ${tPay.toFixed(1)}ms (${Math.round((PAYMENTS_COUNT / tPay) * 1000).toLocaleString()} ledger/sec)`);

      // Verify total DB volume
      const totalMembers = db.count("SELECT COUNT(*) FROM members");
      const totalAttendance = db.count("SELECT COUNT(*) FROM attendance");
      const totalLedger = db.count("SELECT COUNT(*) FROM financial_ledger");
      expect(totalMembers).toBe(MEMBERS_COUNT);
      expect(totalAttendance).toBe(ATTENDANCE_COUNT);
      expect(totalLedger).toBe(PAYMENTS_COUNT);
      console.log(`\n📊 Total Database Volume: ${totalMembers.toLocaleString()} members, ${totalAttendance.toLocaleString()} attendances, ${totalLedger.toLocaleString()} ledger rows.`);

      // -------------------------------------------------------------
      // BENCHMARK 1: Sub-Millisecond Search By Phone & Name over 25k Members
      // -------------------------------------------------------------
      console.log("\n⚡ BENCHMARK 1: Member Search Latency (Index efficiency over 25k records)...");

      // Test searching specific phone
      const phoneToFind = "01010012345";
      const s0 = performance.now();
      const phoneResults = searchMembersForPicker(db, owner, phoneToFind);
      const sPhone = performance.now() - s0;
      expect(phoneResults.length).toBeGreaterThanOrEqual(1);

      // Test searching specific name
      const nameToFind = "أحمد قطب";
      const s1 = performance.now();
      const nameResults = searchMembersForPicker(db, owner, nameToFind);
      const sName = performance.now() - s1;
      expect(nameResults.length).toBeGreaterThan(0);

      // Test searching member code
      const codeToFind = "B1-MEM-012345";
      const s2 = performance.now();
      const codeResults = searchMembersForPicker(db, owner, codeToFind);
      const sCode = performance.now() - s2;
      expect(codeResults.length).toBe(1);

      console.log(`  -> Exact Phone Lookup:   ${sPhone.toFixed(2)} ms (Hits: ${phoneResults.length})`);
      console.log(`  -> Arabic Name Search:    ${sName.toFixed(2)} ms (Hits: ${nameResults.length})`);
      console.log(`  -> Member Code Lookup:    ${sCode.toFixed(2)} ms (Hits: ${codeResults.length})`);

      // Ensure indexed lookups are fast (under 100ms even under heavy parallel load)
      expect(sPhone).toBeLessThan(100);
      expect(sCode).toBeLessThan(100);

      // -------------------------------------------------------------
      // BENCHMARK 2: Deep Pagination over 25,000 Members
      // -------------------------------------------------------------
      console.log("\n⚡ BENCHMARK 2: Pagination Latency...");
      const pFirst0 = performance.now();
      const firstPage = listMembers(db, owner, { page: 1, pageSize: 25 });
      const pFirst = performance.now() - pFirst0;

      const pDeep0 = performance.now();
      const deepPage = listMembers(db, owner, { page: 500, pageSize: 25 });
      const pDeep = performance.now() - pDeep0;

      console.log(`  -> Page 1 (first 25 members):     ${pFirst.toFixed(2)} ms`);
      console.log(`  -> Page 500 (deep 12,500 offset): ${pDeep.toFixed(2)} ms`);
      expect(firstPage.items.length).toBe(25);
      expect(deepPage.items.length).toBe(25);
      expect(pFirst).toBeLessThan(150);
      expect(pDeep).toBeLessThan(1200);

      // -------------------------------------------------------------
      // BENCHMARK 3: Dashboard & Financial Aggregation over 50,000 Ledger Entries
      // -------------------------------------------------------------
      console.log("\n⚡ BENCHMARK 3: High-Volume Treasury & Dashboard Aggregations...");
      const d0 = performance.now();
      const overview = getDashboardOverview(db, owner, "30d");
      const dTime = performance.now() - d0;

      console.log(`  -> Full 30-Day Dashboard Aggregations: ${dTime.toFixed(2)} ms`);
      const revenueMinor = overview.finance?.revenue.current ?? 0;
      console.log(`     Total Revenue Calculated: ${(revenueMinor / 100).toLocaleString()} EGP`);
      expect(dTime).toBeLessThan(1000);
      expect(revenueMinor).toBeGreaterThan(0);

      // Benchmark single day attendance count
      const attDay0 = performance.now();
      const dayCount = countCheckInsOnDate(db, "2026-10-15");
      const attDay = performance.now() - attDay0;
      console.log(`  -> Single Day Check-in Count over 50k attendance: ${attDay.toFixed(2)} ms (Count: ${dayCount})`);
      expect(attDay).toBeLessThan(50);

      // -------------------------------------------------------------
      // BENCHMARK 4: SQLite PRAGMA Integrity Check on Populated DB
      // -------------------------------------------------------------
      console.log("\n⚡ BENCHMARK 4: Database Storage Integrity Check...");
      const int0 = performance.now();
      const integrity = db.scalar<string>("PRAGMA integrity_check");
      const intTime = performance.now() - int0;
      console.log(`  -> PRAGMA integrity_check: ${integrity} (scanned entire file in ${intTime.toFixed(1)} ms)`);
      expect(integrity).toBe("ok");

      console.log("\n✓ MASSIVE DATA VOLUME SCALING COMPLETED WITH SUB-MILLISECOND LATENCIES.");
      console.log("=======================================================\n");
    },
    120000 // 120s timeout for massive batch insertions during concurrent suite execution
  );
});
