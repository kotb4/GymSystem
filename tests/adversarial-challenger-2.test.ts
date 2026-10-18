import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  setRolePermissions,
  getRolePermissions,
  loadPermissionsCache,
} from "@/core/services/permissions.service";
import {
  roleHasPermission,
  PERMS,
  ROLE_GRANTS,
  type Permission,
  type ServiceActor,
} from "@/core/permissions";
import {
  createMember,
  getMember,
  updateMember,
  trashMember,
  setMemberStatus,
  listMembers,
  searchMembersForPicker,
} from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  listMemberSubscriptions,
} from "@/core/services/subscriptions.service";
import { recordPayment, refundPayment } from "@/core/services/payments.service";
import {
  createProduct,
  createSale,
  createReturn,
  repayStoreDebt,
  getMemberStoreDebtTotal,
  listStoreDebts,
} from "@/core/services/store.service";
import { createQuickSession } from "@/core/services/quick-session.service";
import {
  createPTPackage,
  createPrivateTraining,
} from "@/core/services/private-training.service";
import { createExpense } from "@/core/services/expenses.service";
import { createTrainer } from "@/core/services/trainers.service";
import {
  createClass,
  createClassSession,
  bookMember,
} from "@/core/services/classes.service";
import { listAssessments } from "@/core/services/inbody.service";
import { getPeriodReport } from "@/core/services/financial-report.service";
import {
  openCashSession,
  closeCashSession,
} from "@/core/services/cash-session.service";
import { listAuditLogs } from "@/core/services/audit.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";

describe("Adversarial Challenger 2 — Deep Edge Case Verification Suite", () => {
  let db: Db;
  let owner: ServiceActor;
  let manager: ServiceActor;
  let menRecep: ServiceActor;
  let womenRecep: ServiceActor;

  beforeEach(async () => {
    db = createTestDb();
    // Register automatic cache refresh on dirty, mirroring production server runtime
    loadPermissionsCache(db);
    db.onDirty(() => loadPermissionsCache(db));

    const ownerUser = await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "مالك النظام",
      username: "owner_challenger",
      password: "Owner@2026",
    });
    owner = buildActor(ownerUser);

    manager = buildActor(
      await createUser(db, owner, {
        username: "manager_adv",
        password: "Manager@2026",
        fullName: "مدير النظام",
        roleId: "manager",
        department: "general",
      }),
    );

    menRecep = buildActor(
      await createUser(db, owner, {
        username: "men_recep_adv",
        password: "Recep@2026",
        fullName: "استقبال رجال",
        roleId: "reception",
        department: "men",
      }),
    );

    womenRecep = buildActor(
      await createUser(db, owner, {
        username: "women_recep_adv",
        password: "Recep@2026",
        fullName: "استقبال سيدات",
        roleId: "reception",
        department: "women",
      }),
    );
  });

  // =========================================================================
  // 1. Role-Permissions Matrix Adversarial Probes
  // =========================================================================
  describe("1. Role-Permissions Matrix & Immutability", () => {
    it("owner immutability: setRolePermissions for owner is a complete no-op and never strips permissions", () => {
      // Attempting to wipe owner permissions via setRolePermissions
      setRolePermissions(db, owner, "owner", []);

      // Verify owner still passes all 126 permissions
      for (const perm of PERMS) {
        expect(roleHasPermission("owner", perm)).toBe(true);
      }
    });

    it("owner immutability: survives direct database sabotage/deletion in role_permissions table", () => {
      // Adversarial attack: direct SQL delete of all owner rows
      db.run("DELETE FROM role_permissions WHERE role_id = 'owner'");

      // Owner role bypasses dbGrants entirely via hardcoded fast-path
      expect(roleHasPermission("owner", "members.purge")).toBe(true);
      expect(roleHasPermission("owner", "settings.edit")).toBe(true);
      expect(roleHasPermission("owner", "users.manage")).toBe(true);
    });

    it("privilege escalation prevention: non-owner manager cannot modify owner role", () => {
      // Manager attempts to modify owner permissions
      setRolePermissions(db, manager, "owner", []);

      // Owner permissions remain fully intact
      expect(roleHasPermission("owner", "settings.edit")).toBe(true);
    });

    it("privilege escalation prevention: manager cannot edit their own role permissions", () => {
      expect(() =>
        setRolePermissions(db, manager, "manager", ["users.manage" as Permission]),
      ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    });

    it("invalid role validation: rejects modifying non-existent or invalid roles", () => {
      expect(() =>
        setRolePermissions(db, owner, "super_admin" as any, ["members.view"]),
      ).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    });

    it("non-existent permissions rejection: rejects invalid strings, empty codes, and SQL injection payloads", () => {
      // Fake permission
      expect(() =>
        setRolePermissions(db, owner, "reception", ["hack.system" as any]),
      ).toThrow(expect.objectContaining({ code: "VALIDATION" }));

      // Empty string permission
      expect(() =>
        setRolePermissions(db, owner, "reception", ["" as any]),
      ).toThrow(expect.objectContaining({ code: "VALIDATION" }));

      // SQL injection attempt
      const sqliPerm = "members.view'); DROP TABLE users; --" as any;
      expect(() =>
        setRolePermissions(db, owner, "reception", [sqliPerm]),
      ).toThrow(expect.objectContaining({ code: "VALIDATION" }));

      // Ensure users table is still intact
      expect(db.count("SELECT COUNT(*) FROM users")).toBeGreaterThan(0);
    });

    it("role grant caching: automatically synchronizes across database writes via db.onDirty", () => {
      // Baseline: reception role does NOT have 'reports.view'
      expect(roleHasPermission("reception", "reports.view")).toBe(false);

      // Current reception perms + new 'reports.view'
      const originalRecepPerms = getRolePermissions(db, owner).reception;
      const updatedPerms: Permission[] = [...originalRecepPerms, "reports.view"];

      // Update role permissions
      setRolePermissions(db, owner, "reception", updatedPerms);

      // Verify that cache refreshed automatically (db.onDirty fired)
      expect(roleHasPermission("reception", "reports.view")).toBe(true);

      // Now revoke 'reports.view'
      setRolePermissions(db, owner, "reception", originalRecepPerms);
      expect(roleHasPermission("reception", "reports.view")).toBe(false);
    });

    it("transaction rollback isolation: aborted transactions do NOT corrupt the permissions cache", () => {
      const originalRecepHasReports = roleHasPermission("reception", "reports.view");

      expect(() => {
        db.transaction(() => {
          db.run(
            "INSERT INTO role_permissions (role_id, permission_code) VALUES ('reception', 'reports.view')",
          );
          // Simulate an unexpected failure causing rollback
          throw new Error("Simulated transaction crash");
        });
      }).toThrow("Simulated transaction crash");

      // Verify permissions cache did NOT register uncommitted changes
      expect(roleHasPermission("reception", "reports.view")).toBe(originalRecepHasReports);
    });
  });

  // =========================================================================
  // 2. Department Scoping Boundaries Adversarial Probes
  // =========================================================================
  describe("2. Department Scoping Boundaries", () => {
    it("strictly isolates women-section member records from men-section staff", async () => {
      const womenMember = await createMember(db, owner, {
        fullName: "سارة محمود",
        phone: "01099998888",
        department: "women",
      });

      const plan = await createPlan(db, owner, {
        name: "اشتراك سيدات",
        durationDays: 30,
        price: 500,
      });

      const womenSub = await createSubscription(db, owner, {
        memberId: womenMember.id,
        planId: plan.id,
      });

      // 1. Direct Read Protection
      expect(() => getMember(db, menRecep, womenMember.id)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );

      // 2. Mutation Protection (Update)
      await expect(
        updateMember(db, menRecep, womenMember.id, { notes: "محاولة تعديل" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // 3. Status Change Protection
      await expect(
        setMemberStatus(db, menRecep, womenMember.id, "suspended"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // 4. Soft Delete Protection (trashMember)
      await expect(
        trashMember(db, menRecep, womenMember.id, "محاولة حذف"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // 5. Payment Recording Protection
      await expect(
        recordPayment(db, menRecep, {
          memberId: womenMember.id,
          subscriptionId: womenSub.id,
          baseAmountMinor: 50_000,
          paidAmountMinor: 50_000,
          methodCode: "cash",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // 6. Subscriptions List Protection
      expect(() => listMemberSubscriptions(db, menRecep, womenMember.id)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );

      // 7. Store Debt Protection
      expect(() => getMemberStoreDebtTotal(db, menRecep, womenMember.id)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );

      // 8. InBody Assessment Protection
      expect(() => listAssessments(db, menRecep, womenMember.id)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );

      // 9. Class Booking Protection
      const cls = await createClass(db, owner, { name: "زومبا", capacity: 15 });
      const session = await createClassSession(db, owner, cls.id, {
        sessionDate: todayKey(),
        startTime: "17:00",
      });
      await expect(
        bookMember(db, menRecep, { sessionId: session.id, memberId: womenMember.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // 10. Reception Picker Isolation
      const pickerResults = searchMembersForPicker(db, menRecep, "سارة");
      expect(pickerResults.some((m) => m.id === womenMember.id)).toBe(false);

      // 11. Member Listing Isolation
      const memberList = listMembers(db, menRecep, { department: "women" });
      expect(memberList.items.some((m) => m.id === womenMember.id)).toBe(false);
      expect(memberList.total).toBe(0);
    });

    it("permits men-section staff to access general and men department records", async () => {
      const menMember = await createMember(db, owner, {
        fullName: "طارق سليم",
        phone: "01077776666",
        department: "men",
      });

      const generalMember = await createMember(db, owner, {
        fullName: "كريم سامي",
        phone: "01055554444",
        department: "general",
      });

      // Men receptionist can read men member
      expect(getMember(db, menRecep, menMember.id).id).toBe(menMember.id);

      // Men receptionist can read general member
      expect(getMember(db, menRecep, generalMember.id).id).toBe(generalMember.id);

      // Search picker surfaces both
      const menFound = searchMembersForPicker(db, menRecep, "طارق");
      expect(menFound.some((m) => m.id === menMember.id)).toBe(true);

      const genFound = searchMembersForPicker(db, menRecep, "كريم");
      expect(genFound.some((m) => m.id === generalMember.id)).toBe(true);
    });

    it("probes department self-lockout if a staff updates a record to another department", async () => {
      const menMember = await createMember(db, owner, {
        fullName: "ماجد سامي",
        phone: "01044443333",
        department: "men",
      });

      // Men receptionist updates the department to women
      await updateMember(db, menRecep, menMember.id, {
        department: "women" as any,
      });

      // Verification: Now that the member is in the women department, men receptionist is immediately locked out!
      expect(() => getMember(db, menRecep, menMember.id)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
      await expect(
        updateMember(db, menRecep, menMember.id, { notes: "محاولة اختراق أخرى" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // =========================================================================
  // 3. Reports Calculations & Mathematical Consistency
  // =========================================================================
  describe("3. Reports Calculations, 5 Revenue Streams & Cash Box", () => {
    it("probes exact mathematical consistency across 5 revenue streams, COGS, refunds, and net margin", async () => {
      const today = todayKey();
      const now = `${today} 12:00:00`;

      // --- Stream 1: Subscriptions (1,000 EGP = 100,000 minor) ---
      const member1 = await createMember(db, owner, {
        fullName: "أحمد إبراهيم",
        phone: "01011112222",
      });
      const plan = await createPlan(db, owner, {
        name: "اشتراك عام",
        durationDays: 30,
        price: 1000,
      });
      const sub = await createSubscription(db, owner, {
        memberId: member1.id,
        planId: plan.id,
      });
      const payment1 = await recordPayment(db, owner, {
        memberId: member1.id,
        subscriptionId: sub.id,
        baseAmountMinor: 100_000,
        paidAmountMinor: 100_000,
        methodCode: "cash",
        paidAt: now,
      });

      // --- Stream 2: Store Cash Sales (200 EGP = 20,000 minor, COGS 120 EGP = 12,000 minor) ---
      const product = await createProduct(db, owner, {
        name: "بروتين شيك",
        costMinor: 6_000,
        priceMinor: 10_000,
        stockQty: 50,
      });
      const sale = await createSale(db, owner, {
        items: [{ productId: product.id, qty: 2 }],
        methodCode: "cash",
        isCredit: false,
      });

      // --- Stream 3: Store Credit Sale & Debt Repayment (100 EGP = 10,000 minor) ---
      const creditSale = await createSale(db, owner, {
        items: [{ productId: product.id, qty: 1 }], // 10,000 minor
        methodCode: "cash",
        isCredit: true,
        memberId: member1.id,
      });
      const debts = listStoreDebts(db, owner, { memberId: member1.id });
      const openDebt = debts.items.find((d) => d.saleNo === creditSale.saleNo)!;
      await repayStoreDebt(db, owner, {
        debtId: openDebt.id,
        amountMinor: 10_000,
        methodCode: "cash",
      });

      // --- Stream 4: Quick Sessions / Day Pass (50 EGP = 5,000 minor) ---
      await createQuickSession(db, owner, {
        clientType: "guest",
        sessionName: "تذكرة دخول يومي",
        priceMinor: 5_000,
        paidAmountMinor: 5_000,
        guestName: "زائر تجربة",
        guestPhone: "01033334444",
        methodCode: "cash",
      });

      // --- Stream 5: Private Training Packages (600 EGP = 60,000 minor) ---
      const trainer = await createTrainer(db, owner, {
        fullName: "كابتن وحيد",
        phone: "01088889999",
      });
      const ptPkg = await createPTPackage(db, owner, {
        name: "باقة 10 حصص",
        sessionsCount: 10,
        durationDays: 30,
        priceMinor: 60_000,
      });
      await createPrivateTraining(db, owner, {
        memberId: member1.id,
        trainerId: trainer.id,
        packageId: ptPkg.id,
        totalSessions: 10,
        priceMinor: 60_000,
        paidAmountMinor: 60_000,
        methodCode: "cash",
        startDate: today,
        endDate: today,
      });

      // --- Deductions: Refunds & Returns ---
      // 1. Partial subscription refund of 100 EGP (10,000 minor)
      await refundPayment(db, owner, {
        paymentId: payment1.id,
        amountMinor: 10_000,
        reason: "استرجاع جزئي",
      });

      // 2. Store Return of 1 item from cash sale (100 EGP = 10,000 minor)
      await createReturn(db, owner, {
        saleId: sale.id,
        items: [{ saleItemId: sale.items[0].id, qty: 1 }],
        reason: "مرتجع كافيتيريا",
      });

      // --- Operating Expenses: Total 800 EGP (80,000 minor) ---
      await createExpense(db, owner, {
        categoryId: "salaries",
        amountMinor: 50_000,
        name: "رواتب المدربين",
        methodCode: "cash",
      });
      await createExpense(db, owner, {
        categoryId: "rent_utilities",
        amountMinor: 30_000,
        name: "فاتورة الكهرباء والمياه",
        methodCode: "cash",
      });

      // --- Execute Period Financial Report ---
      const report = getPeriodReport(db, owner, today, today);
      const inc = report.incomeStatement;

      // 1. Invariant: 5 Revenue Streams Exact Match
      expect(inc.subscriptionsRevenueMinor).toBe(100_000);
      expect(inc.storeSalesRevenueMinor).toBe(20_000);
      expect(inc.storeDebtRepaymentsMinor).toBe(10_000);
      expect(inc.quickSessionsRevenueMinor).toBe(5_000);
      expect(inc.privateTrainingRevenueMinor).toBe(60_000);

      // Total Gross Revenue: 100,000 + 20,000 + 10,000 + 5,000 + 60,000 = 195,000 minor
      const expectedGrossRevenue = 100_000 + 20_000 + 10_000 + 5_000 + 60_000;
      expect(inc.totalRevenueMinor).toBe(expectedGrossRevenue);
      expect(report.revenueMinor).toBe(expectedGrossRevenue);

      // 2. Invariant: COGS and Refunds Deductions
      // COGS on 2 sold items: 12,000 minor
      expect(inc.cogsMinor).toBe(12_000);
      expect(inc.refundsMinor).toBe(10_000);
      expect(inc.returnsMinor).toBe(10_000);

      // Gross Profit = 195,000 - 12,000 (COGS) - 10,000 (refunds) - 10,000 (returns) = 163,000 minor
      const expectedGrossProfit = expectedGrossRevenue - 12_000 - 10_000 - 10_000;
      expect(inc.grossProfitMinor).toBe(expectedGrossProfit);

      // Gross Margin Percent = Math.round((163,000 / 195,000) * 100) = 84%
      expect(inc.grossMarginPercent).toBe(Math.round((expectedGrossProfit / expectedGrossRevenue) * 100));

      // 3. Invariant: Operating Expenses and Net Profit
      expect(inc.salariesExpensesMinor).toBe(50_000);
      expect(inc.rentUtilitiesExpensesMinor).toBe(30_000);
      expect(inc.totalExpensesMinor).toBe(80_000);

      // Net Profit = Gross Profit (163,000) - Total Expenses (80,000) = 83,000 minor
      const expectedNetProfit = expectedGrossProfit - 80_000;
      expect(inc.netProfitMinor).toBe(expectedNetProfit);

      // Net Margin Percent = Math.round((83,000 / 195,000) * 100) = 43%
      expect(inc.netMarginPercent).toBe(Math.round((expectedNetProfit / expectedGrossRevenue) * 100));
    });

    it("cash-box discrepancy reconciliation: exact, shortage, surplus, and negative expected protection", async () => {
      // Create a dedicated db instance for clean shift lifecycle isolation
      const shiftDb = createTestDb();
      const shiftOwnerUser = await setup(shiftDb, {
        gymName: "Yassen Mohamed Kotb | 01288536381",
        ownerFullName: "مالك الورديات",
        username: "shift_owner",
        password: "Owner@2026",
      });
      const shiftOwner = buildActor(shiftOwnerUser);

      // Case A: Exact Count Closing (10,000 opening, 10,000 counted -> diff 0)
      const session1 = await openCashSession(shiftDb, shiftOwner, {
        openingBalanceMinor: 10_000,
        box: "gym",
      });
      const closed1 = await closeCashSession(shiftDb, shiftOwner, session1.id, 10_000, "إغلاق مطابق تماماً");
      expect(closed1.expectedClosingMinor).toBe(10_000);
      expect(closed1.countedClosingMinor).toBe(10_000);
      expect(closed1.differenceMinor).toBe(0);

      // Case B: Cash Shortage (-1,500 minor / -15 EGP)
      const session2 = await openCashSession(shiftDb, shiftOwner, {
        openingBalanceMinor: 20_000,
        box: "gym",
      });
      // Counted: 18,500 (Shortage of 1,500)
      const closed2 = await closeCashSession(shiftDb, shiftOwner, session2.id, 18_500, "عجز نقدية");
      expect(closed2.expectedClosingMinor).toBe(20_000);
      expect(closed2.countedClosingMinor).toBe(18_500);
      expect(closed2.differenceMinor).toBe(-1_500);

      // Case C: Cash Surplus (+2,000 minor / +20 EGP)
      const session3 = await openCashSession(shiftDb, shiftOwner, {
        openingBalanceMinor: 10_000,
        box: "gym",
      });
      // Counted: 12,000 (Surplus of 2,000)
      const closed3 = await closeCashSession(shiftDb, shiftOwner, session3.id, 12_000, "زيادة نقدية");
      expect(closed3.expectedClosingMinor).toBe(10_000);
      expect(closed3.countedClosingMinor).toBe(12_000);
      expect(closed3.differenceMinor).toBe(2_000);

      // Case D: Invalid Negative Counted Balance
      const session4 = await openCashSession(shiftDb, shiftOwner, {
        openingBalanceMinor: 5_000,
        box: "gym",
      });
      await expect(
        closeCashSession(shiftDb, shiftOwner, session4.id, -100, "رقم سالب غير منطقي"),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  // =========================================================================
  // 4. Structured Audit Logging Verification
  // =========================================================================
  describe("4. Structured Audit Logging for Critical Actions", () => {
    it("shift closing & cash discrepancy: emits CASH_SESSION_CLOSED and CASH_DISCREPANCY with structured metadata", async () => {
      const session = await openCashSession(db, owner, {
        openingBalanceMinor: 10_000,
        box: "gym",
      });

      // Close with a 500 minor discrepancy (expected 10,000, counted 10,500)
      await closeCashSession(db, owner, session.id, 10_500, "إغلاق مع زيادة");

      const logs = listAuditLogs(db, owner, { pageSize: 50 });

      // Verify CASH_SESSION_CLOSED
      const closeLog = logs.items.find(
        (l) => l.action === "CASH_SESSION_CLOSED" && l.entityId === session.id,
      );
      expect(closeLog).toBeDefined();
      expect(closeLog!.entityType).toBe("cash_session");
      expect(closeLog!.metadata).toMatchObject({
        expectedMinor: 10_000,
        countedMinor: 10_500,
      });

      // Verify CASH_DISCREPANCY
      const discLog = logs.items.find(
        (l) => l.action === "CASH_DISCREPANCY" && l.entityId === session.id,
      );
      expect(discLog).toBeDefined();
      expect(discLog!.metadata).toMatchObject({
        differenceMinor: 500,
        expectedMinor: 10_000,
        countedMinor: 10_500,
      });
    });

    it("debt repayment: emits STORE_DEBT_REPAID with structured amountMinor metadata", async () => {
      const member = await createMember(db, owner, {
        fullName: "حسام ناصر",
        phone: "01066667777",
      });
      const prod = await createProduct(db, owner, {
        name: "عصير طازج",
        costMinor: 1_500,
        priceMinor: 2_500,
        stockQty: 20,
      });

      const sale = await createSale(db, owner, {
        items: [{ productId: prod.id, qty: 2 }], // 5,000 minor
        methodCode: "cash",
        isCredit: true,
        memberId: member.id,
      });

      const debt = listStoreDebts(db, owner, { memberId: member.id }).items[0];
      await repayStoreDebt(db, owner, {
        debtId: debt.id,
        amountMinor: 5_000,
        methodCode: "cash",
      });

      const logs = listAuditLogs(db, owner, { action: "STORE_DEBT_REPAID" });
      const repayLog = logs.items.find((l) => l.entityId === debt.id);
      expect(repayLog).toBeDefined();
      expect(repayLog!.entityType).toBe("store_debt");
      expect(repayLog!.metadata).toMatchObject({
        amountMinor: 5_000,
      });
    });

    it("permission toggles: emits SETTINGS_UPDATED on role with count metadata", () => {
      const recepPerms = getRolePermissions(db, owner).reception;
      setRolePermissions(db, owner, "reception", recepPerms);

      const logs = listAuditLogs(db, owner, { action: "SETTINGS_UPDATED" });
      const permLog = logs.items.find(
        (l) => l.entityType === "role" && l.entityId === "reception",
      );
      expect(permLog).toBeDefined();
      expect(permLog!.metadata).toMatchObject({
        count: recepPerms.length,
      });
    });

    it("member status changes: emits MEMBER_STATUS_CHANGED and MEMBER_ARCHIVED with from/to metadata", async () => {
      const member = await createMember(db, owner, {
        fullName: "رامي خليل",
        phone: "01099991122",
      });

      // 1. Change status from active to suspended
      await setMemberStatus(db, owner, member.id, "suspended");

      const logs1 = listAuditLogs(db, owner, { action: "MEMBER_STATUS_CHANGED" });
      const suspendLog = logs1.items.find((l) => l.entityId === member.id);
      expect(suspendLog).toBeDefined();
      expect(suspendLog!.entityType).toBe("member");
      expect(suspendLog!.metadata).toMatchObject({
        from: "active",
        to: "suspended",
      });

      // 2. Change status to archived
      await setMemberStatus(db, owner, member.id, "archived");

      const logs2 = listAuditLogs(db, owner, { action: "MEMBER_ARCHIVED" });
      const archiveLog = logs2.items.find((l) => l.entityId === member.id);
      expect(archiveLog).toBeDefined();
      expect(archiveLog!.entityType).toBe("member");
      expect(archiveLog!.metadata).toMatchObject({
        from: "suspended",
        to: "archived",
      });
    });
  });
});
