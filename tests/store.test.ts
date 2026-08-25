import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  createProductCategory,
  listProductCategories,
  createProduct,
  getProduct,
  updateProduct,
  listProducts,
  adjustStock,
  listStockMovements,
  createSale,
  getSale,
  voidStoreSale,
  repayStoreDebt,
  getStoreStats,
  getMemberStoreDebtTotal,
} from "@/core/services/store.service";
import { writeSettingInternal, SETTING_KEYS } from "@/core/services/settings.service";
import { todayKey, addDaysKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "جيم برو",
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

async function member() {
  return createMember(db, owner, {
    fullName: "عضو متجر",
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function seedProduct(overrides: { stockQty?: number; priceMinor?: number; costMinor?: number; minStockQty?: number } = {}) {
  return createProduct(db, owner, {
    name: `منتج ${Math.random().toString(36).slice(2, 8)}`,
    costMinor: overrides.costMinor ?? 5000,
    priceMinor: overrides.priceMinor ?? 10000,
    stockQty: overrides.stockQty ?? 20,
    minStockQty: overrides.minStockQty ?? 5,
  });
}

describe("store categories", () => {
  it("lists seeded categories", () => {
    const cats = listProductCategories(db, owner);
    expect(cats.length).toBeGreaterThanOrEqual(5);
  });

  it("creates a new category", () => {
    const cat = createProductCategory(db, owner, "مكملات جديدة");
    expect(cat.nameAr).toBe("مكملات جديدة");
    expect(listProductCategories(db, owner).length).toBeGreaterThanOrEqual(6);
  });

  it("rejects duplicate category name", () => {
    createProductCategory(db, owner, "فئة فريدة");
    expect(() => createProductCategory(db, owner, "فئة فريدة")).toThrow();
  });

  it("denies reception user from creating categories", () => {
    expect(() => createProductCategory(db, reception, "ممنوع")).toThrow();
  });
});

describe("store products", () => {
  it("creates product with opening stock movement", async () => {
    const p = await seedProduct({ stockQty: 10 });
    expect(p.name).toBeTruthy();
    expect(p.stockQty).toBe(10);
    expect(p.barcode).toBeNull();
  });

  it("creates product with explicit barcode", async () => {
    const withBarcode = await createProduct(db, owner, {
      name: "باركود",
      costMinor: 3000,
      priceMinor: 6000,
      barcode: "123456789",
    });
    expect(withBarcode.barcode).toBe("123456789");
  });

  it("updates product name and price", async () => {
    const p = await seedProduct({ priceMinor: 10000 });
    const updated = await updateProduct(db, owner, p.id, { name: "الاسم الجديد", priceMinor: 15000 });
    expect(updated.name).toBe("الاسم الجديد");
    expect(updated.priceMinor).toBe(15000);
  });

  it("lists products with search", async () => {
    await createProduct(db, owner, { name: "بروتين واي", costMinor: 5000, priceMinor: 10000 });
    await createProduct(db, owner, { name: "كرياتين", costMinor: 3000, priceMinor: 7000 });
    expect(listProducts(db, owner, { search: "بروتين" }).total).toBe(1);
    expect(listProducts(db, owner, {}).total).toBe(2);
  });
});

describe("stock adjustments", () => {
  it("adds stock via adjustStock and records movement", async () => {
    const p = await seedProduct({ stockQty: 5 });
    const updated = await adjustStock(db, owner, {
      productId: p.id,
      movementType: "stock_in",
      delta: 10,
    });
    expect(updated.stockQty).toBe(15);

    const movements = listStockMovements(db, owner, { productId: p.id });
    expect(movements.some((m) => m.movementType === "stock_in" && m.delta === 10)).toBe(true);
  });

  it("rejects negative stock when setting is 0", async () => {
    writeSettingInternal(db, SETTING_KEYS.allowNegativeStock, "0");
    const p = await seedProduct({ stockQty: 3 });
    await expect(
      adjustStock(db, owner, { productId: p.id, movementType: "manual_adjust", delta: -5 }),
    ).rejects.toThrow();
  });
});

describe("sales", () => {
  it("creates a cash sale with stock deduction", async () => {
    const p = await seedProduct({ stockQty: 10, priceMinor: 10000 });
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 2 }],
      methodCode: "cash",
    });
    expect(sale.totalMinor).toBe(20000);
    expect(sale.methodCode).toBe("cash");
    expect(sale.items.length).toBe(1);

    const refreshed = getProduct(db, owner, p.id);
    expect(refreshed.stockQty).toBe(8);
  });

  it("creates a credit sale with store debt", async () => {
    const m = await member();
    const p = await seedProduct({ stockQty: 5, priceMinor: 10000 });
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
      memberId: m.id,
    });
    expect(sale.isCredit).toBe(true);

    const debt = getMemberStoreDebtTotal(db, owner, m.id);
    expect(debt).toBe(10000);
  });

  it("repays a store debt partially", async () => {
    const m = await member();
    const p = await seedProduct({ stockQty: 5, priceMinor: 10000 });
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
      memberId: m.id,
    });

    const debtRow = db.first<{ id: string }>("SELECT id FROM store_debts WHERE sale_id = ?", [sale.id]);
    const result = await repayStoreDebt(db, owner, {
      debtId: debtRow!.id,
      amountMinor: 5000,
      methodCode: "cash",
    });
    expect(result.paidMinor).toBe(5000);
    expect(result.status).toBe("open");
  });
});

describe("void sale", () => {
  it("voids a sale, reverses stock and marks status", async () => {
    const p = await seedProduct({ stockQty: 10, priceMinor: 10000 });
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 3 }],
      methodCode: "cash",
    });
    expect(sale.status).toBe("completed");

    await voidStoreSale(db, owner, sale.id, "إلغاء البيع بالخطأ");

    const getSaleResult = getSale(db, owner, sale.id);
    expect(getSaleResult.status).toBe("voided");

    const movements = listStockMovements(db, owner, { productId: p.id });
    const correction = movements.find((m) => m.movementType === "count_correction");
    expect(correction).toBeDefined();
    expect(correction!.delta).toBe(3);
  });
});

describe("store stats", () => {
  it("returns stats for owner", async () => {
    const stats = getStoreStats(db, owner, {
      fromKey: addDaysKey(todayKey(), -30),
      toKey: todayKey(),
    });
    expect(stats).toHaveProperty("salesCount");
    expect(stats).toHaveProperty("lowStockCount");
    expect(stats).toHaveProperty("revenueMinor");
  });

  it("denies reception from viewing stats", () => {
    expect(() =>
      getStoreStats(db, reception, {
        fromKey: addDaysKey(todayKey(), -30),
        toKey: todayKey(),
      }),
    ).toThrow();
  });
});

describe("permission denials", () => {
  it("reception cannot create products", async () => {
    await expect(
      createProduct(db, reception, { name: "ممنوع", costMinor: 1000, priceMinor: 2000 }),
    ).rejects.toThrow();
  });
});
