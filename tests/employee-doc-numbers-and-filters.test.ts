import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { setup, buildActor } from "@/core/services/auth.service";
import { createUser, listUsers } from "@/core/services/users.service";
import { nextDocNo, assignDocNo, searchByDocNo } from "@/core/services/document-numbers.service";
import { recordPayment } from "@/core/services/payments.service";
import { createSale } from "@/core/services/store.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { getPeriodReport } from "@/core/services/financial-report.service";

describe("Employee Codes in Reference Numbers and Financial Filters", () => {
  it("assigns sequential user_code (U1, U2, ...) on setup and createUser", async () => {
    const db = createTestDb();

    // 1. Initial setup creates owner with user_code U1
    const owner = await setup(db, {
      gymName: "Hero Gym",
      ownerFullName: "Owner Yassen",
      username: "owner1",
      password: "Password123",
    });
    expect(owner.userCode).toBe("U1");

    const ownerActor = buildActor({
      userId: owner.id,
      username: owner.username,
      roleId: "owner",
    });

    // 2. Create second user (Manager) -> gets U2
    const manager = await createUser(db, ownerActor, {
      username: "manager1",
      password: "Password123",
      fullName: "Manager Ahmed",
      roleId: "manager",
    });
    expect(manager.userCode).toBe("U2");

    // 3. Create third user (Receptionist) with custom userCode -> gets E3 or custom code
    const receptionist = await createUser(db, ownerActor, {
      username: "reception1",
      password: "Password123",
      fullName: "Reception Ali",
      roleId: "reception",
      userCode: "R1",
    });
    expect(receptionist.userCode).toBe("R1");

    // 4. Create fourth user without custom code -> gets U3 (sequential)
    const trainer = await createUser(db, ownerActor, {
      username: "trainer1",
      password: "Password123",
      fullName: "Trainer Sam",
      roleId: "trainer",
    });
    expect(trainer.userCode).toBe("U3");

    // 5. listUsers returns all roles with their user codes
    const allUsers = listUsers(db, ownerActor);
    expect(allUsers).toHaveLength(4);
    expect(allUsers.map((u) => u.userCode)).toEqual(["U1", "U2", "R1", "U3"]);
  });

  it("mints document numbers containing branch prefix and employee code", async () => {
    const db = createTestDb();

    // Configure local branch prefix
    db.run("UPDATE branch_info SET branch_prefix = 'B1'");

    const owner = await setup(db, {
      gymName: "Hero Gym",
      ownerFullName: "Owner Yassen",
      username: "owner1",
      password: "Password123",
    });
    const ownerActor = buildActor(owner);

    const manager = await createUser(db, ownerActor, {
      username: "manager1",
      password: "Password123",
      fullName: "Manager Ahmed",
      roleId: "manager",
    });
    const managerActor = buildActor(manager);

    // Owner records nextDocNo
    const docNoOwner = nextDocNo(db, "payment", "2026-10-11 12:00:00", ownerActor);
    expect(docNoOwner).toMatch(/^B1-U1-RCP-2026-\d{6}$/);

    // Manager records nextDocNo
    const docNoManager = nextDocNo(db, "store_sale", "2026-10-11 12:00:00", managerActor);
    expect(docNoManager).toMatch(/^B1-U2-POS-2026-\d{6}$/);
  });

  it("searches reference numbers by full code, without branch, and by sequence", async () => {
    const db = createTestDb();
    db.run("UPDATE branch_info SET branch_prefix = 'B1'");

    const owner = await setup(db, {
      gymName: "Hero Gym",
      ownerFullName: "Owner Yassen",
      username: "owner1",
      password: "Password123",
    });
    const ownerActor = buildActor(owner);

    const member = await createMember(db, ownerActor, {
      fullName: "Mohamed Ali",
      phone: "01011112222",
    });

    const plan = await createPlan(db, ownerActor, {
      name: "Monthly Plan",
      kind: "time",
      durationDays: 30,
      price: 500,
    });

    const sub = await createSubscription(db, ownerActor, {
      memberId: member.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    const payment = await recordPayment(db, ownerActor, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50000,
      paidAmountMinor: 50000,
      methodCode: "cash",
      paidAt: "2026-10-01 10:00:00",
    });

    const receiptNo = assignDocNo(db, "payment", payment.id, payment.paidAt, ownerActor);
    expect(receiptNo).toBeTruthy();
    expect(receiptNo).toMatch(/^B1-U1-RCP-2026-\d{6}$/);

    // 1. Search by full code
    const matchesFull = searchByDocNo(db, ownerActor, receiptNo);
    expect(matchesFull).toHaveLength(1);
    expect(matchesFull[0].rowId).toBe(payment.id);

    // 2. Search without branch: U1-RCP-2026-000001
    const withoutBranch = receiptNo.replace(/^B1-/, "");
    const matchesNoBranch = searchByDocNo(db, ownerActor, withoutBranch);
    expect(matchesNoBranch).toHaveLength(1);
    expect(matchesNoBranch[0].rowId).toBe(payment.id);

    // 3. Search by sequence number
    const seq = receiptNo.split("-").pop()!;
    const matchesSeq = searchByDocNo(db, ownerActor, seq);
    expect(matchesSeq.some((m) => m.rowId === payment.id)).toBe(true);
  });

  it("filters financial reports by specific user (owner, manager, reception)", async () => {
    const db = createTestDb();

    const owner = await setup(db, {
      gymName: "Hero Gym",
      ownerFullName: "Owner Yassen",
      username: "owner1",
      password: "Password123",
    });
    const ownerActor = buildActor(owner);

    const manager = await createUser(db, ownerActor, {
      username: "manager1",
      password: "Password123",
      fullName: "Manager Ahmed",
      roleId: "manager",
    });
    const managerActor = buildActor(manager);

    const member1 = await createMember(db, ownerActor, {
      fullName: "Member One",
      phone: "01000000001",
    });
    const member2 = await createMember(db, managerActor, {
      fullName: "Member Two",
      phone: "01000000002",
    });

    const plan = await createPlan(db, ownerActor, {
      name: "Standard Plan",
      kind: "time",
      durationDays: 30,
      price: 1000,
    });

    const sub1 = await createSubscription(db, ownerActor, {
      memberId: member1.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });
    const sub2 = await createSubscription(db, managerActor, {
      memberId: member2.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    // Owner creates payment of 1000 EGP (100000 minor)
    await recordPayment(db, ownerActor, {
      memberId: member1.id,
      subscriptionId: sub1.id,
      baseAmountMinor: 100000,
      paidAmountMinor: 100000,
      methodCode: "cash",
      paidAt: "2026-10-05 10:00:00",
    });

    // Manager creates payment of 600 EGP (60000 minor)
    await recordPayment(db, managerActor, {
      memberId: member2.id,
      subscriptionId: sub2.id,
      baseAmountMinor: 100000,
      paidAmountMinor: 60000,
      methodCode: "cash",
      paidAt: "2026-10-06 11:00:00",
    });

    // 1. Overall report (no user filter) -> total = 1600 EGP
    const overallReport = getPeriodReport(db, ownerActor, "2026-10-01", "2026-10-31");
    expect(overallReport.revenueMinor).toBe(160000);
    expect(overallReport.paymentCount).toBe(2);

    // 2. Filter by Owner -> revenue = 1000 EGP, count = 1
    const ownerReport = getPeriodReport(db, ownerActor, "2026-10-01", "2026-10-31", {
      userId: owner.id,
    });
    expect(ownerReport.revenueMinor).toBe(100000);
    expect(ownerReport.paymentCount).toBe(1);
    expect(ownerReport.detailedPayments.items[0].createdByName).toBe("Owner Yassen");

    // 3. Filter by Manager -> revenue = 600 EGP, count = 1
    const managerReport = getPeriodReport(db, ownerActor, "2026-10-01", "2026-10-31", {
      userId: manager.id,
    });
    expect(managerReport.revenueMinor).toBe(60000);
    expect(managerReport.paymentCount).toBe(1);
    expect(managerReport.detailedPayments.items[0].createdByName).toBe("Manager Ahmed");
  });
});
