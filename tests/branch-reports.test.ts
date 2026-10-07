import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import { getPeriodReport } from "@/core/services/financial-report.service";
import { getAttendanceAnalytics } from "@/core/services/attendance-analytics.service";
import { getDashboardOverview, getDashboardStats } from "@/core/services/dashboard.service";
import { upsertRegisteredBranch } from "@/core/services/sync.service";
import { todayKey } from "@/core/dates";

describe("Multi-branch financial reports and dashboard filtering (TASK-090)", () => {
  it("segments financial reports, attendance, and dashboard by branch", async () => {
    const db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    });
    const owner = buildActor(ownerUser);
    const userId = ownerUser.id;
    const today = todayKey();

    // 1. Register two branches
    upsertRegisteredBranch(db, "main", "الفرع الرئيسي", "primary");
    upsertRegisteredBranch(db, "nasr_city", "فرع مدينة نصر", "replica");

    // 2. Insert test member in main branch
    const mainMemberId = "mem-main-1";
    db.run(
      "INSERT INTO members (id, member_code, full_name, phone, status, gender, registration_date, branch_id, created_at, updated_at) " +
        "VALUES (?, 'M001', 'عضو فرع رئيسي', '01000000001', 'active', 'male', ?, 'main', datetime('now'), datetime('now'))",
      [mainMemberId, today],
    );

    // Insert test member in replica branch
    const replicaMemberId = "mem-replica-1";
    db.run(
      "INSERT INTO members (id, member_code, full_name, phone, status, gender, registration_date, branch_id, created_at, updated_at) " +
        "VALUES (?, 'M002', 'عضو فرع نصر', '01000000002', 'active', 'male', ?, 'nasr_city', datetime('now'), datetime('now'))",
      [replicaMemberId, today],
    );

    // 3. Insert payments:
    // Main branch payment: 1000 EGP (100,000 minor)
    db.run(
      "INSERT INTO payments (id, member_id, method_code, base_amount_minor, discount_amount_minor, net_amount_minor, paid_amount_minor, remaining_amount_minor, status, branch_id, created_by, paid_at, created_at, updated_at) " +
        "VALUES ('pay-1', ?, 'cash', 100000, 0, 100000, 100000, 0, 'paid', 'main', ?, ?, datetime('now'), datetime('now'))",
      [mainMemberId, userId, `${today} 10:00:00`],
    );

    // Replica branch payment: 500 EGP (50,000 minor)
    db.run(
      "INSERT INTO payments (id, member_id, method_code, base_amount_minor, discount_amount_minor, net_amount_minor, paid_amount_minor, remaining_amount_minor, status, branch_id, created_by, paid_at, created_at, updated_at) " +
        "VALUES ('pay-2', ?, 'cash', 50000, 0, 50000, 50000, 0, 'paid', 'nasr_city', ?, ?, datetime('now'), datetime('now'))",
      [replicaMemberId, userId, `${today} 11:00:00`],
    );

    // 4. Insert expenses:
    // Main branch expense: 200 EGP (20,000 minor)
    db.run(
      "INSERT INTO expenses (id, category_id, method_code, amount_minor, description, expense_date, status, branch_id, created_by, created_at, updated_at) " +
        "VALUES ('exp-1', 'cat-rent', 'cash', 20000, 'إيجار فرع رئيسي', ?, 'active', 'main', ?, datetime('now'), datetime('now'))",
      [today, userId],
    );

    // Replica branch expense: 150 EGP (15,000 minor)
    db.run(
      "INSERT INTO expenses (id, category_id, method_code, amount_minor, description, expense_date, status, branch_id, created_by, created_at, updated_at) " +
        "VALUES ('exp-2', 'cat-rent', 'cash', 15000, 'إيجار فرع نصر', ?, 'active', 'nasr_city', ?, datetime('now'), datetime('now'))",
      [today, userId],
    );

    // 5. Insert attendance:
    // Main branch: 3 visits
    db.run(
      "INSERT INTO attendance (id, member_id, checkin_at, branch_id) VALUES ('att-1', ?, ?, 'main')",
      [mainMemberId, `${today} 09:00:00`],
    );
    db.run(
      "INSERT INTO attendance (id, member_id, checkin_at, branch_id) VALUES ('att-2', ?, ?, 'main')",
      [mainMemberId, `${today} 14:00:00`],
    );
    // Replica branch: 1 visit
    db.run(
      "INSERT INTO attendance (id, member_id, checkin_at, branch_id) VALUES ('att-3', ?, ?, 'nasr_city')",
      [replicaMemberId, `${today} 12:00:00`],
    );

    // ----------------- TEST 1: Consolidated "All Branches" Report -----------------
    const consolidatedReport = getPeriodReport(db, owner, today, today, { branchId: "all" });
    expect(consolidatedReport.revenueMinor).toBe(150000); // 1000 + 500 = 1500 EGP
    expect(consolidatedReport.expensesMinor).toBe(35000); // 200 + 150 = 350 EGP
    expect(consolidatedReport.netResultMinor).toBe(115000); // 1150 EGP
    expect(consolidatedReport.paymentCount).toBe(2);

    // Check byBranch breakdown
    expect(consolidatedReport.byBranch).toHaveLength(2);
    const mainBranchStats = consolidatedReport.byBranch.find((b) => b.branchId === "main");
    const replicaBranchStats = consolidatedReport.byBranch.find((b) => b.branchId === "nasr_city");

    expect(mainBranchStats).toBeDefined();
    expect(mainBranchStats?.revenueMinor).toBe(100000);
    expect(mainBranchStats?.expensesMinor).toBe(20000);
    expect(mainBranchStats?.netResultMinor).toBe(80000);
    expect(mainBranchStats?.paymentCount).toBe(1);

    expect(replicaBranchStats).toBeDefined();
    expect(replicaBranchStats?.revenueMinor).toBe(50000);
    expect(replicaBranchStats?.expensesMinor).toBe(15000);
    expect(replicaBranchStats?.netResultMinor).toBe(35000);
    expect(replicaBranchStats?.paymentCount).toBe(1);

    // ----------------- TEST 2: Filter by Replica Branch (nasr_city) -----------------
    const replicaReport = getPeriodReport(db, owner, today, today, { branchId: "nasr_city" });
    expect(replicaReport.revenueMinor).toBe(50000);
    expect(replicaReport.expensesMinor).toBe(15000);
    expect(replicaReport.netResultMinor).toBe(35000);
    expect(replicaReport.paymentCount).toBe(1);
    expect(replicaReport.detailedPayments.items).toHaveLength(1);
    expect(replicaReport.detailedPayments.items[0].id).toBe("pay-2");
    expect(replicaReport.detailedExpenses.items).toHaveLength(1);
    expect(replicaReport.detailedExpenses.items[0].id).toBe("exp-2");

    // ----------------- TEST 3: Attendance Analytics by Branch -----------------
    const allAttendance = getAttendanceAnalytics(db, owner, { fromKey: today, toKey: today, branchId: "all" });
    expect(allAttendance.visits).toBe(3);

    const replicaAttendance = getAttendanceAnalytics(db, owner, {
      fromKey: today,
      toKey: today,
      branchId: "nasr_city",
    });
    expect(replicaAttendance.visits).toBe(1);
    expect(replicaAttendance.topMembers[0]?.memberId).toBe(replicaMemberId);

    // ----------------- TEST 4: Dashboard Stats & Overview by Branch -----------------
    const allStats = getDashboardStats(db, owner, "all");
    expect(allStats.totalMembers).toBe(2);
    expect(allStats.checkinsToday).toBe(3);

    const replicaStats = getDashboardStats(db, owner, "nasr_city");
    expect(replicaStats.totalMembers).toBe(1);
    expect(replicaStats.checkinsToday).toBe(1);

    const replicaOverview = getDashboardOverview(db, owner, "today", undefined, "nasr_city");
    expect(replicaOverview.members?.totalMembers).toBe(1);
  });
});
