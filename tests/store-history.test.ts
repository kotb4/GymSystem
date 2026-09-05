import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember, trashMember, purgeMember } from "@/core/services/members.service";
import {
  createProductCategory,
  setProductCategoryActive,
  createProduct,
  updateProduct,
  createSale,
  getSale,
  returnStoreSale,
  getStoreReturn,
  purgeProduct,
  voidStoreSale,
  getProductSalesReport,
} from "@/core/services/store.service";
import {
  recordPayment,
  refundPayment,
  voidPayment,
} from "@/core/services/payments.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
});

async function soldProduct(overrides: { sku?: string | null; priceMinor?: number; stockQty?: number } = {}) {
  return createProduct(db, owner, {
    name: "مصل ويتجعلق",
    sku: overrides.sku ?? "WHEY-1KG",
    priceMinor: overrides.priceMinor ?? 10000,
    costMinor: 7000,
    stockQty: overrides.stockQty ?? 20,
    minStockQty: 2,
  });
}

function ledgerPayment(amountMinor: number, refTable: string, refId: string): number {
  return db.count(
    "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = ? AND ref_id = ? AND entry_type = 'payment' AND amount_minor = ?",
    [refTable, refId, amountMinor],
  );
}

describe("store history integrity (TASK-041)", () => {
  it("snapshots name, SKU, price and cost when selling a product", async () => {
    const p = await soldProduct();
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 3 }],
      methodCode: "cash",
    });

    const item = getSale(db, owner, sale.id).items[0];
    expect(item.productName).toBe("مصل ويتجعلق");
    expect(item.productSku).toBe("WHEY-1KG");
    expect(item.unitPriceMinor).toBe(10000);
    expect(item.lineTotalMinor).toBe(30000);
    expect(item.returnedQty).toBe(0);
  });

  it("keeps the original name, SKU and price on the receipt after the product is renamed/re-priced/re-SKU'd", async () => {
    const p = await soldProduct();
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 2 }],
      methodCode: "cash",
    });

    await updateProduct(db, owner, p.id, {
      name: "مصل جديد 2026",
      sku: "WHEY-NEW",
      priceMinor: 15000,
    });

    const item = getSale(db, owner, sale.id).items[0];
    expect(item.productName).toBe("مصل ويتجعلق");
    expect(item.productSku).toBe("WHEY-1KG");
    expect(item.unitPriceMinor).toBe(10000);
    expect(item.lineTotalMinor).toBe(20000);

    // report revenue math is computed from the immutable line snapshots
    const today = todayKey();
    const report = getProductSalesReport(db, owner, { fromKey: today, toKey: today });
    const row = report.find((r) => r.productId === p.id);
    expect(row?.unitsSold).toBe(2);
    expect(row?.revenueMinor).toBe(20000);
    expect(row?.grossProfitMinor).toBe(20000 - 2 * 7000);
  });

  it("archiving a product (is_active=false) keeps its sale history and blocks new sales", async () => {
    const p = await soldProduct();
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 1 }],
      methodCode: "cash",
    });

    const archived = await updateProduct(db, owner, p.id, { isActive: false });
    expect(archived.isActive).toBe(false);

    expect(getSale(db, owner, sale.id).items[0].productName).toBe("مصل ويتجعلق");
    const today = todayKey();
    const report = getProductSalesReport(db, owner, { fromKey: today, toKey: today });
    expect(report.find((r) => r.productId === p.id)?.unitsSold).toBe(1);

    await expect(
      createSale(db, owner, { items: [{ productId: p.id, qty: 1 }], methodCode: "cash" }),
    ).rejects.toMatchObject({ messageKey: "errors.store.productInactive" });
  });

  it("refuses destructive purge of a product referenced by sales; nothing is deleted or audited", async () => {
    const p = await soldProduct();
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 1 }],
      methodCode: "cash",
    });

    await expect(purgeProduct(db, owner, p.id)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "errors.store.productSold",
    });
    expect(db.count("SELECT COUNT(*) AS c FROM products WHERE id = ?", [p.id])).toBe(1);
    expect(db.count("SELECT COUNT(*) AS c FROM store_sale_items WHERE sale_id = ?", [sale.id])).toBe(1);
    expect(db.count("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?", [p.id])).toBeGreaterThan(0);
    expect(
      db.count("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'PRODUCT_PURGED'"),
    ).toBe(0);
  });

  it("denies non-owner roles from purging (permission check precedes history guard)", async () => {
    const reception = buildActor(
      await createUser(db, owner, {
        username: "reception",
        password: "Recep@2026",
        fullName: "استقبال",
        roleId: "reception",
      }),
    );
    const p = await soldProduct();
    await expect(purgeProduct(db, reception, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps original snapshot data on a return even after the product changed", async () => {
    const p = await soldProduct();
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 4 }],
      methodCode: "cash",
    });
    const saleItemId = getSale(db, owner, sale.id).items[0].id;

    await updateProduct(db, owner, p.id, { name: "اسم معدل", sku: "SKU-2", priceMinor: 5000 });

    const ret = await returnStoreSale(db, owner, {
      saleId: sale.id,
      lines: [{ saleItemId, qty: 1 }],
      reason: "تجربة",
    });

    const retItem = getStoreReturn(db, owner, ret.id).items[0];
    expect(retItem.productName).toBe("مصل ويتجعلق");
    expect(retItem.productSku).toBe("WHEY-1KG");
    expect(retItem.unitPriceMinor).toBe(10000);
    expect(retItem.lineTotalMinor).toBe(10000);

    const saleItem = getSale(db, owner, sale.id).items[0];
    expect(saleItem.returnedQty).toBe(1);
  });

  it("voiding a sale keeps the document and records a ledger reversal beside the original payment", async () => {
    const p = await soldProduct();
    const sale = await createSale(db, owner, {
      items: [{ productId: p.id, qty: 2 }],
      methodCode: "cash",
    });
    expect(ledgerPayment(20000, "store_sales", sale.id)).toBe(1);

    await voidStoreSale(db, owner, sale.id, "خطأ في البيع");

    expect(db.count("SELECT COUNT(*) AS c FROM store_sales WHERE id = ? AND status = 'voided'", [sale.id])).toBe(1);
    expect(db.count("SELECT COUNT(*) AS c FROM store_sale_items WHERE sale_id = ?", [sale.id])).toBe(1);
    expect(ledgerPayment(20000, "store_sales", sale.id)).toBe(1);
    expect(
      db.count(
        "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'store_sales' AND ref_id = ? AND entry_type = 'reversal_payment' AND direction = -1 AND amount_minor = 20000",
        [sale.id],
      ),
    ).toBe(1);
  });

  it("records a refund ledger entry without mutating the original payment entry (ledger immutability)", async () => {
    const m = await createMember(db, owner, {
      fullName: "عضو استرداد",
      phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    });
    const payment = await recordPayment(db, owner, {
      memberId: m.id,
      baseAmountMinor: 50000,
      paidAmountMinor: 50000,
      methodCode: "cash",
    });
    expect(ledgerPayment(50000, "payments", payment.id)).toBe(1);

    await refundPayment(db, owner, payment.id, 20000, "استرداد جزئي");

    expect(ledgerPayment(50000, "payments", payment.id)).toBe(1);
    const refundId = db.scalar(
      "SELECT id FROM payment_refunds WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1",
      [payment.id],
    );
    expect(refundId).toBeTruthy();
    expect(
      db.count(
        "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'payment_refunds' AND ref_id = ? AND entry_type = 'refund' AND direction = -1 AND amount_minor = 20000",
        [String(refundId)],
      ),
    ).toBe(1);
  });

  it("voiding a payment records a reversal entry; the original payment entry stays intact", async () => {
    const m = await createMember(db, owner, {
      fullName: "عضو إلغاء",
      phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    });
    const payment = await recordPayment(db, owner, {
      memberId: m.id,
      baseAmountMinor: 40000,
      paidAmountMinor: 40000,
      methodCode: "cash",
    });

    await voidPayment(db, owner, payment.id, "خطأ في التسجيل");

    expect(ledgerPayment(40000, "payments", payment.id)).toBe(1);
    expect(
      db.count(
        "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ? AND entry_type = 'reversal_payment' AND direction = -1 AND amount_minor = 40000",
        [payment.id],
      ),
    ).toBe(1);
  });

  it("writes accurate audit records for product categories and member purges", async () => {
    const cat = createProductCategory(db, owner, "فئة لسجل العمليات");
    const auditCat = db.first<{ action: string; entity_type: string; entity_id: string }>(
      "SELECT action, entity_type, entity_id FROM audit_logs ORDER BY id DESC LIMIT 1",
    );
    expect(auditCat).toMatchObject({
      action: "PRODUCT_CATEGORY_CREATED",
      entity_type: "product_category",
      entity_id: cat.id,
    });

    setProductCategoryActive(db, owner, cat.id, false);
    const auditToggle = db.first<{ action: string; entity_type: string; entity_id: string }>(
      "SELECT action, entity_type, entity_id FROM audit_logs ORDER BY id DESC LIMIT 1",
    );
    expect(auditToggle).toMatchObject({
      action: "PRODUCT_CATEGORY_TOGGLED",
      entity_type: "product_category",
      entity_id: cat.id,
    });

    const m = await createMember(db, owner, {
      fullName: "عضو للحذف",
      phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    });
    await trashMember(db, owner, m.id, "اختبار");
    await purgeMember(db, owner, m.id);
    const auditPurge = db.first<{ action: string; entity_id: string | null }>(
      "SELECT action, entity_id FROM audit_logs WHERE action = 'MEMBER_PURGED'",
    );
    expect(auditPurge?.entity_id).toBe(m.id);
  });
});