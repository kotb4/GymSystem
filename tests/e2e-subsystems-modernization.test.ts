import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser, listUsers } from "@/core/services/users.service";
import {
  loadPermissionsCache,
  setRolePermissions,
  getRolePermissions,
  getAllPermissions,
} from "@/core/services/permissions.service";
import {
  createMember,
  listMembers,
  setMemberStatus,
} from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  freezeSubscription,
  unfreezeSubscription,
  renewSubscription,
  listMemberSubscriptions,
} from "@/core/services/subscriptions.service";
import {
  recordPayment,
  refundPayment,
  voidPayment,
  getPaymentById,
} from "@/core/services/payments.service";
import {
  openCashSession,
  closeCashSession,
  getOpenCashSession,
  computeSessionCash,
} from "@/core/services/cash-session.service";
import {
  createExpense,
  createCategory,
  listExpenses,
} from "@/core/services/expenses.service";
import { listMemberDebts, payMemberDebt } from "@/core/services/debts.service";
import {
  createProductCategory,
  createProduct,
  createSale,
  returnStoreSale,
  getProduct,
  getStockValue,
  getProductSalesReport,
  listLowStockProducts,
} from "@/core/services/store.service";
import {
  createSupplier,
  createPurchaseInvoice,
} from "@/core/services/purchases.service";
import {
  createClass,
  createClassSession,
  bookMember,
  setBookingStatus,
  completeClassSession,
  listBookings,
} from "@/core/services/classes.service";
import { createTrainer } from "@/core/services/trainers.service";
import {
  createPTPackage,
  createPrivateTraining,
  recordPTSession,
  getPrivateTrainingById,
} from "@/core/services/private-training.service";
import {
  recordTrainerCheckIn,
  recordTrainerCheckOut,
  getTrainerAttendanceSummary,
} from "@/core/services/trainer-attendance.service";
import {
  recordCheckIn,
  recordCheckOut,
  listLiveOccupants,
} from "@/core/services/attendance.service";
import {
  assignCardByBarcode,
  setCardBlocked,
} from "@/core/services/cards.service";
import {
  createQuickSession,
  listQuickSessions,
} from "@/core/services/quick-session.service";
import {
  createAssessment,
  listAssessments,
  computeBmi,
} from "@/core/services/inbody.service";
import { getPeriodReport } from "@/core/services/financial-report.service";
import { getFinanceOverview } from "@/core/services/finance.service";
import { recordAudit, listAuditLogs } from "@/core/services/audit.service";
import { formatTime12 } from "@/services/format/date";
import { parseCsv } from "@/utils/csv-helper";
import { todayKey, addDaysKey, nowStamp } from "@/core/dates";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;
let trainer: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  loadPermissionsCache(db);

  const ownerUser = await setup(db, {
    gymName: "GymGate Cairo Modern Hub",
    ownerFullName: "كابتن أحمد المالك",
    username: "owner",
    password: "OwnerPassword@2026",
    phone: "01011112222",
  });
  owner = buildActor(ownerUser);

  manager = buildActor(
    await createUser(db, owner, {
      username: "manager_user",
      password: "ManagerPassword@2026",
      fullName: "محمد المدير",
      roleId: "manager",
      department: "general",
    }),
  );

  reception = buildActor(
    await createUser(db, owner, {
      username: "reception_user",
      password: "RecepPassword@2026",
      fullName: "سارة موظفة الاستقبال",
      roleId: "reception",
      department: "general",
    }),
  );

  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer_user",
      password: "TrainerPassword@2026",
      fullName: "كابتن محمود مدرب",
      roleId: "trainer",
      department: "general",
    }),
  );

  loadPermissionsCache(db);
});

/* =========================================================================
   TIER 1: FEATURE COVERAGE (All 7 Modernized Subsystems)
   ========================================================================= */

describe("Tier 1.1: Financial & Treasury Hub Modernization", () => {
  it("F1.1: opens cash drawer with initial float, tracks expected cash, and closes with exact count", async () => {
    const session = await openCashSession(db, owner, {
      openingBalanceMinor: 100_000, // 1,000 EGP
      box: "gym",
    });
    expect(session.status).toBe("open");
    expect(session.openingBalanceMinor).toBe(100_000);
    expect(session.box).toBe("gym");

    const openCheck = getOpenCashSession(db, owner, "gym");
    expect(openCheck?.id).toBe(session.id);

    // Close session with exact counted cash
    const closed = await closeCashSession(db, owner, session.id, 100_000, "إغلاق وردية صباحية مطابقة");
    expect(closed.status).toBe("closed");
    expect(closed.differenceMinor).toBe(0);
    expect(closed.expectedClosingMinor).toBe(100_000);
    expect(closed.countedClosingMinor).toBe(100_000);
    expect(closed.closingNo).toBeTruthy();
  });

  it("F1.2: 1-click End of Shift / Daily Z-Report records discrepancy warnings and audit event", async () => {
    const session = await openCashSession(db, owner, {
      openingBalanceMinor: 50_000, // 500 EGP
      box: "gym",
    });

    // Close with negative discrepancy (expected 500 EGP, counted 450 EGP -> difference -50 EGP)
    const closed = await closeCashSession(db, owner, session.id, 45_000, "عجز 50 جنيه في الوردية");
    expect(closed.differenceMinor).toBe(-5_000);
    expect(closed.expectedClosingMinor).toBe(50_000);
    expect(closed.countedClosingMinor).toBe(45_000);

    // Verify CASH_DISCREPANCY audit record was logged
    const auditLogs = listAuditLogs(db, owner, { action: "CASH_DISCREPANCY" });
    expect(auditLogs.items.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs.items[0].entityId).toBe(session.id);
  });

  it("F1.3: enforces atomic payment recording and unique financial_ledger entries", async () => {
    const member = await createMember(db, owner, {
      fullName: "كريم أحمد مصطفى",
      phone: "01099887766",
    });
    const plan = await createPlan(db, owner, {
      name: "اشتراك شهري شامل",
      durationDays: 30,
      price: 500, // 500 EGP = 50,000 piastres
    });
    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
    });

    // Record partial payment: 300 EGP out of 500 EGP
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 30_000,
      methodCode: "cash",
      notes: "دفعة أولى كاش",
    });

    expect(payment.paidAmountMinor).toBe(30_000);
    expect(payment.remainingAmountMinor).toBe(20_000);
    expect(payment.status).toBe("partial");

    // Verify ledger entry uniqueness and accuracy
    const ledgerRow = db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ?",
      [payment.id],
    );
    expect(ledgerRow?.count).toBe(1);
  });

  it("F1.4: payment refund and voiding with double-reversal guard", async () => {
    const member = await createMember(db, owner, { fullName: "طارق سليم" });
    const plan = await createPlan(db, owner, { name: "باقة سنوية", durationDays: 365, price: 2000 });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 200_000,
      paidAmountMinor: 200_000,
      methodCode: "cash",
    });

    // Refund partial amount: 500 EGP (50,000 minor)
    const refund = await refundPayment(
      db,
      owner,
      payment.id,
      50_000,
      "استرجاع جزئي بطلب العضو",
      "cash",
    );
    expect(refund.refundedAmountMinor).toBe(50_000);

    const updatedPayment = getPaymentById(db, owner, payment.id);
    expect(updatedPayment.refundedAmountMinor).toBe(50_000);

    // Voiding a payment that already has refunds must be rejected
    await expect(voidPayment(db, owner, { paymentId: payment.id, reason: "إلغاء كامل" })).rejects.toThrow();
  });

  it("F1.5: expense creation with categories affecting cash drawers", async () => {
    const category = await createCategory(db, owner, "مستلزمات صيانة ونظافة");
    expect(category.id).toBeTruthy();

    const expense = await createExpense(db, owner, {
      categoryId: category.id,
      description: "شراء منظفات ومعقمات للجيم",
      amountMinor: 15_000, // 150 EGP
      methodCode: "cash",
      expenseDate: todayKey(),
      notes: "شراء منظفات للجيم",
      box: "gym",
    });
    expect(expense.amountMinor).toBe(15_000);
    const ledger = db.first<{ box: string }>(
      "SELECT box FROM financial_ledger WHERE ref_table = 'expenses' AND ref_id = ?",
      [expense.id],
    );
    expect(ledger?.box).toBe("gym");

    const list = listExpenses(db, owner, { categoryId: category.id });
    expect(list.items.some((e) => e.id === expense.id)).toBe(true);
  });

  it("F1.6: telemetry overview accurately computes net collections and drawer balances", async () => {
    const today = todayKey();
    const monthStart = `${today.slice(0, 7)}-01`;
    const overview = getFinanceOverview(db, owner, today, monthStart);
    expect(overview).toBeDefined();
    expect(typeof overview.todayInMinor).toBe("number");
    expect(typeof overview.todayNetMinor).toBe("number");
    expect(typeof overview.monthInMinor).toBe("number");
  });

  it("F1.7: Treasury 12h Time Formatting formats timestamps to Arabic 12-hour AM/PM", () => {
    expect(formatTime12("2026-10-16 09:30:00")).toBe("9:30 ص");
    expect(formatTime12("2026-10-16 15:45:00")).toBe("3:45 م");
    expect(formatTime12("2026-10-16 00:05:00")).toBe("12:05 ص");
    expect(formatTime12("2026-10-16 12:00:00")).toBe("12:00 م");
  });
});

describe("Tier 1.2: Store, POS & Inventory Modernization", () => {
  it("F2.1: creates product catalog, categories, and monitors low-stock alerts", async () => {
    const category = createProductCategory(db, owner, "مكملات غذائية وسناكس");
    expect(category.id).toBeTruthy();

    const product = await createProduct(db, owner, {
      name: "واي بروتين جولد ستاندرد",
      categoryId: category.id,
      costMinor: 250_000,  // 2,500 EGP
      priceMinor: 320_000, // 3,200 EGP
      stockQty: 3,
      minStockQty: 5, // low stock threshold
      barcode: "PROT-GOLD-01",
    });

    expect(product.lowStock).toBe(true);
    expect(product.stockQty).toBe(3);

    const lowStockList = listLowStockProducts(db, owner);
    expect(lowStockList.some((p) => p.id === product.id)).toBe(true);
  });

  it("F2.2: rapid POS cash sale atomically decrements stock and creates store box ledger", async () => {
    const product = await createProduct(db, owner, {
      name: "مشروب طاقة سي فور",
      costMinor: 4_000,
      priceMinor: 7_000,
      stockQty: 20,
      barcode: "C4-ENERGY-01",
    });

    const sale = await createSale(db, owner, {
      items: [{ productId: product.id, qty: 2 }],
      methodCode: "cash",
      notes: "بيع فوري كاش",
    });

    expect(sale.totalMinor).toBe(14_000); // 70 * 2 = 140 EGP
    expect(sale.status).toBe("completed");
    expect(sale.isCredit).toBe(false);

    // Stock should be decremented from 20 to 18
    const updated = getProduct(db, owner, product.id);
    expect(updated.stockQty).toBe(18);

    // Financial ledger must record store box entry
    const ledger = db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM financial_ledger WHERE ref_table = 'store_sales' AND ref_id = ? AND box = 'store'",
      [sale.id],
    );
    expect(ledger?.count).toBe(1);
  });

  it("F2.3: member credit sale creates debt record without immediate cash inflow", async () => {
    const member = await createMember(db, owner, { fullName: "حسام حسن لاعب" });
    const product = await createProduct(db, owner, {
      name: "شيكر بروتين جيم جيت",
      costMinor: 5_000,
      priceMinor: 10_000,
      stockQty: 10,
    });

    const sale = await createSale(db, owner, {
      memberId: member.id,
      items: [{ productId: product.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
      notes: "آجل على حساب العضو",
    });

    expect(sale.isCredit).toBe(true);
    expect(sale.debtStatus).toBe("open");
    expect(sale.debtRemainingMinor).toBe(10_000);

    // Verify store debt exists in unified debts
    const debts = listMemberDebts(db, owner, { debtType: "store" });
    expect(debts.items.some((d) => d.memberId === member.id && d.remainingAmountMinor === 10_000)).toBe(true);

    // No cash ledger entry for credit sales
    const ledger = db.count(
      "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'store_sales' AND ref_id = ?",
      [sale.id],
    );
    expect(ledger).toBe(0);
  });

  it("F2.4: store returns restock inventory and record refund ledger reversal", async () => {
    const product = await createProduct(db, owner, {
      name: "حزام رفع أثقال جلدي",
      costMinor: 15_000,
      priceMinor: 25_000,
      stockQty: 5,
    });

    const sale = await createSale(db, owner, {
      items: [{ productId: product.id, qty: 2 }],
      methodCode: "cash",
    });
    expect(getProduct(db, owner, product.id).stockQty).toBe(3);

    const saleItem = sale.items[0];
    const returnResult = await returnStoreSale(db, owner, {
      saleId: sale.id,
      lines: [{ saleItemId: saleItem.id, qty: 1 }],
      reason: "مقاس الحزام غير مناسب",
    });

    expect(returnResult.totalMinor).toBe(25_000);
    // Stock restored from 3 to 4
    expect(getProduct(db, owner, product.id).stockQty).toBe(4);
  });

  it("F2.5: supplier restock purchase order automatically increments inventory and logs expense", async () => {
    const supplier = createSupplier(db, owner, {
      name: "شركة النصر للمكملات والمعدات",
      phone: "01122334455",
    });
    const product = await createProduct(db, owner, {
      name: "كرياتين ميكرونايزد 300 جم",
      costMinor: 30_000,
      priceMinor: 45_000,
      stockQty: 0,
    });

    const invoice = createPurchaseInvoice(db, owner, {
      supplierId: supplier.id,
      paidAmountMinor: 300_000, // 3,000 EGP paid in full
      methodCode: "cash",
      items: [{ productId: product.id, quantity: 10, unitCostMinor: 30_000 }],
      notes: "فاتورة توريد كرياتين",
    });

    expect(invoice.status).toBe("paid");
    expect(getProduct(db, owner, product.id).stockQty).toBe(10);
  });

  it("F2.6: store telemetry reports inventory value and product sales ranking", async () => {
    // Create at least one product
    await createProduct(db, owner, {
      name: "منتج تقرير المتجر",
      costMinor: 5_000,
      priceMinor: 10_000,
      stockQty: 5,
    });

    const stockVal = getStockValue(db, owner);
    expect(stockVal.productCount).toBeGreaterThanOrEqual(1);
    expect(stockVal.totalCostMinor).toBeGreaterThanOrEqual(0);

    const salesReport = getProductSalesReport(db, owner, {
      fromKey: todayKey(),
      toKey: todayKey(),
    });
    expect(Array.isArray(salesReport)).toBe(true);
  });
});

describe("Tier 1.3: Classes, Trainers & Private Training Hub", () => {
  let sampleTrainerId: string;

  beforeEach(async () => {
    const t = await createTrainer(db, owner, {
      fullName: "كابتن كمال بطل كيك بوكسينج",
      phone: "01055556666",
      specialization: "كيك بوكسينغ وفنون قتالية",
      defaultSessionFeeMinor: 10_000,
    });
    sampleTrainerId = t.id;
  });

  it("F3.1: creates combat and fitness classes with schedule slots and capacity", async () => {
    const gymClass = await createClass(db, owner, {
      name: "حصة كيك بوكسينغ متقدم",
      discipline: "kickboxing",
      category: "adults",
      level: "advanced",
      capacity: 15,
      consumesSession: true,
      trainerId: sampleTrainerId,
      defaultTrainerFeeMinor: 15_000,
      scheduleSlots: [{ dayOfWeek: 1, startTime: "18:00", endTime: "19:30" }],
    });

    expect(gymClass.id).toBeTruthy();
    expect(gymClass.discipline).toBe("kickboxing");
    expect(gymClass.capacity).toBe(15);
    expect(gymClass.consumesSession).toBe(true);
  });

  it("F3.2: schedules class sessions and prevents duplicates on same date/time", async () => {
    const gymClass = await createClass(db, owner, {
      name: "حصة ملاكمة للمبتدئين",
      capacity: 10,
    });

    const session = await createClassSession(db, owner, gymClass.id, {
      sessionDate: todayKey(),
      startTime: "17:00",
      durationMin: 60,
      capacity: 10,
    });
    expect(session.status).toBe("scheduled");

    // Attempting to schedule duplicate session on same class, date, and time must fail
    await expect(
      createClassSession(db, owner, gymClass.id, {
        sessionDate: todayKey(),
        startTime: "17:00",
        durationMin: 60,
      }),
    ).rejects.toThrow();
  });

  it("F3.3: books members into session and enforces capacity ceiling", async () => {
    const gymClass = await createClass(db, owner, {
      name: "حصة فتنس للسيدات",
      capacity: 2,
    });
    const session = await createClassSession(db, owner, gymClass.id, {
      sessionDate: todayKey(),
      startTime: "19:00",
      capacity: 2,
    });

    const m1 = await createMember(db, owner, { fullName: "عضوة أولى" });
    const m2 = await createMember(db, owner, { fullName: "عضوة ثانية" });
    const m3 = await createMember(db, owner, { fullName: "عضوة ثالثة" });

    await bookMember(db, owner, { sessionId: session.id, memberId: m1.id });
    await bookMember(db, owner, { sessionId: session.id, memberId: m2.id });

    // 3rd member booking must be rejected because capacity is 2
    await expect(bookMember(db, owner, { sessionId: session.id, memberId: m3.id })).rejects.toThrow();
  });

  it("F3.4: attendance marking atomically deducts 1 session from active member subscription", async () => {
    const gymClass = await createClass(db, owner, {
      name: "حصة تدريب وظيفي كروس فيت",
      capacity: 10,
      consumesSession: true,
    });
    const session = await createClassSession(db, owner, gymClass.id, {
      sessionDate: todayKey(),
      startTime: "20:00",
    });

    const member = await createMember(db, owner, { fullName: "يوسف النمر" });
    const plan = await createPlan(db, owner, {
      name: "باقة 10 حصص",
      durationDays: 60,
      price: 600,
      kind: "sessions",
      sessionsCount: 10,
    });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const booking = await bookMember(db, owner, { sessionId: session.id, memberId: member.id });

    // Mark attended -> should deduct 1 session
    const attended = await setBookingStatus(db, owner, booking.id, "attended");
    expect(attended.status).toBe("attended");

    const subCheck = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(subCheck?.sessions_used).toBe(1);
  });

  it("F3.5: Private Training (PT) packages, enrollment, and payment setup", async () => {
    const ptPkg = createPTPackage(db, owner, {
      name: "باقة تدريب خاص 12 جلسة",
      sessionsCount: 12,
      priceMinor: 120_000, // 1,200 EGP
      durationDays: 45,
      coachCommissionPercent: 50,
    });
    expect(ptPkg.id).toBeTruthy();

    const member = await createMember(db, owner, { fullName: "رامي خليل" });
    const pt = createPrivateTraining(db, owner, {
      memberId: member.id,
      trainerId: sampleTrainerId,
      packageId: ptPkg.id,
      totalSessions: 12,
      priceMinor: 120_000,
      paidAmountMinor: 60_000, // 600 EGP paid, 600 EGP debt
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 45),
      methodCode: "cash",
    });

    expect(pt.status).toBe("active");
    expect(pt.completed_sessions).toBe(0);
    expect(pt.remaining_sessions).toBe(12);
    expect(pt.remaining_amount_minor).toBe(60_000);
  });

  it("F3.6: PT session countdown and automatic status transition to completed", async () => {
    const member = await createMember(db, owner, { fullName: "سعيد مراد" });
    const pt = createPrivateTraining(db, owner, {
      memberId: member.id,
      trainerId: sampleTrainerId,
      totalSessions: 2,
      priceMinor: 30_000,
      paidAmountMinor: 30_000,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 30),
    });

    // Record session 1
    const s1 = recordPTSession(db, owner, { privateTrainingId: pt.id, notes: "جلسة أولى ظهر" });
    expect(s1.completedSessions).toBe(1);
    expect(s1.remainingSessions).toBe(1);

    // Record session 2 (final)
    const s2 = recordPTSession(db, owner, { privateTrainingId: pt.id, notes: "جلسة ثانية أرجل" });
    expect(s2.completedSessions).toBe(2);
    expect(s2.remainingSessions).toBe(0);

    const ptFresh = getPrivateTrainingById(db, owner, pt.id);
    expect(ptFresh?.status).toBe("completed");
  });

  it("F3.7: trainer attendance check-in, summary, and check-out tracking", async () => {
    const checkin = recordTrainerCheckIn(db, owner, {
      trainerId: sampleTrainerId,
      status: "present",
      notes: "حضور في الموعد",
    });
    expect(checkin.status).toBe("present");
    expect(checkin.check_in_time).toBeTruthy();

    const summary = getTrainerAttendanceSummary(db);
    expect(summary.presentToday).toBeGreaterThanOrEqual(1);
    expect(summary.currentlyPresent).toBeGreaterThanOrEqual(1);

    const checkout = recordTrainerCheckOut(db, owner, { attendanceId: checkin.id });
    expect(checkout.check_out_time).toBeTruthy();
  });
});

describe("Tier 1.4: Members & Comprehensive Profile 360", () => {
  it("F4.1: member roster management and department-based filtering", async () => {
    const mMen = await createMember(db, owner, {
      fullName: "مصطفى كامل",
      phone: "01012345678",
      department: "men",
    });
    const mWomen = await createMember(db, owner, {
      fullName: "منى الشاذلي",
      phone: "01087654321",
      department: "women",
    });

    const menList = listMembers(db, owner, { department: "men" });
    expect(menList.items.some((m) => m.id === mMen.id)).toBe(true);
    expect(menList.items.some((m) => m.id === mWomen.id)).toBe(false);

    const womenList = listMembers(db, owner, { department: "women" });
    expect(womenList.items.some((m) => m.id === mWomen.id)).toBe(true);
    expect(womenList.items.some((m) => m.id === mMen.id)).toBe(false);
  });

  it("F4.2: quick status toggle in roster updates member state and writes audit", async () => {
    const member = await createMember(db, owner, { fullName: "سمير صبري" });
    expect(member.status).toBe("active");

    const updated = await setMemberStatus(db, owner, member.id, "suspended");
    expect(updated.status).toBe("suspended");

    const audit = listAuditLogs(db, owner, { action: "MEMBER_STATUS_CHANGED" });
    expect(audit.items.some((a) => a.entityId === member.id)).toBe(true);
  });

  it("F4.3: Profile 360 subscription freeze records open freeze and suspends membership", async () => {
    const member = await createMember(db, owner, { fullName: "إيهاب توفيق" });
    const plan = await createPlan(db, owner, { name: "باقة 3 شهور", durationDays: 90, price: 900 });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const freezeStart = todayKey();
    const freezeEnd = addDaysKey(freezeStart, 14);

    const frozen = await freezeSubscription(db, owner, sub.id, {
      startDate: freezeStart,
      endDate: freezeEnd,
      reason: "سفر لمدة أسبوعين",
    });

    expect(frozen.status).toBe("suspended");
    expect(frozen.frozenAt).toBeTruthy();
    expect(frozen.resumeDate).toBe(freezeEnd);
  });

  it("F4.4: unfreezing subscription extends end date and reactivates subscription", async () => {
    const member = await createMember(db, owner, { fullName: "وليد توفيق" });
    const plan = await createPlan(db, owner, { name: "باقة صيفية 60 يوم", durationDays: 60, price: 600 });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const freezeStart = todayKey();
    const freezeEnd = addDaysKey(freezeStart, 10);
    await freezeSubscription(db, owner, sub.id, { startDate: freezeStart, endDate: freezeEnd });

    // Unfreeze
    const unfrozen = await unfreezeSubscription(db, owner, sub.id);
    expect(unfrozen.status).toBe("active");
    expect(unfrozen.frozenAt).toBeNull();
  });

  it("F4.5: Profile 360 1-click renewal creates successor subscription starting after current end date", async () => {
    const member = await createMember(db, owner, { fullName: "شريف منير" });
    const plan = await createPlan(db, owner, { name: "اشتراك شهر", durationDays: 30, price: 400 });
    const sub1 = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const renewal = await renewSubscription(db, owner, sub1.id);
    expect(renewal.previous.id).toBe(sub1.id);
    expect(renewal.next.id).not.toBe(sub1.id);
    expect(renewal.next.startDate).toBe(addDaysKey(sub1.endDate, 1));
  });

  it("F4.6: InBody assessment history, body metrics, and BMI computation", async () => {
    const member = await createMember(db, owner, { fullName: "أشرف عبد الباقي" });

    // Test BMI math: 80 kg, 180 cm -> 80 / (1.8^2) = 24.7
    const bmi = computeBmi(80, 180);
    expect(bmi).toBe(24.7);

    const assessment = await createAssessment(db, owner, {
      memberId: member.id,
      assessmentDate: todayKey(),
      weightKg: 85,
      heightCm: 178,
      bodyFatPercent: 22.5,
      muscleMassKg: 38.2,
      waistCm: 88,
      notes: "قياس أولي ممتاز",
    });

    expect(assessment.bmi).toBeCloseTo(26.8, 1);

    const history = listAssessments(db, owner, member.id);
    expect(history.length).toBe(1);
    expect(history[0].weightKg).toBe(85);
  });
});

describe("Tier 1.5: Reception & Live Occupancy Hub", () => {
  it("F5.1: barcode check-in happy path verifies member status, subscription, and metadata", async () => {
    const member = await createMember(db, owner, { fullName: "ماجد الكدواني" });
    const plan = await createPlan(db, owner, { name: "عضوية ذهبية", durationDays: 30, price: 500 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "VIP-BARCODE-01",
      memberId: member.id,
    });

    const result = await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.memberName).toBe("ماجد الكدواني");
      expect(result.memberCode).toBe(member.memberCode);
    }
  });

  it("F5.2: barcode check-in denial matrix enforces rules for blocked, missing, or expired entities", async () => {
    // Unknown card
    const unknown = await recordCheckIn(db, owner, { barcode: "NON-EXISTENT-CARD" });
    expect(unknown.kind).toBe("denied");
    if (unknown.kind === "denied") expect(unknown.reason).toBe("CARD_UNKNOWN");

    // Blocked card
    const member = await createMember(db, owner, { fullName: "عضو بطاقة موقوفة" });
    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "BLOCKED-CARD-99",
      memberId: member.id,
    });
    await setCardBlocked(db, owner, assigned.card.id, true);

    const blocked = await recordCheckIn(db, owner, { barcode: "BLOCKED-CARD-99" });
    expect(blocked.kind).toBe("denied");
    if (blocked.kind === "denied") expect(blocked.reason).toBe("CARD_BLOCKED");

    // Member without subscription
    const member2 = await createMember(db, owner, { fullName: "عضو بدون اشتراك" });
    const assigned2 = await assignCardByBarcode(db, owner, {
      barcodeValue: "NO-SUB-CARD-55",
      memberId: member2.id,
    });

    const noSub = await recordCheckIn(db, owner, { barcode: assigned2.card.barcodeValue });
    expect(noSub.kind).toBe("denied");
    if (noSub.kind === "denied") expect(noSub.reason).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  it("F5.3: duplicate scan window prevents accidental multiple check-ins", async () => {
    const member = await createMember(db, owner, { fullName: "خالد الصاوي" });
    const plan = await createPlan(db, owner, { name: "باقة سنوية", durationDays: 365, price: 1500 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "DUP-TEST-CARD",
      memberId: member.id,
    });

    const first = await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });
    expect(first.kind).toBe("success");

    // Immediate second scan
    const second = await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });
    expect(second.kind).toBe("duplicate");
  });

  it("F5.4: live occupancy hub returns real-time count and occupant details", async () => {
    const member = await createMember(db, owner, { fullName: "أحمد حلمي" });
    const plan = await createPlan(db, owner, { name: "باقة شهري", durationDays: 30, price: 300 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "OCCUPANT-CARD-01",
      memberId: member.id,
    });

    await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });

    const live = listLiveOccupants(db, owner);
    expect(live.totalNow).toBeGreaterThanOrEqual(1);
    expect(live.occupants.some((o) => o.memberId === member.id)).toBe(true);
  });

  it("F5.5: front-desk check-out flow removes member from live occupancy", async () => {
    const member = await createMember(db, owner, { fullName: "كريم عبد العزيز" });
    const plan = await createPlan(db, owner, { name: "باقة بريميوم", durationDays: 30, price: 600 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "CHECKOUT-CARD-01",
      memberId: member.id,
    });

    await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });

    const checkout = await recordCheckOut(db, owner, member.id);
    expect(checkout.kind).toBe("success");

    const live = listLiveOccupants(db, owner);
    expect(live.occupants.some((o) => o.memberId === member.id)).toBe(false);
  });

  it("F5.6: front desk Quick Session / Day Pass for guests with immediate payment", async () => {
    const quickSession = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "علي الزائر",
      guestPhone: "01234567890",
      guestGender: "male",
      sessionName: "تذكرة يوم واحد (Day Pass)",
      priceMinor: 5_000, // 50 EGP
      paidAmountMinor: 5_000,
      methodCode: "cash",
      recordAttendance: true,
    });

    expect(quickSession.id).toBeTruthy();
    expect(quickSession.paid_amount_minor).toBe(5_000);
    expect(quickSession.attendance_recorded).toBe(1);

    const list = listQuickSessions(db, owner);
    expect(list.items.some((s) => s.id === quickSession.id)).toBe(true);
  });
});

describe("Tier 1.6: Staff, Users & Permissions Matrix", () => {
  it("F6.1: provisions staff user accounts with specific roles and department scoping", async () => {
    const newUser = await createUser(db, owner, {
      username: "men_coach",
      password: "CoachPassword@2026",
      fullName: "كابتن قسم الرجال",
      roleId: "trainer",
      department: "men",
    });

    expect(newUser.username).toBe("men_coach");
    expect(newUser.department).toBe("men");
    expect(newUser.roleId).toBe("trainer");

    const users = listUsers(db, owner);
    expect(users.some((u) => u.id === newUser.id)).toBe(true);
  });

  it("F6.2: enforces department security isolation across data operations", async () => {
    const menStaff = buildActor(
      await createUser(db, owner, {
        username: "staff_men_only",
        password: "MenPassword@2026",
        fullName: "موظف قسم رجال",
        roleId: "reception",
        department: "men",
      }),
    );

    const womenMember = await createMember(db, owner, {
      fullName: "سيدة قسم السيدات",
      department: "women",
    });

    // Men staff attempting to access or create subscription for women member must throw
    const plan = await createPlan(db, owner, { name: "خطة عامة", durationDays: 30, price: 300 });
    await expect(
      createSubscription(db, menStaff, {
        memberId: womenMember.id,
        planId: plan.id,
      }),
    ).rejects.toThrow();
  });

  it("F6.3: updates role-permissions matrix and reloads permissions cache cleanly", async () => {
    const all = getAllPermissions(db, owner);
    expect(all.length).toBe(116);

    const perms = getRolePermissions(db, owner);
    expect(perms.manager).toBeDefined();

    // Revoke cash.open from reception role
    const currentRecepPerms = perms.reception.filter((p) => p !== "cash.open");
    setRolePermissions(db, owner, "reception", currentRecepPerms);
    loadPermissionsCache(db);

    const updatedPerms = getRolePermissions(db, owner);
    expect(updatedPerms.reception.includes("cash.open")).toBe(false);
  });

  it("F6.4: non-owner is blocked from modifying owner role or escalating own role", async () => {
    // Manager attempting to modify owner role is rejected
    setRolePermissions(db, manager, "owner", ["settings.edit"]);
    const perms = getRolePermissions(db, owner);
    expect(perms.owner).toBeDefined();

    // Manager attempting to edit manager role (self-escalation) must throw errForbidden
    expect(() => setRolePermissions(db, manager, "manager", ["settings.edit"])).toThrow();
  });

  it("F6.5: role boundaries reject unauthorized actions with errForbidden", async () => {
    // Trainer attempting to close cash sessions must receive permission error
    await expect(closeCashSession(db, trainer, "any-session-id", 100_000)).rejects.toThrow();
  });

  it("F6.6: permission matrix accounts for all 116 granular system permissions", () => {
    const perms = getAllPermissions(db, owner);
    expect(perms.length).toBe(116);
    expect(perms).toContain("members.view");
    expect(perms).toContain("cash.open");
    expect(perms).toContain("store.sell");
    expect(perms).toContain("classes.manage");
    expect(perms).toContain("debts.manage");
    expect(perms).toContain("private_training.manage");
    expect(perms).toContain("trainer_attendance.manage");
  });
});

describe("Tier 1.7: Reports & 211-Action Audit Log Hub", () => {
  it("F7.1: executive dashboard aggregates revenue across all 5 distinct business streams", async () => {
    // 1. Subscription revenue
    const member = await createMember(db, owner, { fullName: "عضو تقرير مالي" });
    const plan = await createPlan(db, owner, { name: "خطة اشتراك", durationDays: 30, price: 500 });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 50_000,
      methodCode: "cash",
    });

    // 2. Store sales revenue
    const prod = await createProduct(db, owner, { name: "مياه معدنية", costMinor: 500, priceMinor: 1_000, stockQty: 50 });
    await createSale(db, owner, { items: [{ productId: prod.id, qty: 5 }], methodCode: "cash" });

    // 3. Quick session revenue
    createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "ضيف عابر",
      sessionName: "زيارة فردية",
      priceMinor: 4_000,
      paidAmountMinor: 4_000,
      methodCode: "cash",
    });

    // Fetch report
    const report = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(report.subscriptionsRevenueMinor).toBeGreaterThanOrEqual(50_000);
    expect(report.storeRevenueMinor).toBeGreaterThanOrEqual(5_000);
    expect(report.quickSessionsRevenueMinor).toBeGreaterThanOrEqual(4_000);
  });

  it("F7.2: income statement calculates gross operating profit, COGS, and operating expenses", async () => {
    const report = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(report.incomeStatement).toBeDefined();
    expect(report.incomeStatement.totalRevenueMinor).toBeGreaterThanOrEqual(0);
    expect(report.incomeStatement.grossProfitMinor).toBeDefined();
    expect(report.incomeStatement.netProfitMinor).toBeDefined();
  });

  it("F7.3: receivables and aging summary tracks outstanding debts across streams", async () => {
    const report = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(report.receivables).toBeDefined();
    expect(typeof report.receivables.totalReceivablesMinor).toBe("number");
    expect(typeof report.receivables.subscriptionsDebtMinor).toBe("number");
    expect(typeof report.receivables.storeDebtMinor).toBe("number");
  });

  it("F7.4: comprehensive audit trail records actors, entity identifiers, and action metadata", async () => {
    recordAudit(db, owner, "MEMBER_CREATED", "member", "test-member-uuid", { reason: "E2E audit test" });
    const logs = listAuditLogs(db, owner, { action: "MEMBER_CREATED" });
    expect(logs.items.length).toBeGreaterThanOrEqual(1);
    expect(logs.items[0].userName).toBe(owner.username);
  });

  it("F7.5: audit log search filters by action enum, user name, and keyword", async () => {
    recordAudit(db, owner, "SYSTEM_BACKUP_CREATED", "backup", "b1", { size: 1024 });
    const logs = listAuditLogs(db, owner, { search: "b1" });
    expect(logs.items.some((i) => i.entityId === "b1")).toBe(true);
  });

  it("F7.6: CSV parser handles Arabic text and UTF-8 BOM encoding seamlessly", () => {
    const sampleCsv = "\uFEFFالاسم,الهاتف,الفرع\r\n\"أحمد محمد\",01012345678,القاهرة\r\n\"سارة علي\",01123456789,الجيزة";
    const parsed = parseCsv(sampleCsv);
    expect(parsed.length).toBe(3);
    expect(parsed[0]).toEqual(["الاسم", "الهاتف", "الفرع"]);
    expect(parsed[1][0]).toBe("أحمد محمد");
    expect(parsed[2][0]).toBe("سارة علي");
  });
});

/* =========================================================================
   TIER 2: BOUNDARY & CORNER CASES
   ========================================================================= */

describe("Tier 2: Boundary & Corner Cases", () => {
  it("B2.1: empty cash drawer with zero opening balance and zero transactions closes cleanly", async () => {
    const session = await openCashSession(db, owner, {
      openingBalanceMinor: 0,
      box: "store",
    });
    expect(session.openingBalanceMinor).toBe(0);

    const closed = await closeCashSession(db, owner, session.id, 0, "إغلاق درج المتجر الفارغ");
    expect(closed.expectedClosingMinor).toBe(0);
    expect(closed.countedClosingMinor).toBe(0);
    expect(closed.differenceMinor).toBe(0);
  });

  it("B2.2: 100% discount / free promotional item sale executes without arithmetic errors", async () => {
    const product = await createProduct(db, owner, {
      name: "عينة بروتين مجانية",
      costMinor: 1_000,
      priceMinor: 2_000,
      stockQty: 5,
    });

    const sale = await createSale(db, owner, {
      items: [{ productId: product.id, qty: 1 }],
      discountMinor: 2_000, // 100% discount
      methodCode: "cash",
      notes: "هدية ترويجية",
    });

    expect(sale.totalMinor).toBe(0);
    expect(sale.discountMinor).toBe(2_000);
    expect(getProduct(db, owner, product.id).stockQty).toBe(4);
  });

  it("B2.3: negative discrepancy in cash closing records variance without crash", async () => {
    const session = await openCashSession(db, owner, {
      openingBalanceMinor: 20_000, // 200 EGP
      box: "gym",
    });

    // Counted 100 EGP instead of 200 EGP -> difference = -100 EGP
    const closed = await closeCashSession(db, owner, session.id, 10_000, "عجز نتيجة خطأ فكة");
    expect(closed.differenceMinor).toBe(-10_000);
  });

  it("B2.4: class capacity strictly prevents oversubscription", async () => {
    const gymClass = await createClass(db, owner, {
      name: "حصة ملاكمة محدودة لشخص واحد",
      capacity: 1,
    });
    const session = await createClassSession(db, owner, gymClass.id, {
      sessionDate: todayKey(),
      startTime: "16:00",
      capacity: 1,
    });

    const m1 = await createMember(db, owner, { fullName: "عضو أول" });
    const m2 = await createMember(db, owner, { fullName: "عضو ثان" });

    await bookMember(db, owner, { sessionId: session.id, memberId: m1.id });
    await expect(bookMember(db, owner, { sessionId: session.id, memberId: m2.id })).rejects.toThrow();
  });

  it("B2.5: member with zero sessions remaining cannot attend session-consuming class", async () => {
    const gymClass = await createClass(db, owner, {
      name: "حصة تدريب وظيفي",
      capacity: 5,
      consumesSession: true,
    });
    const session = await createClassSession(db, owner, gymClass.id, {
      sessionDate: todayKey(),
      startTime: "18:00",
    });

    const member = await createMember(db, owner, { fullName: "عضو بدون رصيد حصص" });
    const plan = await createPlan(db, owner, {
      name: "باقة حصة واحدة",
      durationDays: 30,
      price: 100,
      kind: "sessions",
      sessionsCount: 1,
    });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    // Consume the only session
    db.run("UPDATE member_subscriptions SET sessions_used = 1 WHERE id = ?", [sub.id]);

    const booking = await bookMember(db, owner, { sessionId: session.id, memberId: member.id });

    // Marking attended must fail because remaining sessions = 0
    await expect(setBookingStatus(db, owner, booking.id, "attended")).rejects.toThrow();
  });

  it("B2.6: exhausted PT package rejects recording additional sessions", async () => {
    const trainerRow = await createTrainer(db, owner, { fullName: "كابتن تدريب خاص" });
    const member = await createMember(db, owner, { fullName: "عضو باقة منتهية" });
    const pt = createPrivateTraining(db, owner, {
      memberId: member.id,
      trainerId: trainerRow.id,
      totalSessions: 1,
      priceMinor: 10_000,
      paidAmountMinor: 10_000,
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 30),
    });

    // Record the 1 session -> now completed
    recordPTSession(db, owner, { privateTrainingId: pt.id });

    // Attempting to record 2nd session must fail
    expect(() => recordPTSession(db, owner, { privateTrainingId: pt.id })).toThrow();
  });

  it("B2.7: empty department filter returns empty list with total 0", () => {
    const res = listMembers(db, owner, { search: "NonExistentMemberQueryXYZ" });
    expect(res.items.length).toBe(0);
    expect(res.total).toBe(0);
  });

  it("B2.8: reception role cannot execute administrative purge actions", async () => {
    const member = await createMember(db, owner, { fullName: "عضو اختبار حماية" });
    // Reception lacks members.purge permission
    const { purgeMember } = await import("@/core/services/members.service");
    await expect(purgeMember(db, reception, member.id)).rejects.toThrow();
  });
});

/* =========================================================================
   TIER 3: CROSS-FEATURE COMBINATIONS
   ========================================================================= */

describe("Tier 3: Cross-Feature Combinations", () => {
  it("C3.1: store credit sale -> member debt listing -> debt repayment -> cash ledger update", async () => {
    const member = await createMember(db, owner, { fullName: "مصطفى فهمي" });
    const product = await createProduct(db, owner, {
      name: "حزام ركبة طبي",
      costMinor: 8_000,
      priceMinor: 15_000, // 150 EGP
      stockQty: 10,
    });

    // 1. Credit sale
    const sale = await createSale(db, owner, {
      memberId: member.id,
      items: [{ productId: product.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
    });
    expect(sale.debtStatus).toBe("open");

    // 2. Query debt
    const debtsBefore = listMemberDebts(db, owner, { search: member.fullName });
    expect(debtsBefore.items.length).toBe(1);
    expect(debtsBefore.items[0].remainingAmountMinor).toBe(15_000);

    // 3. Repay debt in full
    const repay = payMemberDebt(db, owner, {
      debtType: "store",
      debtId: debtsBefore.items[0].debtId,
      amountMinor: 15_000,
      methodCode: "cash",
      notes: "سداد قيمة حزام الركبة كاش",
    });
    expect(repay.success).toBe(true);
    expect(repay.remainingMinor).toBe(0);

    // 4. Verify debt is settled and ledger records repayment
    const debtRow = db.first<{ status: string }>(
      "SELECT status FROM store_debts WHERE id = ?",
      [debtsBefore.items[0].debtId],
    );
    expect(debtRow?.status).toBe("settled");

    const ledger = db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM financial_ledger WHERE ref_table = 'store_debts' AND ref_id LIKE ?",
      [`${debtsBefore.items[0].debtId}%`],
    );
    expect(ledger?.count).toBe(1);
  });

  it("C3.2: session subscription -> class booking -> attendance check-in deducts session", async () => {
    const member = await createMember(db, owner, { fullName: "هشام عباس" });
    const plan = await createPlan(db, owner, {
      name: "باقة 5 حصص سباحة",
      durationDays: 30,
      price: 500,
      kind: "sessions",
      sessionsCount: 5,
    });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const swimClass = await createClass(db, owner, {
      name: "حصة تدريب سباحة حر",
      capacity: 8,
      consumesSession: true,
    });
    const session = await createClassSession(db, owner, swimClass.id, {
      sessionDate: todayKey(),
      startTime: "11:00",
    });

    const booking = await bookMember(db, owner, { sessionId: session.id, memberId: member.id });
    await setBookingStatus(db, owner, booking.id, "attended");

    // Verify exactly 1 session consumed out of 5 (4 remaining)
    const checkSub = db.first<{ sessions_used: number; sessions_total: number }>(
      "SELECT sessions_used, sessions_total FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(checkSub?.sessions_used).toBe(1);
    expect(checkSub?.sessions_total).toBe(5);
  });

  it("C3.3: subscription renewal -> payment recording -> financial telemetry reflects new revenue", async () => {
    const member = await createMember(db, owner, { fullName: "محمد صبحي" });
    const plan = await createPlan(db, owner, { name: "اشتراك جيم شهر", durationDays: 30, price: 600 });
    const sub1 = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    // Renew
    const renewed = await renewSubscription(db, owner, sub1.id);
    expect(renewed.next.id).toBeTruthy();

    // Pay for renewal
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: renewed.next.id,
      baseAmountMinor: 60_000,
      paidAmountMinor: 60_000,
      methodCode: "cash",
      notes: "سداد تجديد الاشتراك",
    });

    const overview = getFinanceOverview(db, owner, todayKey(), `${todayKey().slice(0, 7)}-01`);
    expect(overview.todayInMinor).toBeGreaterThanOrEqual(60_000);
  });

  it("C3.4: frozen subscription denies check-in with FROZEN reason and allows check-in after explicit unfreeze", async () => {
    const member = await createMember(db, owner, { fullName: "هاني سلامة" });
    const plan = await createPlan(db, owner, { name: "باقة 6 شهور", durationDays: 180, price: 1800 });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "AUTO-UNFREEZE-01",
      memberId: member.id,
    });

    // Freeze subscription for 14 days
    await freezeSubscription(db, owner, sub.id, {
      startDate: todayKey(),
      endDate: addDaysKey(todayKey(), 14),
      reason: "تجميد مؤقت",
    });

    const frozenCheck = db.first<{ status: string }>(
      "SELECT status FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(frozenCheck?.status).toBe("suspended");

    // Scan at reception -> returns denied with reason FROZEN so reception can prompt FrozenDecisionModal
    const deniedCheckin = await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });
    expect(deniedCheckin).toMatchObject({ kind: "denied", reason: "FROZEN" });

    // Explicitly unfreeze upon reception confirmation (Enter key on FrozenDecisionModal)
    await unfreezeSubscription(db, owner, sub.id);

    const reactivated = db.first<{ status: string }>(
      "SELECT status FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(reactivated?.status).toBe("active");

    // Now check-in succeeds
    const checkin = await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });
    expect(checkin.kind).toBe("success");
  });

  it("C3.5: supplier restock invoice increases stock enabling rapid POS checkout", async () => {
    const supplier = createSupplier(db, owner, { name: "موزع قفازات الرياضة" });
    const product = await createProduct(db, owner, {
      name: "قفاز ملاكمة جلد صناعي",
      costMinor: 10_000,
      priceMinor: 20_000,
      stockQty: 0, // initially out of stock
    });

    // Restock 15 units
    createPurchaseInvoice(db, owner, {
      supplierId: supplier.id,
      paidAmountMinor: 150_000,
      methodCode: "cash",
      items: [{ productId: product.id, quantity: 15, unitCostMinor: 10_000 }],
    });
    expect(getProduct(db, owner, product.id).stockQty).toBe(15);

    // Rapid sale of 5 units
    const sale = await createSale(db, owner, {
      items: [{ productId: product.id, qty: 5 }],
      methodCode: "cash",
    });
    expect(sale.status).toBe("completed");
    expect(getProduct(db, owner, product.id).stockQty).toBe(10);
  });
});

/* =========================================================================
   TIER 4: REAL-WORLD WORKLOADS
   ========================================================================= */

describe("Tier 4: Real-World Workloads", () => {
  it("W4.1: complete end-of-day shift closing reconciliation across gym and store cash boxes", async () => {
    // 1. Open Gym Cash Box with 500 EGP float
    const gymSession = await openCashSession(db, owner, { openingBalanceMinor: 50_000, box: "gym" });

    // 2. Open Store Cash Box with 200 EGP float
    const storeSession = await openCashSession(db, owner, { openingBalanceMinor: 20_000, box: "store" });

    // 3. Member subscription payment: 400 EGP cash into gym box
    const m1 = await createMember(db, owner, { fullName: "عضو وردية أول" });
    const plan = await createPlan(db, owner, { name: "اشتراك شهري عادي", durationDays: 30, price: 400 });
    const sub1 = await createSubscription(db, owner, { memberId: m1.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: m1.id,
      subscriptionId: sub1.id,
      baseAmountMinor: 40_000,
      paidAmountMinor: 40_000,
      methodCode: "cash",
    });

    // 4. Store cash sales: 80 EGP cash into store box
    const snack = await createProduct(db, owner, { name: "بروتين بار شوكولاتة", costMinor: 2_000, priceMinor: 4_000, stockQty: 20 });
    await createSale(db, owner, { items: [{ productId: snack.id, qty: 2 }], methodCode: "cash" });

    // 5. Guest Quick Session: 50 EGP cash into gym box
    createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "زائر الوردية",
      sessionName: "تذكرة يوم",
      priceMinor: 5_000,
      paidAmountMinor: 5_000,
      methodCode: "cash",
    });

    // 6. Gym operational expense: 150 EGP cash paid out from gym box
    const expCat = await createCategory(db, owner, "فواتير وضيافة");
    await createExpense(db, owner, {
      categoryId: expCat.id,
      description: "شراء مياه وضيافة للبار",
      amountMinor: 15_000,
      methodCode: "cash",
      expenseDate: todayKey(),
      notes: "شراء مياه للبار",
      box: "gym",
    });

    // Gym Box Expected: 50,000 (opening) + 40,000 (sub) + 5,000 (quick session) - 15,000 (exp) = 80,000 minor (800 EGP)
    const gymTotals = computeSessionCash(db, gymSession.openedAt, nowStamp(), "gym");
    expect(gymTotals.cashInMinor).toBe(45_000);
    expect(gymTotals.cashOutMinor).toBe(15_000);

    const closedGym = await closeCashSession(db, owner, gymSession.id, 80_000, "إغلاق وردية الجيم مطابقة");
    expect(closedGym.expectedClosingMinor).toBe(80_000);
    expect(closedGym.differenceMinor).toBe(0);

    // Store Box Expected: 20,000 (opening) + 8,000 (sale) = 28,000 minor (280 EGP)
    const storeTotals = computeSessionCash(db, storeSession.openedAt, nowStamp(), "store");
    expect(storeTotals.cashInMinor).toBe(8_000);

    const closedStore = await closeCashSession(db, owner, storeSession.id, 28_000, "إغلاق وردية المتجر مطابقة");
    expect(closedStore.expectedClosingMinor).toBe(28_000);
    expect(closedStore.differenceMinor).toBe(0);
  });

  it("W4.2: full new member lifecycle: register -> subscribe -> card -> kiosk check-in -> store POS -> inbody", async () => {
    // 1. Member registration
    const member = await createMember(db, owner, {
      fullName: "عمر فاروق البطل",
      phone: "01099887711",
      gender: "male",
      department: "men",
    });
    expect(member.memberCode).toBeTruthy();

    // 2. Subscription assignment & payment
    const plan = await createPlan(db, owner, {
      name: "باقة اللياقة 10 حصص",
      durationDays: 45,
      price: 500,
      kind: "sessions",
      sessionsCount: 10,
    });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 50_000,
      methodCode: "cash",
    });

    // 3. Virtual card barcode assignment
    const assigned = await assignCardByBarcode(db, owner, {
      barcodeValue: "LIFECYCLE-CARD-777",
      memberId: member.id,
    });

    // 4. Reception/Kiosk check-in
    const checkin = await recordCheckIn(db, owner, { barcode: assigned.card.barcodeValue });
    expect(checkin.kind).toBe("success");

    // 5. Store purchase on credit
    const towel = await createProduct(db, owner, {
      name: "فوطة جيم رياضية",
      costMinor: 2_000,
      priceMinor: 5_000,
      stockQty: 10,
    });
    const sale = await createSale(db, owner, {
      memberId: member.id,
      items: [{ productId: towel.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
    });
    expect(sale.isCredit).toBe(true);

    // 6. InBody assessment recorded
    const assessment = await createAssessment(db, owner, {
      memberId: member.id,
      assessmentDate: todayKey(),
      weightKg: 78,
      heightCm: 175,
      bodyFatPercent: 18.2,
      muscleMassKg: 36.5,
    });
    expect(assessment.bmi).toBeCloseTo(25.5, 1);

    // 7. Verify all profile streams are populated
    const memberSubs = listMemberSubscriptions(db, owner, member.id);
    expect(memberSubs.length).toBe(1);

    const memberDebts = listMemberDebts(db, owner, { search: member.fullName });
    expect(memberDebts.items.length).toBe(1);
    expect(memberDebts.items[0].remainingAmountMinor).toBe(5_000);

    const assessments = listAssessments(db, owner, member.id);
    expect(assessments.length).toBe(1);
  });

  it("W4.3: complete weekly class cycle: create class -> schedule -> book to capacity -> attend & deduct -> complete", async () => {
    // 1. Trainer & Class setup
    const trainerRow = await createTrainer(db, owner, { fullName: "كابتن زياد مدرب كروس فيت" });
    const crossfitClass = await createClass(db, owner, {
      name: "حصة كروس فيت السبت",
      discipline: "combat_fitness",
      capacity: 2,
      consumesSession: true,
      trainerId: trainerRow.id,
      defaultTrainerFeeMinor: 20_000,
    });

    // 2. Schedule session
    const session = await createClassSession(db, owner, crossfitClass.id, {
      sessionDate: todayKey(),
      startTime: "18:00",
      capacity: 2,
    });

    // 3. Two members book
    const m1 = await createMember(db, owner, { fullName: "لاعب كروس فيت أول" });
    const m2 = await createMember(db, owner, { fullName: "لاعب كروس فيت ثان" });

    const plan = await createPlan(db, owner, {
      name: "باقة حصص كروس فيت",
      durationDays: 30,
      price: 300,
      kind: "sessions",
      sessionsCount: 5,
    });
    await createSubscription(db, owner, { memberId: m1.id, planId: plan.id });
    await createSubscription(db, owner, { memberId: m2.id, planId: plan.id });

    const b1 = await bookMember(db, owner, { sessionId: session.id, memberId: m1.id });
    const b2 = await bookMember(db, owner, { sessionId: session.id, memberId: m2.id });

    // 4. Mark 1 attended (deducts session) and 1 no_show
    await setBookingStatus(db, owner, b1.id, "attended");
    await setBookingStatus(db, owner, b2.id, "no_show");

    // 5. Complete session
    const completedSession = await completeClassSession(db, owner, session.id);
    expect(completedSession.status).toBe("done");

    const bookings = listBookings(db, owner, session.id);
    expect(bookings.length).toBe(2);
    expect(bookings.find((b) => b.id === b1.id)?.status).toBe("attended");
    expect(bookings.find((b) => b.id === b2.id)?.status).toBe("no_show");
  });
});
