import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember, setMemberStatus, trashMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import {
  recordPayment,
  refundPayment,
  voidPayment,
  getPaymentById,
  insertLedgerEntry,
} from "@/core/services/payments.service";
import {
  openCashSession,
  closeCashSession,
  getOpenCashSession,
  computeSessionCash,
} from "@/core/services/cash-session.service";
import { createExpense, createCategory } from "@/core/services/expenses.service";
import {
  createProductCategory,
  createProduct,
  createSale,
  returnStoreSale,
  getProduct,
  adjustStock,
  repayStoreDebt,
  getSale,
} from "@/core/services/store.service";
import {
  createClass,
  createClassSession,
  bookMember,
  setBookingStatus,
  listBookings,
} from "@/core/services/classes.service";
import { createTrainer } from "@/core/services/trainers.service";
import {
  createPrivateTraining,
  recordPTSession,
  getPrivateTrainingById,
} from "@/core/services/private-training.service";
import {
  recordCheckIn,
  findActiveSubscription,
} from "@/core/services/attendance.service";
import {
  assignCardByBarcode,
  setCardBlocked,
  reportCardLost,
} from "@/core/services/cards.service";
import { checkIn, lookup } from "@/core/services/reception.service";
import { todayKey, addDaysKey, nowStamp } from "@/core/dates";
import { AppError } from "@/core/errors";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;
let manager: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "مالك النظام التجريبي",
    username: "challenger_owner",
    password: "Password@2026",
  });
  owner = buildActor(ownerUser);

  reception = buildActor(
    await createUser(db, owner, {
      username: "reception_stress",
      password: "Password@2026",
      fullName: "موظف الاستقبال التجريبي",
      roleId: "reception",
    }),
  );

  manager = buildActor(
    await createUser(db, owner, {
      username: "manager_stress",
      password: "Password@2026",
      fullName: "مدير الصالة التجريبي",
      roleId: "manager",
    }),
  );
});

describe("CHALLENGER 1: Empirical Adversarial Stress Testing", () => {
  // =========================================================================
  // 1. FINANCIAL CALCULATIONS & LEDGER INTEGRITY
  // =========================================================================
  describe("1. Financial calculations: float, discrepancies, shift closings, refund bounds, ledger uniqueness", () => {
    it("1.1 enforces cash drawer float bounds (validates non-negative integer, rejects negative)", async () => {
      // Zero float is allowed
      const sZero = await openCashSession(db, owner, { openingBalanceMinor: 0, box: "gym" });
      expect(sZero.openingBalanceMinor).toBe(0);
      expect(sZero.status).toBe("open");
      await closeCashSession(db, owner, sZero.id, 0);

      // Positive float
      const sPositive = await openCashSession(db, owner, { openingBalanceMinor: 150000, box: "gym" }); // 1,500 EGP
      expect(sPositive.openingBalanceMinor).toBe(150000);
      await closeCashSession(db, owner, sPositive.id, 150000);

      // Negative float must throw AppError
      let err: AppError | null = null;
      try {
        await openCashSession(db, owner, { openingBalanceMinor: -5000, box: "gym" });
      } catch (e) {
        err = e as AppError;
      }
      expect(err).toBeInstanceOf(AppError);
      expect(err?.messageKey).toBe("errors.finance.invalidAmount");
    });

    it("1.2 accurately calculates positive and negative cash session discrepancies and persists audit logs", async () => {
      // Positive discrepancy (drawer has MORE cash than expected: surplus)
      const s1 = await openCashSession(db, owner, { openingBalanceMinor: 10000, box: "gym" }); // 100 EGP
      // Expected: 10000. Counted: 12500 -> Difference: +2500
      const closed1 = await closeCashSession(db, owner, s1.id, 12500, "فائض نقدية 25 جنيه");
      expect(closed1.expectedClosingMinor).toBe(10000);
      expect(closed1.countedClosingMinor).toBe(12500);
      expect(closed1.differenceMinor).toBe(2500);

      const auditPos = db.first<{ metadata: string }>(
        "SELECT metadata FROM audit_logs WHERE action = 'CASH_DISCREPANCY' AND entity_id = ?",
        [s1.id],
      );
      expect(auditPos).toBeTruthy();
      expect(JSON.parse(auditPos!.metadata).differenceMinor).toBe(2500);

      // Negative discrepancy (drawer has LESS cash than expected: shortage)
      const s2 = await openCashSession(db, owner, { openingBalanceMinor: 20000, box: "gym" }); // 200 EGP
      // Expected: 20000. Counted: 17000 -> Difference: -3000
      const closed2 = await closeCashSession(db, owner, s2.id, 17000, "عجز نقدية 30 جنيه");
      expect(closed2.expectedClosingMinor).toBe(20000);
      expect(closed2.countedClosingMinor).toBe(17000);
      expect(closed2.differenceMinor).toBe(-3000);

      const auditNeg = db.first<{ metadata: string }>(
        "SELECT metadata FROM audit_logs WHERE action = 'CASH_DISCREPANCY' AND entity_id = ?",
        [s2.id],
      );
      expect(auditNeg).toBeTruthy();
      expect(JSON.parse(auditNeg!.metadata).differenceMinor).toBe(-3000);
    });

    it("1.3 handles multiple sequential shift cycles and concurrent dual cash boxes (gym + store)", async () => {
      // Concurrently open Gym drawer and Store drawer
      const gymS1 = await openCashSession(db, owner, { openingBalanceMinor: 5000, box: "gym" });
      const storeS1 = await openCashSession(db, owner, { openingBalanceMinor: 8000, box: "store" });
      expect(gymS1.box).toBe("gym");
      expect(storeS1.box).toBe("store");

      // Attempting to open another session on gym box while open throws conflict
      await expect(openCashSession(db, owner, { openingBalanceMinor: 2000, box: "gym" })).rejects.toThrow();

      // Close gym session
      await closeCashSession(db, owner, gymS1.id, 5000);
      // Store session is still open!
      const storeOpen = getOpenCashSession(db, owner, "store");
      expect(storeOpen?.id).toBe(storeS1.id);

      // Open second gym session (sequential shift)
      const gymS2 = await openCashSession(db, owner, { openingBalanceMinor: 5000, box: "gym" });
      expect(gymS2.id).not.toBe(gymS1.id);

      // Close both
      await closeCashSession(db, owner, gymS2.id, 5000);
      await closeCashSession(db, owner, storeS1.id, 8000);

      // Attempt to close an already closed session throws conflict
      await expect(closeCashSession(db, owner, gymS1.id, 5000)).rejects.toThrow();
    });

    it("1.4 enforces strict refund bounds, prevents over-refunding, negative refunds, and void-after-refund", async () => {
      const member = await createMember(db, owner, { fullName: "عضو استرداد تجريبي", phone: "01099990001" });
      const plan = await createPlan(db, owner, { name: "باقة سنوية", durationDays: 365, price: 1000 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

      const p = await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 100000,
        paidAmountMinor: 100000, // 1,000 EGP
        methodCode: "cash",
      });

      // 1. Over-refund attempt: 100,001 piastres (1 piastre more than paid)
      let errOver: AppError | null = null;
      try {
        await refundPayment(db, owner, p.id, 100001, "استرداد أكبر من المدفوع");
      } catch (e) {
        errOver = e as AppError;
      }
      expect(errOver).toBeInstanceOf(AppError);
      expect(errOver?.messageKey).toBe("errors.finance.refundExceedsPaid");

      // 2. Zero or negative refund attempt
      await expect(refundPayment(db, owner, p.id, 0, "استرداد صفر")).rejects.toThrow();
      await expect(refundPayment(db, owner, p.id, -500, "استرداد سالب")).rejects.toThrow();

      // 3. Partial refund: 400 EGP (40,000 minor)
      const afterP1 = await refundPayment(db, owner, p.id, 40000, "استرداد جزئي أول");
      expect(afterP1.refundedAmountMinor).toBe(40000);

      // 4. Second partial refund: remaining is 60,000. Try 60,001 -> must fail
      await expect(refundPayment(db, owner, p.id, 60001, "استرداد يتجاوز المتبقي")).rejects.toThrow();

      // 5. Exact remaining refund: 60,000 -> succeeds
      const afterP2 = await refundPayment(db, owner, p.id, 60000, "استرداد بقية المبلغ");
      expect(afterP2.refundedAmountMinor).toBe(100000);

      // 6. Further refund attempt when fully refunded -> fails
      await expect(refundPayment(db, owner, p.id, 100, "استرداد بعد الاسترداد الكامل")).rejects.toThrow();

      // 7. Voiding a payment that has refunds -> forbidden/conflict
      let errVoid: AppError | null = null;
      try {
        await voidPayment(db, owner, p.id, "إلغاء دفعة مستردة");
      } catch (e) {
        errVoid = e as AppError;
      }
      expect(errVoid).toBeInstanceOf(AppError);
      expect(errVoid?.messageKey).toBe("errors.finance.voidWithRefunds");
    });

    it("1.5 verifies financial ledger uniqueness constraint prevents duplicate ledger entries", async () => {
      const member = await createMember(db, owner, { fullName: "عضو دفتر الأستاذ", phone: "01099990002" });
      const plan = await createPlan(db, owner, { name: "باقة قياسية", durationDays: 30, price: 300 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

      const p = await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 30000,
        paidAmountMinor: 30000,
        methodCode: "cash",
      });

      // A ledger entry with (ref_table='payments', ref_id=p.id, entry_type='payment') already exists.
      // Attempting to directly insert a duplicate into financial_ledger must fail SQLite UNIQUE constraint.
      expect(() => {
        db.run(
          "INSERT INTO financial_ledger (entry_type, ref_table, ref_id, member_id, method_code, direction, amount_minor, occurred_at, created_by, created_at, box)\nVALUES ('payment', 'payments', ?, ?, 'cash', 1, 30000, ?, ?, ?, 'gym')",
          [p.id, member.id, nowStamp(), owner.userId, nowStamp()],
        );
      }).toThrow(/UNIQUE constraint failed/i);
    });
  });

  // =========================================================================
  // 2. STORE POS & CREDIT SALES
  // =========================================================================
  describe("2. Store POS & Credit sales: boundary conditions, zero price, stock limits, credit, returns", () => {
    it("2.1 handles zero price / 100% discount without arithmetic crash and correctly updates stock", async () => {
      const prod = await createProduct(db, owner, {
        name: "عينة مجانية ترويجية",
        costMinor: 500, // 5 EGP
        priceMinor: 0,   // Free item
        stockQty: 10,
      });

      const sale = await createSale(db, owner, {
        items: [{ productId: prod.id, qty: 3 }],
        methodCode: "cash",
      });

      expect(sale.totalMinor).toBe(0);
      expect(sale.status).toBe("completed");

      // Verify stock decreased from 10 to 7
      const freshProd = getProduct(db, owner, prod.id);
      expect(freshProd.stockQty).toBe(7);

      // Verify no ledger payment entry was created for zero total
      const ledgerCount = db.count(
        "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'store_sales' AND ref_id = ?",
        [sale.id],
      );
      expect(ledgerCount).toBe(0);
    });

    it("2.2 strictly rejects purchases exceeding available stock and handles large quantities", async () => {
      const prod = await createProduct(db, owner, {
        name: "مشروب بروتين طاقة",
        costMinor: 3000,
        priceMinor: 6000,
        stockQty: 5,
      });

      // Buying 6 when only 5 exist -> must throw insufficient stock
      let errStock: AppError | null = null;
      try {
        await createSale(db, owner, {
          items: [{ productId: prod.id, qty: 6 }],
          methodCode: "cash",
        });
      } catch (e) {
        errStock = e as AppError;
      }
      expect(errStock).toBeInstanceOf(AppError);
      expect(errStock?.messageKey).toBe("errors.store.insufficientStock");

      // Huge quantity attempt (1,000,000)
      await expect(
        createSale(db, owner, {
          items: [{ productId: prod.id, qty: 1000000 }],
          methodCode: "cash",
        }),
      ).rejects.toThrow();

      // Buying exactly 5 -> succeeds and stock hits 0
      const sale5 = await createSale(db, owner, {
        items: [{ productId: prod.id, qty: 5 }],
        methodCode: "cash",
      });
      expect(sale5.status).toBe("completed");
      expect(getProduct(db, owner, prod.id).stockQty).toBe(0);

      // Further purchase when stock is 0 -> fails
      await expect(
        createSale(db, owner, {
          items: [{ productId: prod.id, qty: 1 }],
          methodCode: "cash",
        }),
      ).rejects.toThrow();
    });

    it("2.3 enforces member credit sale rules, tracks open debt, and rejects returns on unsettled debt", async () => {
      const prod = await createProduct(db, owner, {
        name: "فيتامينات متعددة",
        costMinor: 8000,
        priceMinor: 15000, // 150 EGP
        stockQty: 10,
      });

      // 1. Credit sale without memberId -> rejected
      let errCreditMember: AppError | null = null;
      try {
        await createSale(db, owner, {
          items: [{ productId: prod.id, qty: 1 }],
          isCredit: true,
          methodCode: "cash",
        });
      } catch (e) {
        errCreditMember = e as AppError;
      }
      expect(errCreditMember).toBeInstanceOf(AppError);
      expect(errCreditMember?.messageKey).toBe("errors.store.creditNeedsMember");

      // 2. Valid credit sale with member
      const member = await createMember(db, owner, { fullName: "عضو أجل تجريبي", phone: "01099990003" });
      const sale = await createSale(db, owner, {
        items: [{ productId: prod.id, qty: 2 }], // 300 EGP total
        isCredit: true,
        memberId: member.id,
        methodCode: "cash",
      });

      expect(sale.isCredit).toBe(true);
      expect(sale.totalMinor).toBe(30000);

      // Verify store_debts created with open status
      const debt = db.first<{ id: string; status: string; original_minor: number; paid_minor: number }>(
        "SELECT id, status, original_minor, paid_minor FROM store_debts WHERE sale_id = ?",
        [sale.id],
      );
      expect(debt).toBeTruthy();
      expect(debt?.status).toBe("open");
      expect(debt?.original_minor).toBe(30000);
      expect(debt?.paid_minor).toBe(0);

      // 3. Attempting to return an unsettled credit sale -> strictly rejected
      const saleDetail = getSale(db, owner, sale.id);
      let errReturnCredit: AppError | null = null;
      try {
        await returnStoreSale(db, owner, {
          saleId: sale.id,
          lines: [{ saleItemId: saleDetail.items[0].id, qty: 1 }],
        });
      } catch (e) {
        errReturnCredit = e as AppError;
      }
      expect(errReturnCredit).toBeInstanceOf(AppError);
      expect(errReturnCredit?.messageKey).toBe("errors.store.returnCreditNotAllowed");

      // 4. Repay debt completely
      await repayStoreDebt(db, owner, {
        debtId: debt!.id,
        amountMinor: 30000,
        methodCode: "cash",
      });

      const settledDebt = db.first<{ status: string; paid_minor: number }>(
        "SELECT status, paid_minor FROM store_debts WHERE id = ?",
        [debt!.id],
      );
      expect(settledDebt?.status).toBe("settled");
      expect(settledDebt?.paid_minor).toBe(30000);

      // 5. Now return is permitted on settled credit sale
      const ret = await returnStoreSale(db, owner, {
        saleId: sale.id,
        lines: [{ saleItemId: saleDetail.items[0].id, qty: 1 }],
        reason: "استرجاع بعد سداد الآجل",
      });
      expect(ret.totalMinor).toBe(15000);
      // Stock restored to 9 (10 - 2 + 1)
      expect(getProduct(db, owner, prod.id).stockQty).toBe(9);
    });

    it("2.4 prevents returning more items than purchased or remaining", async () => {
      const prod = await createProduct(db, owner, {
        name: "شيكر رياضي",
        costMinor: 2000,
        priceMinor: 5000,
        stockQty: 20,
      });

      const sale = await createSale(db, owner, {
        items: [{ productId: prod.id, qty: 3 }],
        methodCode: "cash",
      });
      const saleDetail = getSale(db, owner, sale.id);
      const saleItemId = saleDetail.items[0].id;

      // Returning 4 when only 3 were bought -> fails
      let errExceed: AppError | null = null;
      try {
        await returnStoreSale(db, owner, {
          saleId: sale.id,
          lines: [{ saleItemId, qty: 4 }],
        });
      } catch (e) {
        errExceed = e as AppError;
      }
      expect(errExceed).toBeInstanceOf(AppError);
      expect(errExceed?.messageKey).toBe("errors.store.returnExceedsQty");

      // Return 2 units
      await returnStoreSale(db, owner, {
        saleId: sale.id,
        lines: [{ saleItemId, qty: 2 }],
      });

      // Try returning 2 more (only 1 remaining) -> fails
      await expect(
        returnStoreSale(db, owner, {
          saleId: sale.id,
          lines: [{ saleItemId, qty: 2 }],
        }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 3. CLASS BOOKINGS & PT SESSIONS
  // =========================================================================
  describe("3. Class bookings & PT sessions: capacity ceilings, negative sessions, duplicate bookings", () => {
    it("3.1 enforces strict class capacity ceiling and blocks oversubscription unless overridden", async () => {
      const cls = await createClass(db, owner, {
        name: "حصة كيك بوكسينغ متقدمة",
        capacity: 2, // Ceiling = 2
        consumesSession: false,
      });

      const session = await createClassSession(db, owner, cls.id, {
        sessionDate: addDaysKey(todayKey(), 1), // Tomorrow
        startTime: "18:00",
        durationMin: 60,
      });

      const m1 = await createMember(db, owner, { fullName: "عضو حصة 1", phone: "01099990011" });
      const m2 = await createMember(db, owner, { fullName: "عضو حصة 2", phone: "01099990012" });
      const m3 = await createMember(db, owner, { fullName: "عضو حصة 3", phone: "01099990013" });

      // Book m1 and m2 (fills capacity)
      await bookMember(db, owner, { sessionId: session.id, memberId: m1.id });
      await bookMember(db, owner, { sessionId: session.id, memberId: m2.id });

      // m3 attempts to book without override -> strictly rejected with errors.classFull
      let errFull: AppError | null = null;
      try {
        await bookMember(db, owner, { sessionId: session.id, memberId: m3.id });
      } catch (e) {
        errFull = e as AppError;
      }
      expect(errFull).toBeInstanceOf(AppError);
      expect(errFull?.messageKey).toBe("errors.classFull");

      // Reception cannot override capacity
      await expect(
        bookMember(db, reception, { sessionId: session.id, memberId: m3.id, overrideCapacity: true }),
      ).rejects.toThrow();

      // Manager/Owner CAN override capacity
      const overrideBooking = await bookMember(db, owner, {
        sessionId: session.id,
        memberId: m3.id,
        overrideCapacity: true,
      });
      expect(overrideBooking.status).toBe("booked");
      expect(listBookings(db, owner, session.id).length).toBe(3);
    });

    it("3.2 blocks duplicate bookings for the same member in the same session", async () => {
      const cls = await createClass(db, owner, {
        name: "حصة يوغا استرخاء",
        capacity: 10,
        consumesSession: false,
      });

      const session = await createClassSession(db, owner, cls.id, {
        sessionDate: addDaysKey(todayKey(), 1),
        startTime: "10:00",
        durationMin: 60,
      });

      const m = await createMember(db, owner, { fullName: "عضو حجز مكرر", phone: "01099990021" });

      // First booking succeeds
      await bookMember(db, owner, { sessionId: session.id, memberId: m.id });

      // Second booking attempt must throw duplicate error
      let errDup: AppError | null = null;
      try {
        await bookMember(db, owner, { sessionId: session.id, memberId: m.id });
      } catch (e) {
        errDup = e as AppError;
      }
      expect(errDup).toBeInstanceOf(AppError);
      expect(errDup?.messageKey).toBe("errors.bookingDuplicate");
    });

    it("3.3 enforces PT package session bounds and blocks recording sessions beyond total", async () => {
      const trainer = await createTrainer(db, owner, {
        fullName: "كابتن أحمد مدرب خاص",
        phone: "01099990031",
      });

      const member = await createMember(db, owner, {
        fullName: "متدرب برايفت تجريبي",
        phone: "01099990032",
      });

      // PT package with 2 sessions
      const pt = createPrivateTraining(db, owner, {
        memberId: member.id,
        trainerId: trainer.id,
        totalSessions: 2,
        priceMinor: 50000,
        paidAmountMinor: 50000,
        startDate: todayKey(),
        endDate: addDaysKey(todayKey(), 30),
      });

      expect(pt.total_sessions).toBe(2);
      expect(pt.completed_sessions).toBe(0);
      expect(pt.status).toBe("active");

      // Session 1
      const res1 = recordPTSession(db, owner, { privateTrainingId: pt.id });
      expect(res1.completedSessions).toBe(1);
      expect(res1.remainingSessions).toBe(1);

      // Session 2 -> completes the package
      const res2 = recordPTSession(db, owner, { privateTrainingId: pt.id });
      expect(res2.completedSessions).toBe(2);
      expect(res2.remainingSessions).toBe(0);

      const ptDone = getPrivateTrainingById(db, owner, pt.id);
      expect(ptDone?.status).toBe("completed");

      // Attempting session 3 on exhausted package -> rejected
      let errExhausted: AppError | null = null;
      try {
        recordPTSession(db, owner, { privateTrainingId: pt.id });
      } catch (e) {
        errExhausted = e as AppError;
      }
      expect(errExhausted).toBeInstanceOf(AppError);
      expect(["errors.pt.notActive", "errors.pt.sessionsExhausted"]).toContain(errExhausted?.messageKey);
    });

    it("3.4 rejects invalid PT input: zero or negative sessions, invalid dates", () => {
      const trainer = createTrainer(db, owner, { fullName: "مدرب أخطاء", phone: "01099990039" });
      const member = createMember(db, owner, { fullName: "متدرب أخطاء", phone: "01099990040" });

      // Zero sessions
      expect(() => {
        createPrivateTraining(db, owner, {
          memberId: (member as any).id,
          trainerId: (trainer as any).id,
          totalSessions: 0,
          priceMinor: 10000,
          paidAmountMinor: 10000,
          startDate: todayKey(),
          endDate: addDaysKey(todayKey(), 10),
        });
      }).toThrow();

      // Negative sessions
      expect(() => {
        createPrivateTraining(db, owner, {
          memberId: (member as any).id,
          trainerId: (trainer as any).id,
          totalSessions: -5,
          priceMinor: 10000,
          paidAmountMinor: 10000,
          startDate: todayKey(),
          endDate: addDaysKey(todayKey(), 10),
        });
      }).toThrow();

      // Inverted date range (end before start)
      expect(() => {
        createPrivateTraining(db, owner, {
          memberId: (member as any).id,
          trainerId: (trainer as any).id,
          totalSessions: 10,
          priceMinor: 10000,
          paidAmountMinor: 10000,
          startDate: todayKey(),
          endDate: addDaysKey(todayKey(), -5),
        });
      }).toThrow();
    });
  });

  // =========================================================================
  // 4. RECEPTION BARCODE CHECK-IN
  // =========================================================================
  describe("4. Reception barcode check-in: invalid barcodes, expired subscriptions, blocked members, suppression windows", () => {
    it("4.1 accurately returns CARD_UNKNOWN for non-existent or blank barcodes", async () => {
      const resUnknown = await recordCheckIn(db, owner, { barcode: "UNKNOWN_BARCODE_999999" });
      expect(resUnknown.kind).toBe("denied");
      if (resUnknown.kind === "denied") {
        expect(resUnknown.reason).toBe("CARD_UNKNOWN");
      }

      const resBlank = await recordCheckIn(db, owner, { barcode: "   " });
      expect(resBlank.kind).toBe("denied");
      if (resBlank.kind === "denied") {
        expect(resBlank.reason).toBe("CARD_UNKNOWN");
      }

      // Reception lookup also reflects CARD_UNKNOWN
      const lookupRes = lookup(db, owner, { barcode: "UNKNOWN_BARCODE_999999" });
      expect(lookupRes.eligibility?.eligible).toBe(false);
      expect(lookupRes.eligibility?.reason).toBe("CARD_UNKNOWN");
    });

    it("4.2 rejects expired subscriptions with NO_ACTIVE_SUBSCRIPTION", async () => {
      const member = await createMember(db, owner, { fullName: "عضو باقة منتهية", phone: "01099990051" });
      const plan = await createPlan(db, owner, { name: "باقة قديمة", durationDays: 30, price: 300 });

      // Create subscription that expired yesterday
      const pastStart = addDaysKey(todayKey(), -35);
      const pastEnd = addDaysKey(todayKey(), -5);
      const sub = await createSubscription(db, owner, {
        memberId: member.id,
        planId: plan.id,
        startDate: pastStart,
      });
      // Force end_date into past
      db.run("UPDATE member_subscriptions SET end_date = ? WHERE id = ?", [pastEnd, sub.id]);

      const { card } = await assignCardByBarcode(db, owner, {
        memberId: member.id,
        barcodeValue: "EXP-CARD-0001",
      });

      const res = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
      expect(res.kind).toBe("denied");
      if (res.kind === "denied") {
        expect(res.reason).toBe("NO_ACTIVE_SUBSCRIPTION");
      }
    });

    it("4.3 denies check-in for blocked cards, lost cards, inactive members, and deleted members", async () => {
      const member = await createMember(db, owner, { fullName: "عضو حالات حظر", phone: "01099990061" });
      const plan = await createPlan(db, owner, { name: "باقة فعالة", durationDays: 30, price: 300 });
      await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      const { card } = await assignCardByBarcode(db, owner, {
        memberId: member.id,
        barcodeValue: "BLOCK-TEST-0001",
      });

      // 1. Blocked card
      await setCardBlocked(db, owner, card.id, true);
      const resBlocked = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
      expect(resBlocked.kind).toBe("denied");
      if (resBlocked.kind === "denied") expect(resBlocked.reason).toBe("CARD_BLOCKED");

      // Unblock and test Lost card
      await setCardBlocked(db, owner, card.id, false);
      await reportCardLost(db, owner, card.id);
      const resLost = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
      expect(resLost.kind).toBe("denied");
      if (resLost.kind === "denied") expect(resLost.reason).toBe("CARD_LOST");

      // Assign a fresh valid card
      const { card: freshCard } = await assignCardByBarcode(db, owner, {
        memberId: member.id,
        barcodeValue: "FRESH-CARD-0002",
      });

      // 2. Inactive / Suspended member
      await setMemberStatus(db, owner, member.id, "suspended");
      const resSuspended = await recordCheckIn(db, owner, { barcode: freshCard.barcodeValue });
      expect(resSuspended.kind).toBe("denied");
      if (resSuspended.kind === "denied") expect(resSuspended.reason).toBe("MEMBER_INACTIVE");

      // 3. Deleted member
      await setMemberStatus(db, owner, member.id, "active");
      await trashMember(db, owner, member.id, "حذف تجريبي");
      const resDeleted = await recordCheckIn(db, owner, { barcode: freshCard.barcodeValue });
      expect(resDeleted.kind).toBe("denied");
      if (resDeleted.kind === "denied") expect(resDeleted.reason).toBe("MEMBER_DELETED");
    });

    it("4.4 suppresses rapid duplicate check-in scans within the duplicate window and avoids double session deduction", async () => {
      const member = await createMember(db, owner, { fullName: "عضو تكرار الباركود", phone: "01099990071" });
      // Session-based plan with exactly 5 sessions
      const plan = await createPlan(db, owner, {
        name: "باقة 5 حصص",
        kind: "sessions",
        sessionsCount: 5,
        durationDays: 30,
        price: 500,
      });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      const { card } = await assignCardByBarcode(db, owner, {
        memberId: member.id,
        barcodeValue: "DUP-WINDOW-0001",
      });

      // First check-in: Success! Consumes 1 session.
      const res1 = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
      expect(res1.kind).toBe("success");
      if (res1.kind === "success") {
        expect(res1.sessionsRemaining).toBe(4);
      }

      // Immediate second check-in (same second): Must be suppressed as "duplicate"
      const res2 = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
      expect(res2.kind).toBe("duplicate");
      if (res2.kind === "duplicate") {
        expect(res2.memberName).toBe(member.fullName);
      }

      // Immediate third check-in via reception desk helper
      const res3 = await checkIn(db, owner, { barcode: card.barcodeValue });
      expect(res3.kind).toBe("duplicate");

      // Verify that database has ONLY 1 attendance record, NOT 3
      const attendanceCount = db.count("SELECT COUNT(*) FROM attendance WHERE member_id = ?", [member.id]);
      expect(attendanceCount).toBe(1);

      // Verify sessions remaining is still 4, NOT 3 or 2
      const activeSub = findActiveSubscription(db, member.id, todayKey());
      expect(activeSub?.sessions_used).toBe(1);
    });
  });
});
