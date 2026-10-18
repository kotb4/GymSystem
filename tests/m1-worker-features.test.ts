import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  openCashSession,
  closeCashSession,
  getOpenSessionTotals,
  listCashSessions,
} from "@/core/services/cash-session.service";
import {
  createProduct,
  createProductCategory,
  createSale,
  getProductSalesReport,
  listProducts,
} from "@/core/services/store.service";
import { formatTime12, formatDateShort } from "@/services/format";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";

describe("Milestone 1: Financial Hub & Store Telemetry Enhancements", () => {
  let db: Db;
  let owner: ReturnType<typeof buildActor>;
  let cashier: ReturnType<typeof buildActor>;

  beforeEach(async () => {
    db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "GymGate Test",
      ownerFullName: "مالك الصالة",
      username: "owner",
      password: "Owner@2026",
    });
    owner = buildActor(ownerUser);

    cashier = buildActor(
      await createUser(db, owner, {
        username: "cashier1",
        password: "Cashier@2026",
        fullName: "كاشير الاستقبال",
        roleId: "reception",
      }),
    );
  });

  it("calculates Expected vs Counted discrepancy and records permanent discrepancy audit", async () => {
    // 1. Open shift drawer with 500 EGP opening balance
    const session = await openCashSession(db, cashier, {
      openingBalanceMinor: 50000,
      box: "gym",
    });
    expect(session.status).toBe("open");
    expect(session.openingBalanceMinor).toBe(50000);

    // 2. Query open session totals
    const openTotals = getOpenSessionTotals(db, cashier);
    expect(openTotals).not.toBeNull();
    expect(openTotals!.expectedMinor).toBe(50000);

    // 3. Close shift with 480 EGP counted (20 EGP shortage)
    const closed = await closeCashSession(db, cashier, session.id, 48000, "عجز 20 جنيه بسبب فكة");
    expect(closed.status).toBe("closed");
    expect(closed.expectedClosingMinor).toBe(50000);
    expect(closed.countedClosingMinor).toBe(48000);
    expect(closed.differenceMinor).toBe(-2000); // 20 EGP shortage

    // 4. Verify discrepancy is queryable in closed sessions list
    const sessionsList = listCashSessions(db, owner, {
      status: "closed",
      discrepancy: "shortage",
    });
    expect(sessionsList.total).toBe(1);
    expect(sessionsList.items[0].differenceMinor).toBe(-2000);
    expect(sessionsList.items[0].closeNote).toBe("عجز 20 جنيه بسبب فكة");
  });

  it("identifies Today's Best Seller product and flags low-stock products for purchase restocking", async () => {
    // 1. Create category and products
    const cat = createProductCategory(db, owner, "مكملات تجريبية M1");
    const p1 = await createProduct(db, owner, {
      categoryId: cat.id,
      name: "واي بروتين جولد ستاندرد",
      costMinor: 150000,
      priceMinor: 200000,
      minStockQty: 5,
      stockQty: 20,
    });
    const p2 = await createProduct(db, owner, {
      categoryId: cat.id,
      name: "كرياتين مونوهيدرات 300 جم",
      costMinor: 50000,
      priceMinor: 75000,
      minStockQty: 3,
      stockQty: 4, // low stock!
    });

    const member = await createMember(db, owner, {
      fullName: "محمد أحمد",
      phone: "01011112222",
    });

    // 2. Sell 5 units of p1 and 2 units of p2
    await createSale(db, owner, {
      items: [{ productId: p1.id, qty: 5 }],
      isCredit: false,
      methodCode: "cash",
      memberId: member.id,
    });
    await createSale(db, owner, {
      items: [{ productId: p2.id, qty: 2 }],
      isCredit: false,
      methodCode: "cash",
      memberId: member.id,
    });

    // 3. Query product sales report to verify best seller
    const today = todayKey();
    const report = getProductSalesReport(db, owner, {
      fromKey: today,
      toKey: today,
    });

    expect(report.length).toBe(2);
    // Sort by units sold descending
    const sorted = [...report].sort((a, b) => b.netUnits - a.netUnits);
    expect(sorted[0].productId).toBe(p1.id);
    expect(sorted[0].productName).toBe("واي بروتين جولد ستاندرد");
    expect(sorted[0].unitsSold).toBe(5);

    // 4. Verify low-stock flag on p2
    const prods = listProducts(db, owner, {});
    const p2Fresh = prods.items.find((p) => p.id === p2.id)!;
    expect(p2Fresh.stockQty).toBe(2); // 4 - 2 = 2
    expect(p2Fresh.lowStock).toBe(true); // stockQty (2) <= minStockQty (3)
  });

  it("formats dates and 12-hour AM/PM Arabic timestamps accurately", () => {
    // Test afternoon time (PM -> م)
    const pmTime = "2026-10-16 14:35:00";
    const formattedPm = formatTime12(pmTime);
    expect(formattedPm).toBe("2:35 م");

    // Test morning time (AM -> ص)
    const amTime = "2026-10-16 09:05:00";
    const formattedAm = formatTime12(amTime);
    expect(formattedAm).toBe("9:05 ص");

    // Test midnight (12:00 AM -> 12:00 ص)
    const midnight = "2026-10-16 00:00:00";
    const formattedMidnight = formatTime12(midnight);
    expect(formattedMidnight).toBe("12:00 ص");

    // Test noon (12:00 PM -> 12:00 م)
    const noon = "2026-10-16 12:00:00";
    const formattedNoon = formatTime12(noon);
    expect(formattedNoon).toBe("12:00 م");

    // Test date formatting
    const d = new Date("2026-10-16T12:00:00");
    const formattedDate = formatDateShort(d);
    expect(formattedDate).toContain("أكتوبر");
  });
});
