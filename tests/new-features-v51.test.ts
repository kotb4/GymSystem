import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { createProduct, createSale } from "@/core/services/store.service";
import { createTrainer } from "@/core/services/trainers.service";
import { createQuickSession, listQuickSessions, getQuickSessionStats } from "@/core/services/quick-session.service";
import { listMemberDebts, payMemberDebt } from "@/core/services/debts.service";
import { createSupplier, listSuppliers, createPurchaseInvoice, listPurchaseInvoices, payPurchaseInvoiceDebt } from "@/core/services/purchases.service";
import { createPTPackage, listPTPackages, createPrivateTraining, recordPTSession, getPTSummary } from "@/core/services/private-training.service";
import { createAnnouncement, listActiveAnnouncements, deleteAnnouncement } from "@/core/services/announcements.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "موظف استقبال",
      roleId: "reception",
    }),
  );
});

describe("v51 Competitive Features Test Suite", () => {
  it("1. Quick Walk-in Sessions (Day Pass) for Guest and Member", async () => {
    // A) Guest walk-in
    const guestSession = createQuickSession(db, reception, {
      clientType: "guest",
      guestName: "زائر تجريبي",
      guestPhone: "01012345678",
      guestGender: "male",
      sessionName: "تذكرة يومية (Day Pass)",
      priceMinor: 10000,
      paidAmountMinor: 10000,
      methodCode: "instapay",
      recordAttendance: true,
      notes: "دفع عبر انستاباي",
    });

    expect(guestSession.id).toBeDefined();
    expect(guestSession.guest_name).toBe("زائر تجريبي");
    expect(guestSession.paid_amount_minor).toBe(10000);
    expect(guestSession.method_code).toBe("instapay");
    expect(guestSession.attendance_recorded).toBe(1);

    // Verify financial ledger entry exists
    const ledger = db.first<{ amount_minor: number; method_code: string }>(
      `SELECT amount_minor, method_code FROM financial_ledger WHERE ref_table = 'quick_sessions' AND ref_id = ?`,
      [guestSession.id],
    );
    expect(ledger).toBeDefined();
    expect(ledger?.amount_minor).toBe(10000);
    expect(ledger?.method_code).toBe("instapay");

    // B) Member walk-in
    const member = await createMember(db, reception, {
      fullName: "عضو حصة سريعة",
      gender: "male",
      phone: "01099998888",
    });

    const memberSession = createQuickSession(db, reception, {
      clientType: "member",
      memberId: member.id,
      sessionName: "حصة تدريب خاصة سريعة",
      priceMinor: 15000,
      paidAmountMinor: 15000,
      methodCode: "wallet",
      recordAttendance: true,
    });

    expect(memberSession.client_type).toBe("member");
    expect(memberSession.member_id).toBe(member.id);

    // Check list & stats
    const listRes = listQuickSessions(db, reception);
    expect(listRes.total).toBe(2);

    const stats = getQuickSessionStats(db, reception, todayKey());
    expect(stats.totalSessionsToday).toBe(2);
    expect(stats.totalRevenueTodayMinor).toBe(25000);
    expect(stats.guestSessionsToday).toBe(1);
    expect(stats.memberSessionsToday).toBe(1);
  });

  it("2. Centralized Debts & Repayment (Subscriptions & Store)", async () => {
    const member = await createMember(db, reception, {
      fullName: "عضو مدين",
      gender: "male",
      phone: "01122233344",
    });

    // Create plan and subscription with partial payment
    const plan = await createPlan(db, owner, {
      name: "باقة سنوية",
      price: 3000, // 3000 EGP = 300,000 minor
      durationDays: 365,
    });

    const sub = await createSubscription(db, reception, {
      memberId: member.id,
      planId: plan.id,
    });

    await recordPayment(db, reception, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 300000,
      paidAmountMinor: 100000,
      methodCode: "cash",
    });

    // Create store product & credit sale
    const product = await createProduct(db, owner, {
      name: "بروتين واي",
      priceMinor: 150000, // 1500 EGP
      costMinor: 100000,
      stockQty: 10,
    });

    await createSale(db, reception, {
      items: [{ productId: product.id, qty: 1 }],
      memberId: member.id,
      isCredit: true,
      methodCode: "cash",
    });

    // Centralized Debts aggregation
    const debtsRes = listMemberDebts(db, reception, { search: "عضو مدين" });
    expect(debtsRes.total).toBe(2);
    expect(debtsRes.totalDebtMinor).toBe(200000 + 150000); // 3500 EGP

    // Repay Subscription Debt
    const subDebt = debtsRes.items.find((d) => d.debtType === "subscription")!;
    expect(subDebt).toBeDefined();
    const paySubRes = payMemberDebt(db, reception, {
      debtType: "subscription",
      debtId: subDebt.debtId,
      amountMinor: 200000,
      methodCode: "instapay",
    });
    expect(paySubRes.remainingMinor).toBe(0);

    // Repay Store Debt
    const storeDebt = debtsRes.items.find((d) => d.debtType === "store")!;
    expect(storeDebt).toBeDefined();
    const payStoreRes = payMemberDebt(db, reception, {
      debtType: "store",
      debtId: storeDebt.debtId,
      amountMinor: 150000,
      methodCode: "cash",
    });
    expect(payStoreRes.remainingMinor).toBe(0);

    // Recheck debts list - should now be 0
    const emptyDebts = listMemberDebts(db, reception, { search: "عضو مدين" });
    expect(emptyDebts.total).toBe(0);
    expect(emptyDebts.totalDebtMinor).toBe(0);
  });

  it("3. Suppliers & Purchase Invoices with Automatic Inventory Replenishment", async () => {
    // Create product with initial stock = 5
    const product = await createProduct(db, owner, {
      name: "مشروب طاقة",
      priceMinor: 5000,
      costMinor: 3000,
      stockQty: 5,
    });

    // Create Supplier
    const supplier = createSupplier(db, owner, {
      name: "شركة الأهرام للمكملات",
      phone: "01000000001",
      companyName: "الأهرام جروب",
    });
    expect(supplier.id).toBeDefined();
    expect(supplier.name).toBe("شركة الأهرام للمكملات");

    // Create Purchase Invoice (purchasing 20 items at cost 30 EGP)
    const invoice = createPurchaseInvoice(db, owner, {
      supplierId: supplier.id,
      invoiceNo: "INV-2026-001",
      items: [
        {
          productId: product.id,
          quantity: 20,
          unitCostMinor: 3000,
        },
      ],
      paidAmountMinor: 40000, // Total = 60,000, Paid = 40,000, Remaining debt = 20,000
      methodCode: "cash",
    });

    expect(invoice.total_amount_minor).toBe(60000);
    expect(invoice.paid_amount_minor).toBe(40000);
    expect(invoice.remaining_amount_minor).toBe(20000);
    expect(invoice.status).toBe("partial");

    // VERIFY automatic store inventory increment: initial 5 + 20 purchased = 25
    const updatedProduct = db.first<{ stock_qty: number }>(
      `SELECT stock_qty FROM products WHERE id = ?`,
      [product.id],
    );
    expect(updatedProduct?.stock_qty).toBe(25);

    // Pay remaining supplier debt
    const payDebtRes = payPurchaseInvoiceDebt(db, owner, {
      invoiceId: invoice.id,
      amountMinor: 20000,
      methodCode: "instapay",
    });
    expect(payDebtRes.remainingMinor).toBe(0);

    const recheckInvoice = listPurchaseInvoices(db, owner);
    expect(recheckInvoice.items[0].status).toBe("paid");
  });

  it("4. Private Training (PT) Module: Packages, Subscriptions & Session Consumption", async () => {
    const member = await createMember(db, reception, {
      fullName: "متدرب برايفت",
      gender: "male",
      phone: "01055556666",
    });

    const trainer = await createTrainer(db, owner, {
      fullName: "كابتن يوسف",
      phone: "01011112222",
      specialization: "كمال أجسام",
    });

    // Create PT Package
    const pkg = createPTPackage(db, owner, {
      name: "باقة 12 حصة برايفت VIP",
      sessionsCount: 12,
      priceMinor: 120000, // 1200 EGP
      durationDays: 30,
      coachCommissionPercent: 40,
    });
    expect(pkg.id).toBeDefined();
    expect(pkg.sessions_count).toBe(12);

    // Create PT Subscription
    const ptSub = createPrivateTraining(db, reception, {
      memberId: member.id,
      trainerId: trainer.id,
      packageId: pkg.id,
      totalSessions: 12,
      priceMinor: 120000,
      paidAmountMinor: 120000,
      methodCode: "cash",
      startDate: todayKey(),
      endDate: todayKey(),
    });
    expect(ptSub.status).toBe("active");
    expect(ptSub.completed_sessions).toBe(0);
    expect(ptSub.remaining_sessions).toBe(12);

    // Consume/Record 1 PT Session
    const consumeRes = recordPTSession(db, reception, {
      privateTrainingId: ptSub.id,
      trainerId: trainer.id,
      sessionDate: todayKey(),
      sessionTime: "18:00",
      notes: "تمرين أرجل قوي",
    });
    expect(consumeRes.completedSessions).toBe(1);
    expect(consumeRes.remainingSessions).toBe(11);

    // Check PT summary
    const summary = getPTSummary(db, reception);
    expect(summary.activeCount).toBe(1);
    expect(summary.totalCompletedSessions).toBe(1);
    expect(summary.totalRevenueMinor).toBe(120000);
  });

  it("5. Allowed Days Restriction Enforcement on Plans", async () => {
    // Current day of week (0 = Sunday, ..., 6 = Saturday)
    const currentDay = new Date().getDay();
    // Pick an allowed day list that DOES NOT include today
    const otherDay = (currentDay + 2) % 7;

    const restrictedPlan = await createPlan(db, owner, {
      name: "باقة أيام محددة فقط",
      price: 500,
      durationDays: 30,
      allowedDays: [otherDay], // Does not allow today
    });

    const member = await createMember(db, reception, {
      fullName: "عضو قيود الأيام",
      gender: "male",
    });

    createSubscription(db, reception, {
      memberId: member.id,
      planId: restrictedPlan.id,
      paidAmountMinor: 50000,
    });

    const card = db.first<{ barcode_value: string }>(
      `SELECT barcode_value FROM cards WHERE member_id = ?`,
      [member.id],
    );

    // Attempt check-in on disallowed day
    const checkInRes = await recordCheckIn(db, reception, { barcode: card!.barcode_value });
    expect(checkInRes.kind).toBe("denied");
    if (checkInRes.kind === "denied") {
      expect(checkInRes.reason).toBe("DAY_NOT_ALLOWED");
    }
  });

  it("6. Gym Announcements Banner Management", () => {
    const announcement = createAnnouncement(db, owner, {
      title: "إغلاق الصالة لأعمال الصيانة",
      content: "نحيط سيادتكم علماً بأنه سيتم إغلاق الصالة يوم الجمعة لأعمال الصيانة والتطوير.",
      level: "warning",
    });
    expect(announcement.id).toBeDefined();
    expect(announcement.title).toBe("إغلاق الصالة لأعمال الصيانة");

    const activeList = listActiveAnnouncements(db, reception);
    expect(activeList.length).toBe(1);
    expect(activeList[0].level).toBe("warning");

    deleteAnnouncement(db, owner, announcement.id);
    const afterDelete = listActiveAnnouncements(db, reception);
    expect(afterDelete.length).toBe(0);
  });
});
