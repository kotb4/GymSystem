import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { createProduct, createSale } from "@/core/services/store.service";
import { createTrainer } from "@/core/services/trainers.service";
import { createPrivateTraining } from "@/core/services/private-training.service";
import {
  openCashSession,
  closeCashSession,
  computeSessionCash,
} from "@/core/services/cash-session.service";
import {
  listMemberDebts,
  payMemberDebt,
  settleMemberDuesBatch,
} from "@/core/services/debts.service";
import {
  hasManagerOverridePin,
  setManagerOverridePin,
  verifyManagerOverride,
} from "@/core/services/manager-override.service";
import { assertDepartmentAccess } from "@/core/services/department";
import { todayKey, nowStamp } from "@/core/dates";
import { AppError } from "@/core/errors";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let receptionMen: ServiceActor;
let receptionWomen: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "GymGate Treasury Challenger",
    ownerFullName: "مالك الخزينة",
    username: "treasury_owner",
    password: "OwnerPassword@2026",
  });
  owner = buildActor(ownerUser);

  const managerUser = await createUser(db, owner, {
    username: "treasury_manager",
    password: "ManagerPassword@2026",
    fullName: "مدير الخزينة",
    roleId: "manager",
    department: "general",
  });
  manager = buildActor(managerUser);

  const menUser = await createUser(db, owner, {
    username: "recep_men_ch2",
    password: "RecepPassword@2026",
    fullName: "موظف رجال",
    roleId: "reception",
    department: "men",
  });
  receptionMen = buildActor(menUser);

  const womenUser = await createUser(db, owner, {
    username: "recep_women_ch2",
    password: "RecepPassword@2026",
    fullName: "موظفة سيدات",
    roleId: "reception",
    department: "women",
  });
  receptionWomen = buildActor(womenUser);
});

describe("Challenger 2 — Adversarial Treasury Concurrency & Integrity Suite", () => {
  // =========================================================================
  // 1. closeCashSession Integrity, Write Lock & Zero Drift
  // =========================================================================
  describe("closeCashSession Atomic Execution & Zero Drift Oracle", () => {
    it("computes session cash from financial_ledger with absolute zero drift under multiple inflows and outflows", async () => {
      const session = await openCashSession(db, owner, {
        box: "gym",
        openingBalanceMinor: 100_000, // 1000 EGP
      });
      expect(session.status).toBe("open");

      // Inflow 1: Member payment 500 EGP cash
      const member1 = await createMember(db, owner, { fullName: "عضو خزينة 1", department: "men" });
      const plan1 = await createPlan(db, owner, { name: "خطة 1", durationDays: 30, price: 500 });
      const sub1 = await createSubscription(db, owner, { memberId: member1.id, planId: plan1.id });
      await recordPayment(db, owner, {
        memberId: member1.id,
        subscriptionId: sub1.id,
        baseAmountMinor: 50_000,
        paidAmountMinor: 50_000,
        methodCode: "cash",
      });

      // Inflow 2: Member payment 350 EGP cash
      const member2 = await createMember(db, owner, { fullName: "عضو خزينة 2", department: "men" });
      const plan2 = await createPlan(db, owner, { name: "خطة 2", durationDays: 30, price: 350 });
      const sub2 = await createSubscription(db, owner, { memberId: member2.id, planId: plan2.id });
      await recordPayment(db, owner, {
        memberId: member2.id,
        subscriptionId: sub2.id,
        baseAmountMinor: 35_000,
        paidAmountMinor: 35_000,
        methodCode: "cash",
      });

      // Outflow 1: Expense 120 EGP cash
      const { createCategory, createExpense } = await import("@/core/services/expenses.service");
      const cat = createCategory(db, owner, "مصروفات عامة");
      await createExpense(db, owner, {
        categoryId: cat.id,
        amountMinor: 12_000,
        description: "شراء أدوات نظافة",
        methodCode: "cash",
        box: "gym",
      });

      // Expected balance = 100000 + 50000 + 35000 - 12000 = 173000 minor (1730 EGP)
      const ledgerTotals = computeSessionCash(db, session.openedAt, nowStamp(), "gym");
      expect(ledgerTotals.cashInMinor).toBe(85_000);
      expect(ledgerTotals.cashOutMinor).toBe(12_000);

      // Close session with exact counted balance
      const closedExact = await closeCashSession(db, owner, session.id, 173_000, "إغلاق مطابق تماماً");
      expect(closedExact.status).toBe("closed");
      expect(closedExact.expectedClosingMinor).toBe(173_000);
      expect(closedExact.countedClosingMinor).toBe(173_000);
      expect(closedExact.differenceMinor).toBe(0);

      // Verify DB row matches
      const dbRow = db.first<{
        expected_closing_minor: number;
        counted_closing_minor: number;
        difference_minor: number;
        status: string;
      }>("SELECT expected_closing_minor, counted_closing_minor, difference_minor, status FROM cash_sessions WHERE id = ?", [session.id]);
      expect(dbRow?.status).toBe("closed");
      expect(dbRow?.expected_closing_minor).toBe(173_000);
      expect(dbRow?.counted_closing_minor).toBe(173_000);
      expect(dbRow?.difference_minor).toBe(0);

      // Verify audit trail
      const auditRows = db.all<{ action: string; metadata: string }>(
        "SELECT action, metadata FROM audit_logs WHERE entity_id = ?",
        [session.id],
      );
      const actions = auditRows.map((a) => a.action);
      expect(actions).toContain("CASH_SESSION_CLOSED");
      expect(actions).not.toContain("CASH_DISCREPANCY"); // Exact match does NOT write CASH_DISCREPANCY
    });

    it("accurately handles deficit (shortage) and logs CASH_DISCREPANCY", async () => {
      const session = await openCashSession(db, owner, {
        box: "gym",
        openingBalanceMinor: 50_000,
      });

      // Counted balance is 40_000 (100 EGP deficit = -10_000 minor)
      const closed = await closeCashSession(db, owner, session.id, 40_000, "عجز 100 جنيه");
      expect(closed.expectedClosingMinor).toBe(50_000);
      expect(closed.countedClosingMinor).toBe(40_000);
      expect(closed.differenceMinor).toBe(-10_000);

      const auditDiscrepancy = db.first<{ action: string; metadata: string }>(
        "SELECT action, metadata FROM audit_logs WHERE entity_id = ? AND action = 'CASH_DISCREPANCY'",
        [session.id],
      );
      expect(auditDiscrepancy).toBeDefined();
      const meta = JSON.parse(auditDiscrepancy!.metadata);
      expect(meta.differenceMinor).toBe(-10_000);
      expect(meta.expectedMinor).toBe(50_000);
      expect(meta.countedMinor).toBe(40_000);
    });

    it("accurately handles surplus (excess) and logs CASH_DISCREPANCY", async () => {
      const session = await openCashSession(db, owner, {
        box: "store",
        openingBalanceMinor: 20_000,
      });

      // Counted balance is 25_000 (50 EGP surplus = +5_000 minor)
      const closed = await closeCashSession(db, owner, session.id, 25_000, "زيادة 50 جنيه");
      expect(closed.differenceMinor).toBe(5_000);

      const auditDiscrepancy = db.first<{ action: string }>(
        "SELECT action FROM audit_logs WHERE entity_id = ? AND action = 'CASH_DISCREPANCY'",
        [session.id],
      );
      expect(auditDiscrepancy).toBeDefined();
    });

    it("rejects negative counted balance or unclosed session re-close attempts", async () => {
      const session = await openCashSession(db, owner, {
        box: "gym",
        openingBalanceMinor: 10_000,
      });

      // Counted balance < 0 must be rejected
      await expect(closeCashSession(db, owner, session.id, -500)).rejects.toMatchObject({
        messageKey: "errors.finance.invalidCounted",
      });

      // Close normally
      await closeCashSession(db, owner, session.id, 10_000);

      // Re-close must be rejected with conflict
      await expect(closeCashSession(db, owner, session.id, 10_000)).rejects.toMatchObject({
        messageKey: "errors.finance.sessionAlreadyClosed",
      });
    });

    it("enforces strict session opener ownership: non-opener non-owner cannot close", async () => {
      const session = await openCashSession(db, receptionMen, {
        box: "gym",
        openingBalanceMinor: 10_000,
      });

      // receptionWomen cannot close session opened by receptionMen
      await expect(closeCashSession(db, receptionWomen, session.id, 10_000)).rejects.toMatchObject({
        messageKey: "errors.finance.sessionOpenerOnlyCanClose",
      });

      // Owner CAN close any session
      const closedByOwner = await closeCashSession(db, owner, session.id, 10_000);
      expect(closedByOwner.status).toBe("closed");
      expect(closedByOwner.closedById).toBe(owner.userId);
    });
  });

  // =========================================================================
  // 2. settleMemberDuesBatch 100% Atomicity & Adversarial Rollback Stress
  // =========================================================================
  describe("settleMemberDuesBatch Multi-Debt Atomicity & Rollback Oracle", () => {
    it("settles 3 distinct debt streams (subscription + store + private training) in a single atomic transaction", async () => {
      const member = await createMember(db, owner, { fullName: "مشترك متعدد الديون", department: "men" });

      // 1. Subscription Debt: 600 EGP price, paid 300 EGP -> remaining 300 EGP (30_000 minor)
      const plan = await createPlan(db, owner, { name: "خطة ديون", durationDays: 30, price: 600 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 60_000,
        paidAmountMinor: 30_000,
        methodCode: "cash",
      });

      // 2. Store Credit Debt: 250 EGP credit sale -> remaining 250 EGP (25_000 minor)
      const prod = await createProduct(db, owner, {
        name: "مشروب طاقة",
        costMinor: 10_000,
        priceMinor: 25_000,
        stockQty: 20,
      });
      const sale = await createSale(db, owner, {
        memberId: member.id,
        items: [{ productId: prod.id, qty: 1 }],
        isCredit: true,
        methodCode: "cash",
        paidAmountMinor: 0,
      });
      const storeDebt = db.first<{ id: string }>("SELECT id FROM store_debts WHERE sale_id = ?", [sale.id])!;

      // 3. Private Training Debt: 1000 EGP price, paid 400 EGP -> remaining 600 EGP (60_000 minor)
      const trainer = await createTrainer(db, owner, { fullName: "كابتن أحمد", phone: "01011112222" });
      const pt = createPrivateTraining(db, owner, {
        memberId: member.id,
        trainerId: trainer.id,
        totalSessions: 12,
        priceMinor: 100_000,
        paidAmountMinor: 40_000,
        methodCode: "cash",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });

      // Verify listMemberDebts shows all 3 debts
      const initialDebts = listMemberDebts(db, owner);
      const memberDebts = initialDebts.items.filter((d) => d.memberId === member.id);
      expect(memberDebts).toHaveLength(3);
      const initialTotalRemaining = memberDebts.reduce((sum, d) => sum + d.remainingAmountMinor, 0);
      expect(initialTotalRemaining).toBe(30_000 + 25_000 + 60_000); // 115_000 minor

      const ledgerCountBefore = db.count("SELECT COUNT(*) FROM financial_ledger");

      // Batch settle all 3 debts in 1 atomic call
      const batchResult = settleMemberDuesBatch(db, owner, {
        memberId: member.id,
        methodCode: "cash",
        notes: "سداد مجمع لجميع الديون",
        items: [
          { debtType: "subscription", debtId: sub.id, amountMinor: 30_000 },
          { debtType: "store", debtId: storeDebt.id, amountMinor: 25_000 },
          { debtType: "private_training", debtId: pt.id, amountMinor: 60_000 },
        ],
      });

      expect(batchResult.settledCount).toBe(3);
      expect(batchResult.totalPaidMinor).toBe(115_000);
      expect(batchResult.items).toHaveLength(3);

      // Verify all debts for member are now ZERO
      const remainingDebts = listMemberDebts(db, owner).items.filter((d) => d.memberId === member.id);
      expect(remainingDebts).toHaveLength(0);

      // Verify exactly 3 ledger entries were appended
      const ledgerCountAfter = db.count("SELECT COUNT(*) FROM financial_ledger");
      expect(ledgerCountAfter).toBe(ledgerCountBefore + 3);

      // Verify correct box attribution in ledger
      const subLedger = db.first<{ box: string }>(
        "SELECT box FROM financial_ledger WHERE ref_table = 'payments' AND member_id = ? ORDER BY id DESC LIMIT 1",
        [member.id],
      );
      expect(subLedger?.box).toBe("gym");

      const storeLedger = db.first<{ box: string }>(
        "SELECT box FROM financial_ledger WHERE ref_table = 'store_debts' AND member_id = ? ORDER BY id DESC LIMIT 1",
        [member.id],
      );
      expect(storeLedger?.box).toBe("store");
    });

    it("guarantees 100% all-or-nothing rollback when an invalid debt ID fails at the end of the batch", async () => {
      const member = await createMember(db, owner, { fullName: "مشترك تراجع فشل المعرف", department: "men" });

      const plan = await createPlan(db, owner, { name: "خطة تراجع", durationDays: 30, price: 400 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 40_000,
        paidAmountMinor: 20_000,
        methodCode: "cash",
      });

      const paymentsCountBefore = db.count("SELECT COUNT(*) FROM payments WHERE subscription_id = ?", [sub.id]);
      const ledgerCountBefore = db.count("SELECT COUNT(*) FROM financial_ledger");

      // Batch has valid item 1, but completely non-existent debt ID in item 2
      expect(() =>
        settleMemberDuesBatch(db, owner, {
          memberId: member.id,
          methodCode: "cash",
          items: [
            { debtType: "subscription", debtId: sub.id, amountMinor: 20_000 },
            { debtType: "store", debtId: "totally-bogus-store-debt-id", amountMinor: 5_000 },
          ],
        }),
      ).toThrow();

      // EMPIRICAL VERIFICATION: Zero mutation occurred
      const paymentsCountAfter = db.count("SELECT COUNT(*) FROM payments WHERE subscription_id = ?", [sub.id]);
      expect(paymentsCountAfter).toBe(paymentsCountBefore);

      const ledgerCountAfter = db.count("SELECT COUNT(*) FROM financial_ledger");
      expect(ledgerCountAfter).toBe(ledgerCountBefore);

      const remainingDebt = listMemberDebts(db, owner).items.find((d) => d.debtId === sub.id);
      expect(remainingDebt?.paidAmountMinor).toBe(20_000);
      expect(remainingDebt?.remainingAmountMinor).toBe(20_000);
    });

    it("guarantees 100% all-or-nothing rollback when overpayment occurs on the 3rd item in a 3-item batch", async () => {
      const member = await createMember(db, owner, { fullName: "مشترك تراجع فائض", department: "men" });

      // Item 1: Sub debt (200 EGP debt)
      const plan = await createPlan(db, owner, { name: "خطة 1", durationDays: 30, price: 500 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 50_000,
        paidAmountMinor: 30_000,
        methodCode: "cash",
      });

      // Item 2: Store debt (100 EGP debt)
      const prod = await createProduct(db, owner, {
        name: "عصير بروتين",
        costMinor: 5_000,
        priceMinor: 10_000,
        stockQty: 10,
      });
      const sale = await createSale(db, owner, {
        memberId: member.id,
        items: [{ productId: prod.id, qty: 1 }],
        isCredit: true,
        methodCode: "cash",
        paidAmountMinor: 0,
      });
      const storeDebt = db.first<{ id: string }>("SELECT id FROM store_debts WHERE sale_id = ?", [sale.id])!;

      // Item 3: PT debt (300 EGP debt)
      const trainer = await createTrainer(db, owner, { fullName: "مدرب تراجع", phone: "01022223333" });
      const pt = createPrivateTraining(db, owner, {
        memberId: member.id,
        trainerId: trainer.id,
        totalSessions: 12,
        priceMinor: 50_000,
        paidAmountMinor: 20_000,
        methodCode: "cash",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });

      const ledgerBefore = db.count("SELECT COUNT(*) FROM financial_ledger");
      const paymentsBefore = db.count("SELECT COUNT(*) FROM payments WHERE member_id = ?", [member.id]);
      const storePaymentsBefore = db.count("SELECT COUNT(*) FROM store_debt_payments WHERE debt_id = ?", [storeDebt.id]);

      // Batch: Item 1 valid (200 EGP), Item 2 valid (100 EGP), Item 3 overpays (500 EGP on 300 EGP debt)
      expect(() =>
        settleMemberDuesBatch(db, owner, {
          memberId: member.id,
          methodCode: "cash",
          items: [
            { debtType: "subscription", debtId: sub.id, amountMinor: 20_000 },
            { debtType: "store", debtId: storeDebt.id, amountMinor: 10_000 },
            { debtType: "private_training", debtId: pt.id, amountMinor: 50_000 }, // Overpay! Only 30_000 owed
          ],
        }),
      ).toThrow();

      // EMPIRICAL VERIFICATION: Everything rolled back!
      expect(db.count("SELECT COUNT(*) FROM financial_ledger")).toBe(ledgerBefore);
      expect(db.count("SELECT COUNT(*) FROM payments WHERE member_id = ?", [member.id])).toBe(paymentsBefore);
      expect(db.count("SELECT COUNT(*) FROM store_debt_payments WHERE debt_id = ?", [storeDebt.id])).toBe(storePaymentsBefore);

      // Verify store debt remaining is still 10_000 and not settled
      const freshStoreDebt = db.first<{ paid_minor: number; status: string }>(
        "SELECT paid_minor, status FROM store_debts WHERE id = ?",
        [storeDebt.id],
      );
      expect(freshStoreDebt?.paid_minor).toBe(0);
      expect(freshStoreDebt?.status).toBe("open");
    });

    it("enforces cross-department isolation: men reception staff cannot batch settle dues for women member", async () => {
      const womenMember = await createMember(db, owner, { fullName: "مشتركة سيدات للخزينة", department: "women" });
      const plan = await createPlan(db, owner, { name: "خطة سيدات", durationDays: 30, price: 300 });
      const sub = await createSubscription(db, owner, { memberId: womenMember.id, planId: plan.id });

      expect(() =>
        settleMemberDuesBatch(db, receptionMen, {
          memberId: womenMember.id,
          methodCode: "cash",
          items: [{ debtType: "subscription", debtId: sub.id, amountMinor: 10_000 }],
        }),
      ).toThrow();
    });
  });

  // =========================================================================
  // 3. Manager Override Authentication, Authorization & Audit Oracle
  // =========================================================================
  describe("Manager Override Authentication & Audit Trail Oracle", () => {
    it("validates PIN configuration: length constraints (4-6 digits) and permissions", () => {
      // Non-owner without settings.edit cannot set PIN
      expect(() => setManagerOverridePin(db, receptionMen, "1234")).toThrow();

      // Invalid lengths or characters rejected
      expect(() => setManagerOverridePin(db, owner, "123")).toThrow();
      expect(() => setManagerOverridePin(db, owner, "1234567")).toThrow();
      expect(() => setManagerOverridePin(db, owner, "abcd")).toThrow();

      // Valid PIN
      setManagerOverridePin(db, owner, "8844");
      expect(hasManagerOverridePin(db)).toBe(true);
    });

    it("authorizes with valid PIN and writes MANAGER_OVERRIDE audit log with full metadata", async () => {
      setManagerOverridePin(db, owner, "4321");

      const result = await verifyManagerOverride(db, receptionMen, {
        pin: "4321",
        reason: "تجاوز استثنائي لصرف مستحقات",
        entityType: "payment",
        entityId: "pay-override-123",
      });

      expect(result.success).toBe(true);
      expect(result.authorizedBy).toBe("treasury_owner");
      expect(result.roleId).toBe("owner");
      expect(result.token).toBeDefined();

      // Check audit log
      const audit = db.first<{
        action: string;
        user_id: string;
        entity_type: string;
        entity_id: string;
        metadata: string;
      }>("SELECT action, user_id, entity_type, entity_id, metadata FROM audit_logs WHERE action = 'MANAGER_OVERRIDE' ORDER BY id DESC LIMIT 1");

      expect(audit).toBeDefined();
      expect(audit!.user_id).toBe(receptionMen.userId);
      expect(audit!.entity_type).toBe("payment");
      expect(audit!.entity_id).toBe("pay-override-123");

      const meta = JSON.parse(audit!.metadata);
      expect(meta.authorizedBy).toBe("treasury_owner");
      expect(meta.managerRole).toBe("owner");
      expect(meta.reason).toBe("تجاوز استثنائي لصرف مستحقات");
    });

    it("strictly rejects invalid PIN with errors.managerOverrideInvalidPin", async () => {
      setManagerOverridePin(db, owner, "7777");

      await expect(
        verifyManagerOverride(db, receptionMen, {
          pin: "1111",
          reason: "محاولة بـ PIN خاطئ",
        }),
      ).rejects.toMatchObject({
        messageKey: "errors.managerOverrideInvalidPin",
      });
    });

    it("authorizes fallback with Manager username & password", async () => {
      const result = await verifyManagerOverride(db, receptionMen, {
        username: "treasury_manager",
        password: "ManagerPassword@2026",
        reason: "إذن مباشر من المدير",
        entityType: "member",
        entityId: "mem-xyz",
      });

      expect(result.success).toBe(true);
      expect(result.authorizedBy).toBe("treasury_manager");
      expect(result.roleId).toBe("manager");
      expect(result.token).toBeDefined();
    });

    it("strictly rejects wrong password or unknown username with 401 UNAUTHORIZED", async () => {
      // Wrong password
      await expect(
        verifyManagerOverride(db, receptionMen, {
          username: "treasury_manager",
          password: "WrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });

      // Unknown username
      await expect(
        verifyManagerOverride(db, receptionMen, {
          username: "non_existent_user",
          password: "SomePassword123!",
        }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("strictly rejects non-manager / non-owner credentials with 403 FORBIDDEN", async () => {
      // Receptionist trying to use their own credentials to override
      await expect(
        verifyManagerOverride(db, receptionMen, {
          username: "recep_men_ch2",
          password: "RecepPassword@2026",
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        messageKey: "errors.managerOverrideNotAuthorized",
      });
    });

    it("strictly rejects inactive manager account", async () => {
      const inactiveMgr = await createUser(db, owner, {
        username: "inactive_mgr",
        password: "Password@2026",
        fullName: "مدير غير نشط",
        roleId: "manager",
      });
      db.run("UPDATE users SET is_active = 0 WHERE id = ?", [inactiveMgr.id]);

      await expect(
        verifyManagerOverride(db, receptionMen, {
          username: "inactive_mgr",
          password: "Password@2026",
        }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  // =========================================================================
  // 4. Debounce & Date Filtering Oracle
  // =========================================================================
  describe("Debounce & Cash Sessions Default Date Scope Oracle", () => {
    it("verifies cash sessions listing defaults query scope to todayKey()", async () => {
      const today = todayKey();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Open a session today
      const s = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 10_000 });

      const { listCashSessions } = await import("@/core/services/cash-session.service");
      const resToday = listCashSessions(db, owner, {
        fromKey: today,
        toKey: today,
      });

      expect(resToday.total).toBeGreaterThanOrEqual(1);
      expect(resToday.items.some((item) => item.id === s.id)).toBe(true);

      // Query with yesterday should not include today's session
      const resYesterday = listCashSessions(db, owner, {
        fromKey: "2020-01-01",
        toKey: "2020-01-02",
      });
      expect(resYesterday.items.some((item) => item.id === s.id)).toBe(false);
    });

    it("verifies department access denied parameters for clear localized UI reporting", () => {
      try {
        assertDepartmentAccess(receptionMen, "women");
        expect.fail("Should have thrown forbidden AppError");
      } catch (err: any) {
        expect(err.code).toBe("FORBIDDEN");
        expect(err.messageKey).toBe("errors.departmentAccessDenied");
        expect(err.params).toEqual({
          memberDept: "women",
          userDept: "men",
        });
      }
    });
  });
});
