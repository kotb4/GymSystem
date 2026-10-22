import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  createProductCategory,
  createProduct,
  createSale,
  getSale,
  getStoreStats,
  returnStoreSale,
} from "@/core/services/store.service";
import {
  getPaymentMethodsBreakdown,
  listLedgerEntries,
} from "@/core/services/finance.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import {
  openCashSession,
  closeCashSession,
  getOpenSessionTotals,
} from "@/core/services/cash-session.service";
import { createExpense } from "@/core/services/expenses.service";
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
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
});

describe("Treasury & Store Integration with Isolated Profit Testing", () => {
  it("computes accurate profit, COGS, margin, and multi-payment breakdowns across treasury", async () => {
    // 1. Create member & category & test products
    const mem = await createMember(db, reception, {
      fullName: "أحمد كمال (اختبار أرباح)",
      phone: "01011112222",
    });

    const cat = createProductCategory(db, owner, "مكملات غذائية ومشروبات");

    // Product 1: Whey Protein (Selling: 1,200 EGP, Cost: 800 EGP, Profit/unit: 400 EGP)
    const whey = await createProduct(db, owner, {
      categoryId: cat.id,
      name: "واي بروتين جولد",
      priceMinor: 120000,
      costMinor: 80000,
      stockQty: 50,
      minStockQty: 5,
    });

    // Product 2: Pre-Workout (Selling: 650 EGP, Cost: 400 EGP, Profit/unit: 250 EGP)
    const preWorkout = await createProduct(db, owner, {
      categoryId: cat.id,
      name: "سي 4 بري ورك أوت",
      priceMinor: 65000,
      costMinor: 40000,
      stockQty: 40,
      minStockQty: 5,
    });

    // Product 3: Energy Drink (Selling: 50 EGP, Cost: 30 EGP, Profit/unit: 20 EGP)
    const energyDrink = await createProduct(db, owner, {
      categoryId: cat.id,
      name: "مشروب طاقة ريدبول",
      priceMinor: 5000,
      costMinor: 3000,
      stockQty: 100,
      minStockQty: 10,
    });

    // 2. Perform sales across different payment methods
    // Sale A: Cash (1x Whey Protein) -> Total: 1,200 EGP, Cost: 800 EGP, Profit: 400 EGP
    const saleCash = await createSale(db, reception, {
      memberId: mem.id,
      methodCode: "cash",
      items: [{ productId: whey.id, qty: 1 }],
    });
    expect(saleCash.totalMinor).toBe(120000);
    expect(saleCash.costTotalMinor).toBe(80000);
    expect(saleCash.grossProfitMinor).toBe(40000);

    // Sale B: InstaPay (2x Pre-Workout) -> Total: 1,300 EGP, Cost: 800 EGP, Profit: 500 EGP
    const saleInsta = await createSale(db, reception, {
      memberId: mem.id,
      methodCode: "instapay",
      items: [{ productId: preWorkout.id, qty: 2 }],
    });
    expect(saleInsta.totalMinor).toBe(130000);
    expect(saleInsta.costTotalMinor).toBe(80000);
    expect(saleInsta.grossProfitMinor).toBe(50000);

    // Sale C: Mobile Wallet (5x Energy Drink) -> Total: 250 EGP, Cost: 150 EGP, Profit: 100 EGP
    const saleWallet = await createSale(db, reception, {
      memberId: mem.id,
      methodCode: "wallet",
      items: [{ productId: energyDrink.id, qty: 5 }],
    });
    expect(saleWallet.totalMinor).toBe(25000);
    expect(saleWallet.costTotalMinor).toBe(15000);
    expect(saleWallet.grossProfitMinor).toBe(10000);

    // Sale D: Visa / Bank Card (1x Whey) -> Total: 1,200 EGP, Cost: 800 EGP, Profit: 400 EGP
    const saleCard = await createSale(db, reception, {
      memberId: mem.id,
      methodCode: "bank_card",
      items: [{ productId: whey.id, qty: 1 }],
    });
    expect(saleCard.totalMinor).toBe(120000);
    expect(saleCard.grossProfitMinor).toBe(40000);

    // 3. Check Overall Store Profit Stats
    // Expected Totals:
    // Revenue: 1,200 + 1,300 + 250 + 1,200 = 3,950 EGP (395,000 minor)
    // COGS: 800 + 800 + 150 + 800 = 2,550 EGP (255,000 minor)
    // Gross Profit: 3,950 - 2,550 = 1,400 EGP (140,000 minor)
    const today = todayKey();
    const stats = await getStoreStats(db, owner, { fromKey: today, toKey: today });
    expect(stats.salesCount).toBe(4);
    expect(stats.revenueMinor).toBe(395000);
    expect(stats.costMinor).toBe(255000);
    expect(stats.grossProfitMinor).toBe(140000);

    // 4. Test Payment Methods Breakdown scoped to Store
    const storeBreakdown = await getPaymentMethodsBreakdown(db, owner, {
      box: "store",
      fromKey: today,
      toKey: today,
    });
    expect(storeBreakdown.totalNetMinor).toBe(395000);
    expect(storeBreakdown.totalCount).toBe(4);

    const cashItem = storeBreakdown.methods.find((i) => i.code === "cash");
    expect(cashItem).toBeDefined();
    expect(cashItem?.netMinor).toBe(120000);
    expect(cashItem?.percentage).toBe(30.4);

    const instaItem = storeBreakdown.methods.find((i) => i.code === "instapay");
    expect(instaItem).toBeDefined();
    expect(instaItem?.netMinor).toBe(130000);
    expect(instaItem?.percentage).toBe(32.9);

    const walletItem = storeBreakdown.methods.find((i) => i.code === "wallet");
    expect(walletItem).toBeDefined();
    expect(walletItem?.netMinor).toBe(25000);
    expect(walletItem?.percentage).toBe(6.3);

    const cardItem = storeBreakdown.methods.find((i) => i.code === "bank_card");
    expect(cardItem).toBeDefined();
    expect(cardItem?.netMinor).toBe(120000);
    expect(cardItem?.percentage).toBe(30.4);

    // 5. Test Gym Membership Payment Integration into Treasury
    // Add a gym membership payment (e.g. 1,000 EGP via InstaPay)
    const plan = await createPlan(db, owner, {
      name: "اشتراك شهري حديد",
      durationDays: 30,
      price: 1000,
    });
    const sub = await createSubscription(db, reception, {
      memberId: mem.id,
      planId: plan.id,
      startDate: today,
    });
    await recordPayment(db, reception, {
      memberId: mem.id,
      subscriptionId: sub.id,
      baseAmountMinor: 100000,
      paidAmountMinor: 100000,
      methodCode: "instapay",
    });

    // Now test Combined Treasury Breakdown (box = 'all')
    const combinedBreakdown = await getPaymentMethodsBreakdown(db, owner, {
      box: "all",
      fromKey: today,
      toKey: today,
    });
    // Total should be store 3,950 EGP + gym 1,000 EGP = 4,950 EGP (495,000 minor)
    expect(combinedBreakdown.totalNetMinor).toBe(495000);
    const combinedInsta = combinedBreakdown.methods.find((i) => i.code === "instapay");
    // InstaPay should now have store 1,300 + gym 1,000 = 2,300 EGP
    expect(combinedInsta?.netMinor).toBe(230000);

    // 6. Test Financial Ledger filtering by methodCode
    const ledgerInsta = listLedgerEntries(db, owner, {
      methodCode: "instapay",
    });
    // Should have 2 entries: 1 from gym sub, 1 from store sale
    expect(ledgerInsta.total).toBe(2);
    expect(ledgerInsta.items.every((item) => item.methodCode === "instapay")).toBe(true);

    const ledgerCash = listLedgerEntries(db, owner, {
      methodCode: "cash",
      box: "store",
    });
    expect(ledgerCash.total).toBe(1);
    expect(ledgerCash.items[0].amountMinor).toBe(120000);

    // 7. Test Partial Return & Profit Correction
    // Retrieve sale details to get line item ID
    const saleWalletDetails = await getSale(db, reception, saleWallet.id);
    expect(saleWalletDetails.items.length).toBe(1);
    const lineItem = saleWalletDetails.items[0];

    // Return 2 energy drinks from Sale C (2 * 50 EGP = 100 EGP refunded, 2 * 30 EGP = 60 EGP cost reverted)
    const returnRecord = await returnStoreSale(db, owner, {
      saleId: saleWallet.id,
      reason: "تبديل نكهة",
      lines: [{ saleItemId: lineItem.id, qty: 2 }],
    });
    expect(returnRecord.totalMinor).toBe(10000);

    // Check adjusted stats
    const statsAfterReturn = await getStoreStats(db, owner, { fromKey: today, toKey: today });
    // Revenue was 3,950 - 100 = 3,850 EGP (385,000 minor)
    expect(statsAfterReturn.revenueMinor).toBe(385000);
    // Cost was 2,550 - 60 = 2,490 EGP (249,000 minor)
    expect(statsAfterReturn.costMinor).toBe(249000);
    // Profit is 3,850 - 2,490 = 1,360 EGP (136,000 minor)
    expect(statsAfterReturn.grossProfitMinor).toBe(136000);

    // Check adjusted wallet in breakdown
    const walletAfter = await getPaymentMethodsBreakdown(db, owner, {
      box: "store",
      fromKey: today,
      toKey: today,
    });
    const walletItemAfter = walletAfter.methods.find((i) => i.code === "wallet");
    // Wallet net was 250 - 100 = 150 EGP (15,000 minor)
    expect(walletItemAfter?.inflowMinor).toBe(25000);
    expect(walletItemAfter?.outflowMinor).toBe(10000);
    expect(walletItemAfter?.netMinor).toBe(15000);
  });

  it("operates seamlessly as ONE unified cash drawer / treasury for both gym and store without opening two shifts", async () => {
    // 1. Receptionist opens ONE single shift for the day with 500 EGP (50,000 minor)
    const session = await openCashSession(db, reception, {
      openingBalanceMinor: 50000,
      box: "gym",
    });
    expect(session.status).toBe("open");

    // 2. Member buys a gym subscription in cash (800 EGP = 80,000 minor)
    const mem = await createMember(db, reception, {
      fullName: "خالد سعيد (مشترك جديد)",
      phone: "01099998888",
    });
    const plan = await createPlan(db, owner, {
      name: "اشتراك جيم عادي",
      durationDays: 30,
      price: 800,
    });
    const sub = await createSubscription(db, reception, {
      memberId: mem.id,
      planId: plan.id,
      startDate: todayKey(),
    });
    await recordPayment(db, reception, {
      memberId: mem.id,
      subscriptionId: sub.id,
      baseAmountMinor: 80000,
      paidAmountMinor: 80000,
      methodCode: "cash",
    });

    // 3. Member buys a protein shaker & drink from the store in cash (120 EGP = 12,000 minor)
    const cat = createProductCategory(db, owner, "إكسسوارات ومشروبات");
    const drink = await createProduct(db, owner, {
      categoryId: cat.id,
      name: "شيكر بروتين ومشروب",
      priceMinor: 12000,
      costMinor: 8000,
      stockQty: 20,
    });
    await createSale(db, reception, {
      memberId: mem.id,
      methodCode: "cash",
      items: [{ productId: drink.id, qty: 1 }],
    });

    // 4. Record a small cash expense (50 EGP = 5,000 minor)
    await createExpense(db, owner, {
      categoryId: "cat-supplies",
      amountMinor: 5000,
      methodCode: "cash",
      description: "أدوات نظافة للمكتب",
    });

    // 5. Query the unified session totals:
    // Opening balance: 500 EGP (50,000 minor)
    // Cash in: 800 (Gym) + 120 (Store) = 920 EGP (92,000 minor)
    // Cash out: 50 EGP (5,000 minor)
    // Expected in drawer = 500 + 920 - 50 = 1,370 EGP (137,000 minor)
    const totals = getOpenSessionTotals(db, reception, "gym") as {
      openingMinor: number;
      cashInMinor: number;
      cashOutMinor: number;
      expectedMinor: number;
    } | null;
    expect(totals).not.toBeNull();
    expect(totals?.openingMinor).toBe(50000);
    expect(totals?.cashInMinor).toBe(92000);
    expect(totals?.cashOutMinor).toBe(5000);
    expect(totals?.expectedMinor).toBe(137000);

    // 6. Close the unified shift counting 1,370 EGP
    const closed = await closeCashSession(db, reception, session.id, 137000, "إقفال متطابق للخزينة الموحدة");
    expect(closed.status).toBe("closed");
    expect(closed.differenceMinor).toBe(0);
    expect(closed.expectedClosingMinor).toBe(137000);
    expect(closed.countedClosingMinor).toBe(137000);
  });
});
