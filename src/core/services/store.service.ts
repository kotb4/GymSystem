import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { assertNonNegativeInteger } from "@/core/money";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { insertLedgerEntry } from "./payments.service";
import { recordAudit } from "./audit.service";
import { readSetting, SETTING_KEYS } from "./settings.service";
import {
  assertDepartmentAccess,
  departmentScopeCondition,
  memberDepartmentById,
} from "./department";

type Num = string | number;

function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function stamp(): string {
  return nowStamp();
}

// ----------------------------- categories ---------------------------------

export function listProductCategories(
  db: Db,
  actor: ServiceActor,
  includeInactive = true,
): Array<{ id: string; nameAr: string; isActive: boolean }> {
  requirePermission(actor, "store.view");
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return db
    .all<Row>(`SELECT * FROM product_categories ${where} ORDER BY name_ar`)
    .map((r) => ({ id: str(r.id), nameAr: str(r.name_ar), isActive: num(r.is_active, 1) === 1 }));
}

export function createProductCategory(db: Db, actor: ServiceActor, nameAr: string) {
  requirePermission(actor, "store.products");
  const name = nameAr.trim();
  if (name.length < 2) throw errValidation("errors.store.categoryNameShort");
  if (db.first("SELECT id FROM product_categories WHERE name_ar = ?", [name]))
    throw errConflict("errors.store.categoryExists");
  const id = crypto.randomUUID();
  db.run("INSERT INTO product_categories (id, name_ar, is_active, created_at) VALUES (?, ?, 1, ?)", [
    id,
    name,
    stamp(),
  ]);
  recordAudit(db, actor, "EXPENSE_CATEGORY_CREATED", "product_category", id, { name });
  return { id, nameAr: name };
}

export function setProductCategoryActive(
  db: Db,
  actor: ServiceActor,
  categoryId: string,
  isActive: boolean,
): void {
  requirePermission(actor, "store.products");
  db.run("UPDATE product_categories SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, categoryId]);
}

// ------------------------------- products ---------------------------------

export interface ProductInput {
  name: string;
  categoryId?: string | null;
  sku?: string | null;
  barcode?: string | null;
  costMinor: number;
  priceMinor: number;
  stockQty?: number;
  minStockQty?: number;
  supplierName?: string | null;
}

export interface ProductPublic {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  sku: string | null;
  barcode: string | null;
  costMinor: number;
  priceMinor: number;
  stockQty: number;
  minStockQty: number;
  supplierName: string | null;
  isActive: boolean;
  lowStock: boolean;
}

const PRODUCT_SELECT =
  "SELECT p.*, pc.name_ar AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id";

function mapProduct(r: Row): ProductPublic {
  const stockQty = num(r.stock_qty);
  return {
    id: str(r.id),
    name: str(r.name),
    categoryId: r.category_id == null ? null : str(r.category_id),
    categoryName: r.category_name == null ? null : str(r.category_name),
    sku: r.sku == null ? null : str(r.sku),
    barcode: r.barcode == null ? null : str(r.barcode),
    costMinor: num(r.cost_minor),
    priceMinor: num(r.price_minor),
    stockQty,
    minStockQty: num(r.min_stock_qty),
    supplierName: r.supplier_name == null ? null : str(r.supplier_name),
    isActive: num(r.is_active, 1) === 1,
    lowStock: stockQty <= num(r.min_stock_qty),
  };
}

export function getProduct(db: Db, actor: ServiceActor, productId: string): ProductPublic {
requirePermission(actor, "store.view");
const row = db.first<Row>(`${PRODUCT_SELECT} WHERE p.id = ?`, [productId]);
if (!row) throw errNotFound("errors.store.productNotFound");
return mapProduct(row);
}

/**
 * Hard-deletes a product (ADR-008, amended per owner request): cascades its
 * stock-movement log AND its lines inside historical sale documents — sale
 * headers/totals remain intact, only the referenced line items are removed.
 * The audit entry records how many sale lines were detached.
 */
export async function purgeProduct(
  db: Db,
  actor: ServiceActor,
  productId: string,
): Promise<void> {
  requirePermission(actor, "store.purge");
  const row = db.first<Row>("SELECT id, name FROM products WHERE id = ?", [productId]);
  if (!row) throw errNotFound("errors.store.productNotFound");

  await db.transaction(() => {
    const lines = db.all<{ sale_id: string }>(
      "SELECT DISTINCT sale_id FROM store_sale_items WHERE product_id = ?",
      [productId],
    );
    const returned = db.run(
      "DELETE FROM store_return_items WHERE product_id = ? OR sale_item_id IN (SELECT id FROM store_sale_items WHERE product_id = ?)",
      [productId, productId],
    );
    const sold = db.run("DELETE FROM store_sale_items WHERE product_id = ?", [productId]);
    const moved = db.run("DELETE FROM stock_movements WHERE product_id = ?", [productId]);
    db.run("DELETE FROM products WHERE id = ?", [productId]);
    recordAudit(db, actor, "PRODUCT_PURGED", "product", productId, {
      name: str(row.name),
      movementsRemoved: Number(moved.changes),
      saleLinesRemoved: Number(sold.changes),
      returnItemsRemoved: Number(returned.changes),
      salesAffected: lines.length,
    });
  });
}

export interface ProductListQuery {
  search?: string;
  categoryId?: string;
  lowStockOnly?: boolean;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}

export function listProducts(db: Db, actor: ServiceActor, query: ProductListQuery = {}) {
  requirePermission(actor, "store.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const conditions: string[] = [];
  const params: Num[] = [];
  if (!query.includeInactive) conditions.push("p.is_active = 1");
  if (query.categoryId) {
    conditions.push("p.category_id = ?");
    params.push(query.categoryId);
  }
  if (query.lowStockOnly) conditions.push("p.stock_qty <= p.min_stock_qty");
  const search = query.search?.trim();
  if (search) {
    conditions.push("(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM products p ${where}`, params);
  const rows = db.all<Row>(
    `${PRODUCT_SELECT} ${where} ORDER BY p.name LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapProduct), total };
}

function assertBarcodeFree(db: Db, barcode: string | null | undefined, excludeId?: string): void {
  const b = barcode?.trim();
  if (!b) return;
  const dup = excludeId
    ? db.first("SELECT id FROM products WHERE barcode = ? AND id != ?", [b, excludeId])
    : db.first("SELECT id FROM products WHERE barcode = ?", [b]);
  if (dup) throw errConflict("errors.store.barcodeExists");
}

export async function createProduct(db: Db, actor: ServiceActor, input: ProductInput) {
  requirePermission(actor, "store.products");
  const name = input.name.trim();
  if (name.length < 2) throw errValidation("errors.store.productNameShort");
  assertNonNegativeInteger(Math.round(input.costMinor), "errors.finance.invalidAmount");
  assertNonNegativeInteger(Math.round(input.priceMinor), "errors.finance.invalidAmount");
  assertBarcodeFree(db, input.barcode);
  const id = crypto.randomUUID();
  const openingQty = Number(input.stockQty ?? 0);
  await db.transaction(async () => {
    db.run(
      "INSERT INTO products (id, name, category_id, sku, barcode, cost_minor, price_minor, stock_qty, min_stock_qty, supplier_name, is_active, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      [
        id, name, input.categoryId ?? null, input.sku?.trim() || null, input.barcode?.trim() || null,
        Math.round(input.costMinor), Math.round(input.priceMinor), openingQty,
        Number(input.minStockQty ?? 0), input.supplierName?.trim() || null,
        actor.userId, stamp(), stamp(),
      ],
    );
    if (openingQty > 0) {
      db.run(
        "INSERT INTO stock_movements (id, product_id, movement_type, delta, result_qty, unit_cost_minor, ref_table, ref_id, notes, created_by, created_at)\nVALUES (?, ?, 'stock_in', ?, ?, ?, NULL, NULL, NULL, ?, ?)",
        [crypto.randomUUID(), id, openingQty, openingQty, Math.round(input.costMinor), actor.userId, stamp()],
      );
    }
    recordAudit(db, actor, "PRODUCT_CREATED", "product", id, { name });
  });
  return getProduct(db, actor, id);
}

export async function updateProduct(
  db: Db,
  actor: ServiceActor,
  productId: string,
  patch: Partial<ProductInput> & { isActive?: boolean },
) {
  requirePermission(actor, "store.products");
  const row = db.first<Row>("SELECT * FROM products WHERE id = ?", [productId]);
  if (!row) throw errNotFound("errors.store.productNotFound");
  assertBarcodeFree(db, patch.barcode, productId);
  await db.transaction(async () => {
    db.run(
      "UPDATE products SET name = ?, category_id = ?, sku = ?, barcode = ?, cost_minor = ?, price_minor = ?, min_stock_qty = ?, supplier_name = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [
        patch.name?.trim() ?? str(row.name),
        patch.categoryId !== undefined ? patch.categoryId : row.category_id,
        patch.sku !== undefined ? patch.sku?.trim() || null : row.sku,
        patch.barcode !== undefined ? patch.barcode?.trim() || null : row.barcode,
        patch.costMinor !== undefined ? Math.round(patch.costMinor) : num(row.cost_minor),
        patch.priceMinor !== undefined ? Math.round(patch.priceMinor) : num(row.price_minor),
        patch.minStockQty !== undefined ? Number(patch.minStockQty) : num(row.min_stock_qty),
        patch.supplierName !== undefined ? patch.supplierName?.trim() || null : row.supplier_name,
        patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : num(row.is_active, 1),
        stamp(),
        productId,
      ],
    );
    recordAudit(db, actor, "PRODUCT_UPDATED", "product", productId, {});
  });
  return getProduct(db, actor, productId);
}

// ----------------------------- inventory ---------------------------------

export interface StockMovementRow {
  id: string;
  productName: string;
  movementType: string;
  delta: number;
  resultQty: number;
  unitCostMinor: number | null;
  notes: string | null;
  createdAt: string;
}

export function listStockMovements(
  db: Db,
  actor: ServiceActor,
  query: { productId?: string; limit?: number } = {},
): StockMovementRow[] {
  requirePermission(actor, "store.view");
  const limit = Math.min(300, Math.max(1, query.limit ?? 80));
  const conditions: string[] = [];
  const params: Num[] = [];
  if (query.productId) {
    conditions.push("sm.product_id = ?");
    params.push(query.productId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<Row>(
      `SELECT sm.*, p.name AS product_name FROM stock_movements sm JOIN products p ON p.id = sm.product_id ${where} ORDER BY sm.created_at DESC LIMIT ?`,
      [...params, limit],
    )
    .map((r) => ({
      id: str(r.id),
      productName: str(r.product_name),
      movementType: str(r.movement_type),
      delta: num(r.delta),
      resultQty: num(r.result_qty),
      unitCostMinor: r.unit_cost_minor == null ? null : num(r.unit_cost_minor),
      notes: r.notes == null ? null : str(r.notes),
      createdAt: str(r.created_at),
    }));
}

/** Negative-stock business rule; returns the new qty. Caller writes the movement row. */
function guardAndApply(db: Db, productId: string, delta: number): number {
  const row = db.first<Row>("SELECT stock_qty FROM products WHERE id = ?", [productId]);
  if (!row) throw errNotFound("errors.store.productNotFound");
  const current = num(row.stock_qty);
  const result = current + delta;
  const allowNegative = readSetting(db, SETTING_KEYS.allowNegativeStock) === "1";
  if (result < 0 && !allowNegative) {
    throw errValidation("errors.store.negativeStock", { available: current });
  }
  db.run("UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?", [result, stamp(), productId]);
  return result;
}

function insertMovement(
  db: Db,
  input: {
    productId: string;
    movementType: "stock_in" | "sale" | "manual_adjust" | "damage" | "count_correction" | "return" | "lost";
    delta: number;
    resultQty: number;
    unitCostMinor?: number | null;
    saleRefId?: string | null;
    notes?: string | null;
  },
): void {
  db.run(
    "INSERT INTO stock_movements (id, product_id, movement_type, delta, result_qty, unit_cost_minor, ref_table, ref_id, notes, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      crypto.randomUUID(),
      input.productId,
      input.movementType,
      input.delta,
      input.resultQty,
      input.unitCostMinor ?? null,
      (input.saleRefId || input.movementType === "return") ? ((input.movementType === "return") ? "store_returns" : "store_sales") : null,
      input.saleRefId ?? null,
      input.notes ?? null,
      null,
      stamp(),
    ],
  );
}

/** Manual inventory change (restock / damage / adjustment) - audited. */
export async function adjustStock(
  db: Db,
  actor: ServiceActor,
  input: {
    productId: string;
    movementType: "stock_in" | "manual_adjust" | "damage" | "count_correction" | "lost";
    delta: number;
    unitCostMinor?: number | null;
    notes?: string | null;
  },
) {
  requirePermission(actor, "store.inventory");
  const delta = Math.trunc(Number(input.delta));
  if (delta === 0) throw errValidation("errors.store.zeroDelta");
  let resultQty = 0;
  await db.transaction(async () => {
    resultQty = guardAndApply(db, input.productId, delta);
    insertMovement(db, {
      productId: input.productId,
      movementType: input.movementType,
      delta,
      resultQty,
      unitCostMinor: input.unitCostMinor ?? null,
      notes: input.notes ?? null,
    });
    recordAudit(db, actor, "STOCK_MOVED", "product", input.productId, { movementType: input.movementType, delta });
  });
  return getProduct(db, actor, input.productId);
}

// ------------------------------- sales/POS -------------------------------

export interface SaleItemInput {
  productId: string;
  qty: number;
}

export interface CreateSaleInput {
  items: SaleItemInput[];
  discountMinor?: number;
  methodCode: string;
  memberId?: string | null;
  isCredit?: boolean;
  notes?: string | null;
}

export interface StoreSaleItem {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  returnedQty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface StoreSale {
  id: string;
  saleNo: string;
  itemsTotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  costTotalMinor: number;
  grossProfitMinor: number;
  methodCode: string;
  memberId: string | null;
  memberName: string | null;
  isCredit: boolean;
  status: "completed" | "voided";
  soldAt: string;
  items: StoreSaleItem[];
}

const SALE_SELECT =
  "SELECT s.*, m.full_name AS member_name, m.member_code AS member_code FROM store_sales s LEFT JOIN members m ON m.id = s.member_id";

function mapSale(r: Row): StoreSale {
  const totalMinor = num(r.total_minor);
  return {
    id: str(r.id),
    saleNo: str(r.sale_no),
    itemsTotalMinor: num(r.items_total_minor),
    discountMinor: num(r.discount_minor),
    totalMinor,
    costTotalMinor: num(r.cost_total_minor),
    grossProfitMinor: totalMinor - num(r.cost_total_minor),
    methodCode: str(r.method_code),
    memberId: r.member_id == null ? null : str(r.member_id),
    memberName: r.member_name == null ? null : str(r.member_name),
    isCredit: num(r.is_credit) === 1,
    status: str(r.status) as "completed" | "voided",
    soldAt: str(r.sold_at),
    items: [],
  };
}

export function getSale(db: Db, actor: ServiceActor, saleId: string): StoreSale {
  requirePermission(actor, "store.view");
  const head = db.first<Row>(`${SALE_SELECT} WHERE s.id = ?`, [saleId]);
  if (!head) throw errNotFound("errors.store.saleNotFound");
  assertDepartmentAccess(actor, head.member_id == null ? null : memberDepartmentById(db, String(head.member_id)));
  const items = db
    .all<Row>("SELECT * FROM store_sale_items WHERE sale_id = ?", [saleId])
    .map<StoreSaleItem>((it) => ({
      id: str(it.id),
      productId: str(it.product_id),
      productName: str(it.product_name_snapshot),
      qty: num(it.qty),
      returnedQty: num(it.returned_qty),
      unitPriceMinor: num(it.unit_price_minor),
      lineTotalMinor: num(it.line_total_minor),
    }));
  return { ...mapSale(head), items };
}

export interface SaleListQuery {
  search?: string;
  fromKey?: string;
  toKey?: string;
  page?: number;
  pageSize?: number;
}

export function listSales(db: Db, actor: ServiceActor, query: SaleListQuery = {}) {
  requirePermission(actor, "store.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const conditions: string[] = [];
  const params: Num[] = [];
  const search = query.search?.trim();
  if (search) {
    conditions.push("(s.sale_no LIKE ? OR m.full_name LIKE ? OR m.member_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (query.fromKey) {
    conditions.push("s.sold_at >= ?");
    params.push(`${query.fromKey} 00:00:00`);
  }
  if (query.toKey) {
    conditions.push("s.sold_at <= ?");
    params.push(`${query.toKey} 23:59:59`);
  }
  if (departmentScopeCondition(actor, "m").sql) {
    conditions.push("(m.department IN (?, 'general') OR m.id IS NULL)");
    params.push((actor.department ?? "general") as string);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM store_sales s LEFT JOIN members m ON m.id = s.member_id ${where}`, params);
  const rows = db.all<Row>(
    `${SALE_SELECT} ${where} ORDER BY s.sold_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapSale), total };
}

export async function createSale(db: Db, actor: ServiceActor, input: CreateSaleInput): Promise<StoreSale> {
  requirePermission(actor, "store.sell");
  const items = input.items.filter((i) => Number(i.qty) > 0);
  if (items.length === 0) throw errValidation("errors.store.emptySale");
  const isCredit = Boolean(input.isCredit);
  if (isCredit) requirePermission(actor, "store.credit");
  if (isCredit && !input.memberId) throw errValidation("errors.store.creditNeedsMember");
  if (isCredit && input.memberId) {
    assertDepartmentAccess(actor, memberDepartmentById(db, String(input.memberId)));
  }

  const lines = items.map((i) => {
    const pRow = db.first<Row>(
      "SELECT id, name, price_minor, cost_minor, stock_qty, is_active FROM products WHERE id = ?",
      [i.productId],
    );
    if (!pRow) throw errNotFound("errors.store.productNotFound");
    if (num(pRow.is_active, 1) !== 1) throw errValidation("errors.store.productInactive");
    const qty = Math.floor(Number(i.qty));
    if (qty <= 0) throw errValidation("errors.store.qtyInvalid");
    return {
      productId: str(pRow.id),
      productName: str(pRow.name),
      qty,
      unitPriceMinor: num(pRow.price_minor),
      unitCostMinor: num(pRow.cost_minor),
      stockQty: num(pRow.stock_qty),
      lineTotalMinor: num(pRow.price_minor) * qty,
      lineCostMinor: num(pRow.cost_minor) * qty,
    };
  });

  const itemsTotalMinor = lines.reduce((s, l) => s + l.lineTotalMinor, 0);
  const costTotalMinor = lines.reduce((s, l) => s + l.lineCostMinor, 0);
  const discountMinor = Math.min(Math.max(0, Math.round(input.discountMinor ?? 0)), itemsTotalMinor);
  const totalMinor = itemsTotalMinor - discountMinor;

  const allowNegative = readSetting(db, SETTING_KEYS.allowNegativeStock) === "1";
  for (const l of lines) {
    if (!allowNegative && l.qty > l.stockQty) {
      throw errValidation("errors.store.insufficientStock", { product: l.productName, available: l.stockQty });
    }
  }

  const saleId = crypto.randomUUID();
  const ts = stamp();

  await db.transaction(async () => {
    db.run(
      "INSERT INTO counters (name, value) VALUES ('store_sale_no', 1000)\nON CONFLICT(name) DO UPDATE SET value = value + 1",
    );
    const seq = Number(db.scalar("SELECT value FROM counters WHERE name = 'store_sale_no'") ?? 1000);
    const saleNo = `POS-${String(seq).padStart(6, "0")}`;

    db.run(
      "INSERT INTO store_sales (id, sale_no, items_total_minor, discount_minor, total_minor, cost_total_minor, method_code, member_id, is_credit, status, seller_id, sold_at, notes, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)",
      [
        saleId, saleNo, itemsTotalMinor, discountMinor, totalMinor, costTotalMinor,
        input.methodCode, input.memberId ?? null, isCredit ? 1 : 0,
        actor.userId, ts, input.notes?.trim() || null, ts,
      ],
    );

    for (const l of lines) {
      db.run(
        "INSERT INTO store_sale_items (id, sale_id, product_id, product_name_snapshot, qty, unit_price_minor, unit_cost_minor, line_total_minor)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), saleId, l.productId, l.productName, l.qty, l.unitPriceMinor, l.unitCostMinor, l.lineTotalMinor],
      );
      const newQty = guardAndApply(db, l.productId, -l.qty);
      insertMovement(db, {
        productId: l.productId,
        movementType: "sale",
        delta: -l.qty,
        resultQty: newQty,
        unitCostMinor: l.unitCostMinor,
        saleRefId: saleId,
      });
    }

    if (!isCredit && totalMinor > 0) {
      insertLedgerEntry(db, {
        entryType: "payment",
        refTable: "store_sales",
        refId: saleId,
        memberId: input.memberId ?? null,
        methodCode: input.methodCode,
        direction: 1,
        amountMinor: totalMinor,
        occurredAt: ts,
        actor,
        box: "store",
      });
    }

    if (isCredit) {
      db.run(
        "INSERT INTO store_debts (id, member_id, sale_id, original_minor, paid_minor, status, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, 0, 'open', ?, ?, ?)",
        [crypto.randomUUID(), input.memberId!, saleId, totalMinor, actor.userId, ts, ts],
      );
    }

    recordAudit(db, actor, "SALE_CREATED", "store_sale", saleId, { saleNo, totalMinor, credit: isCredit });
  });

  return getSale(db, actor, saleId);
}

export async function voidStoreSale(db: Db, actor: ServiceActor, saleId: string, reason: string): Promise<void> {
  requirePermission(actor, "store.void_sale");
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw errValidation("errors.voidReasonRequired");
  const sale = db.first<Row>("SELECT * FROM store_sales WHERE id = ? AND status = 'completed'", [saleId]);
  if (!sale) throw errNotFound("errors.store.saleNotFound");
  if (num(sale.is_credit) === 1) {
    const debtPayments = db.count(
      "SELECT COUNT(*) FROM store_debt_payments WHERE debt_id IN (SELECT id FROM store_debts WHERE sale_id = ?)",
      [saleId],
    );
    if (debtPayments > 0) {
      throw errConflict("errors.store.debtHasPayments");
    }
  }
  const items = db.all<Row>("SELECT * FROM store_sale_items WHERE sale_id = ?", [saleId]);

  await db.transaction(async () => {
    for (const it of items) {
      const pid = String(it.product_id);
      const qty = Number(it.qty) - num(it.returned_qty); // restock only unreturned qty on void
      if (qty <= 0) continue;
      const newQty = guardAndApply(db, pid, qty);
      insertMovement(db, {
        productId: pid,
        movementType: "count_correction",
        delta: qty,
        resultQty: newQty,
        saleRefId: saleId,
        notes: `void ${str(sale.sale_no)}`,
      });
    }
    db.run(
      "UPDATE store_sales SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?",
      [trimmed, actor.userId, stamp(), saleId],
    );
    if (num(sale.is_credit) !== 1 && num(sale.total_minor) > 0) {
      const returnedMinor = num(db.scalar("SELECT COALESCE(SUM(total_minor),0) FROM store_returns WHERE sale_id = ?", [saleId]));
      insertLedgerEntry(db, {
        entryType: "reversal_payment",
        refTable: "store_sales",
        refId: saleId,
        memberId: sale.member_id == null ? null : String(sale.member_id),
        methodCode: str(sale.method_code),
        direction: -1,
        amountMinor: Math.max(0, num(sale.total_minor) - returnedMinor),
        occurredAt: stamp(),
        actor,
        box: "store",
      });
    } else {
      // credit voided before repayment: drop the open debt with the sale
      db.run("DELETE FROM store_debts WHERE sale_id = ? AND status = 'open'", [saleId]);
    }
    recordAudit(db, actor, "SALE_VOIDED", "store_sale", saleId, { reason: trimmed });
  });
}

export async function unvoidStoreSale(db: Db, actor: ServiceActor, saleId: string): Promise<void> {
  requirePermission(actor, "store.void_sale");
  const sale = db.first<Row>("SELECT * FROM store_sales WHERE id = ? AND status = 'voided'", [saleId]);
  if (!sale) throw errNotFound("errors.store.saleNotFound");
  const items = db.all<Row>("SELECT * FROM store_sale_items WHERE sale_id = ?", [saleId]);

  await db.transaction(async () => {
    for (const it of items) {
      const pid = str(it.product_id);
      const qty = Number(it.qty) - num(it.returned_qty); // re-deduct only unreturned qty on unvoid
      if (qty <= 0) continue;
      const newQty = guardAndApply(db, pid, -qty);
      insertMovement(db, {
        productId: pid,
        movementType: "count_correction",
        delta: -qty,
        resultQty: newQty,
        saleRefId: saleId,
        notes: `unvoid ${str(sale.sale_no)}`,
      });
    }
    db.run(
      "UPDATE store_sales SET status = 'completed', void_reason = NULL, voided_by = NULL, voided_at = NULL WHERE id = ?",
      [saleId],
    );
    if (num(sale.is_credit) !== 1 && num(sale.total_minor) > 0) {
      db.run(
        "DELETE FROM financial_ledger WHERE ref_table = 'store_sales' AND ref_id = ? AND entry_type = 'reversal_payment'",
        [saleId],
      );
    } else if (num(sale.is_credit) === 1) {
      const existing = db.first("SELECT 1 FROM store_debts WHERE sale_id = ?", [saleId]);
      if (!existing) {
        db.run(
          "INSERT INTO store_debts (id, member_id, sale_id, original_minor, paid_minor, status, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, 0, 'open', ?, ?, ?)",
          [crypto.randomUUID(), sale.member_id == null ? null : String(sale.member_id), saleId, num(sale.total_minor), actor.userId, stamp(), stamp()],
        );
      }
    }
    recordAudit(db, actor, "SALE_RESTORED", "store_sale", saleId, {});
  });
}

// ------------------------------ returns -----------------------------------

export interface StoreReturnItemRow {
  id: string;
  returnId: string;
  saleItemId: string;
  productId: string;
  productName: string;
  qty: number;
  unitPriceMinor: number;
  unitCostMinor: number;
  lineTotalMinor: number;
}

export interface StoreReturnRow {
  id: string;
  returnNo: string;
  saleId: string;
  saleNo: string;
  memberId: string | null;
  memberName: string | null;
  itemsTotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  reason: string | null;
  box: string;
  createdBy: string;
  createdAt: string;
  items: StoreReturnItemRow[];
}

const RETURN_SELECT =
  "SELECT r.*, s.sale_no AS sale_no, s.member_id AS sale_member_id, m.full_name AS member_name FROM store_returns r JOIN store_sales s ON s.id = r.sale_id LEFT JOIN members m ON m.id = s.member_id";

function mapReturnHead(r: Row): Omit<StoreReturnRow, "items"> {
  return {
    id: str(r.id),
    returnNo: str(r.return_no),
    saleId: str(r.sale_id),
    saleNo: str(r.sale_no),
    memberId: r.member_id == null ? null : str(r.member_id),
    memberName: r.member_name == null ? null : str(r.member_name),
    itemsTotalMinor: num(r.items_total_minor),
    discountMinor: num(r.discount_minor),
    totalMinor: num(r.total_minor),
    reason: r.reason == null ? null : str(r.reason),
    box: str(r.box),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  };
}

export function getStoreReturn(db: Db, actor: ServiceActor, returnId: string): StoreReturnRow {
  requirePermission(actor, "store.view");
  const head = db.first<Row>(`${RETURN_SELECT} WHERE r.id = ?`, [returnId]);
  if (!head) throw errNotFound("errors.store.returnNotFound");
  assertDepartmentAccess(actor, head.sale_member_id == null ? null : memberDepartmentById(db, String(head.sale_member_id)));
  const items = db
    .all<Row>("SELECT * FROM store_return_items WHERE return_id = ?", [returnId])
    .map<StoreReturnItemRow>((it) => ({
      id: str(it.id),
      returnId: str(it.return_id),
      saleItemId: str(it.sale_item_id),
      productId: str(it.product_id),
      productName: str(it.product_name_snapshot),
      qty: num(it.qty),
      unitPriceMinor: num(it.unit_price_minor),
      unitCostMinor: num(it.unit_cost_minor),
      lineTotalMinor: num(it.line_total_minor),
    }));
  return { ...mapReturnHead(head), items };
}

export interface ReturnListQuery {
  fromKey?: string;
  toKey?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listStoreReturns(db: Db, actor: ServiceActor, query: ReturnListQuery = {}) {
  requirePermission(actor, "store.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const conditions: string[] = [];
  const params: Num[] = [];
  const search = query.search?.trim();
  if (search) {
    conditions.push("(r.return_no LIKE ? OR s.sale_no LIKE ? OR m.full_name LIKE ? OR m.member_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (query.fromKey) {
    conditions.push("r.created_at >= ?");
    params.push(`${query.fromKey} 00:00:00`);
  }
  if (query.toKey) {
    conditions.push("r.created_at <= ?");
    params.push(`${query.toKey} 23:59:59`);
  }
  // Consistent with returnStoreSale: scope to the actor's department; walk-in
  // (member-id NULL) returns stay visible to every section.
  if (departmentScopeCondition(actor, "m").sql) {
    conditions.push("(m.department IN (?, 'general') OR m.id IS NULL)");
    params.push((actor.department ?? "general") as string);
  }
  const join = "JOIN store_sales s ON s.id = r.sale_id LEFT JOIN members m ON m.id = s.member_id";
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM store_returns r ${join} ${where}`, params);
  const rows = db.all<Row>(
    `${RETURN_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapReturnHead), total };
}

export interface ReturnLineInput {
  saleItemId: string;
  qty: number;
}

export interface CreateReturnInput {
  saleId: string;
  lines: ReturnLineInput[];
  discountMinor?: number;
  reason?: string | null;
}

/**
 * Line-item sales return. Restocks the returned quantity, marks `returned_qty`
 * on the original sale item (immutable over-return guard), and reverses the
 * already-recorded store revenue through a refund ledger entry keyed to the
 * return. Returns are only allowed on completed, non-credit sales so the cash /
 * ledger truth stays unambiguous.
 */
export async function returnStoreSale(db: Db, actor: ServiceActor, input: CreateReturnInput): Promise<StoreReturnRow> {
  requirePermission(actor, "store.return");
  const sale = db.first<Row>("SELECT * FROM store_sales WHERE id = ? AND status = 'completed'", [input.saleId]);
  if (!sale) throw errNotFound("errors.store.saleNotFound");
  if (num(sale.is_credit) === 1) throw errValidation("errors.store.returnCreditNotAllowed");
  assertDepartmentAccess(actor, sale.member_id == null ? actor.department! : memberDepartmentById(db, String(sale.member_id)));

  const lines = input.lines.filter((l) => Number(l.qty) > 0);
  if (lines.length === 0) throw errValidation("errors.store.emptyReturn");

  const ts = stamp();
  const linesPrepared = lines.map((l) => {
    const it = db.first<Row>("SELECT * FROM store_sale_items WHERE id = ? AND sale_id = ?", [l.saleItemId, input.saleId]);
    if (!it) throw errNotFound("errors.store.saleItemNotFound");
    const qty = Math.floor(Number(l.qty));
    if (qty <= 0) throw errValidation("errors.store.qtyInvalid");
    const alreadyReturned = num(it.returned_qty);
    const remaining = num(it.qty) - alreadyReturned;
    if (qty > remaining) {
      throw errValidation("errors.store.returnExceedsQty", {
        product: str(it.product_name_snapshot),
        remaining,
      });
    }
    return {
      saleItemId: str(it.id),
      productId: str(it.product_id),
      productName: str(it.product_name_snapshot),
      qty,
      unitPriceMinor: num(it.unit_price_minor),
      unitCostMinor: num(it.unit_cost_minor),
      lineTotalMinor: num(it.unit_price_minor) * qty,
      lineCostMinor: num(it.unit_cost_minor) * qty,
    };
  });

  const itemsTotalMinor = linesPrepared.reduce((s, l) => s + l.lineTotalMinor, 0);
  const discountMinor = Math.min(Math.max(0, Math.round(input.discountMinor ?? 0)), itemsTotalMinor);
  const totalMinor = itemsTotalMinor - discountMinor;
  if (totalMinor < 0) throw errValidation("errors.finance.invalidAmount");

  const returnId = crypto.randomUUID();

  await db.transaction(async () => {
    db.run(
      "INSERT INTO counters (name, value) VALUES ('store_return_no', 1000)\nON CONFLICT(name) DO UPDATE SET value = value + 1",
    );
    const seq = Number(db.scalar("SELECT value FROM counters WHERE name = 'store_return_no'") ?? 1000);
    const returnNo = `RTN-${String(seq).padStart(6, "0")}`;

    db.run(
      "INSERT INTO store_returns (id, sale_id, return_no, amount_minor, items_total_minor, discount_minor, total_minor, reason, created_by, created_at, box)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'store')",
      [
        returnId, input.saleId, returnNo, totalMinor, itemsTotalMinor, discountMinor, totalMinor,
        input.reason?.trim() || null, actor.userId, ts,
      ],
    );

    for (const l of linesPrepared) {
      db.run(
        "INSERT INTO store_return_items (id, return_id, sale_item_id, product_id, product_name_snapshot, qty, unit_price_minor, unit_cost_minor, line_total_minor)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), returnId, l.saleItemId, l.productId, l.productName, l.qty, l.unitPriceMinor, l.unitCostMinor, l.lineTotalMinor],
      );
      db.run("UPDATE store_sale_items SET returned_qty = returned_qty + ? WHERE id = ?", [l.qty, l.saleItemId]);
      const newQty = guardAndApply(db, l.productId, l.qty);
      insertMovement(db, {
        productId: l.productId,
        movementType: "return",
        delta: l.qty,
        resultQty: newQty,
        unitCostMinor: l.unitCostMinor,
        saleRefId: returnId,
      });
    }

    // Reverse the store-sale revenue that is being returned (box = store so the
    // treasury expected-cash computation accounts for the refund).
    if (totalMinor > 0) {
      insertLedgerEntry(db, {
        entryType: "refund",
        refTable: "store_returns",
        refId: returnId,
        memberId: sale.member_id == null ? null : String(sale.member_id),
        methodCode: str(sale.method_code),
        direction: -1,
        amountMinor: totalMinor,
        occurredAt: ts,
        actor,
        box: "store",
      });
    }

    recordAudit(db, actor, "STORE_RETURN_CREATED", "store_return", returnId, {
      returnNo,
      saleNo: str(sale.sale_no),
      totalMinor,
      lines: linesPrepared.length,
    });
  });

  return getStoreReturn(db, actor, returnId);
}

// --------------------- store debts (separate from gym debts) --------------

export interface StoreDebtRow {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  originalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  status: "open" | "settled";
  saleNo: string;
  createdAt: string;
}

const DEBT_SELECT =
  "SELECT d.*, m.full_name AS member_name, m.member_code AS member_code, s.sale_no AS sale_no FROM store_debts d JOIN members m ON m.id = d.member_id JOIN store_sales s ON s.id = d.sale_id";

function mapDebt(r: Row): StoreDebtRow {
  const original = num(r.original_minor);
  const paid = num(r.paid_minor);
  return {
    id: str(r.id),
    memberId: str(r.member_id),
    memberName: str(r.member_name),
    memberCode: str(r.member_code),
    originalMinor: original,
    paidMinor: paid,
    remainingMinor: original - paid,
    status: str(r.status) as "open" | "settled",
    saleNo: str(r.sale_no),
    createdAt: str(r.created_at),
  };
}

export function listStoreDebts(
  db: Db,
  actor: ServiceActor,
  query: { status?: "open" | "settled" | "all"; memberId?: string; page?: number; pageSize?: number } = {},
): { items: StoreDebtRow[]; total: number } {
  requirePermission(actor, "store.repayments");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
  const conditions: string[] = [];
  const params: Num[] = [];
  if (query.status && query.status !== "all") {
    conditions.push("d.status = ?");
    params.push(query.status);
  }
  if (query.memberId) {
    conditions.push("d.member_id = ?");
    params.push(query.memberId);
  }

  const scope = departmentScopeCondition(actor, "m");
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ""));
    params.push(...scope.params);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(
    "SELECT COUNT(*) FROM store_debts d JOIN members m ON m.id = d.member_id " + where,
    params,
  );
  const rows = db.all<Row>(`${DEBT_SELECT} ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (page - 1) * pageSize,
  ]);
  return { items: rows.map(mapDebt), total };
}

/** Open store-debt total for one member (kept separate from subscription debt). */
export function getMemberStoreDebtTotal(db: Db, actor: ServiceActor, memberId: string): number {
  requirePermission(actor, "store.view");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  return Number(
    db.scalar(
      "SELECT COALESCE(SUM(original_minor - paid_minor), 0) FROM store_debts WHERE member_id = ? AND status = 'open'",
      [memberId],
    ) ?? 0,
  );
}

export async function repayStoreDebt(
  db: Db,
  actor: ServiceActor,
  input: { debtId: string; amountMinor: number; methodCode: string },
): Promise<StoreDebtRow> {
  requirePermission(actor, "store.repayments");
  const debt = db.first<Row>("SELECT * FROM store_debts WHERE id = ?", [input.debtId]);
  if (!debt) throw errNotFound("errors.store.debtNotFound");
  if (str(debt.status) !== "open") throw errConflict("errors.store.debtSettled");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(debt.member_id)));
  const amount = Math.round(input.amountMinor);
  assertNonNegativeInteger(amount, "errors.finance.invalidAmount");
  const remainingBefore = num(debt.original_minor) - num(debt.paid_minor);
  if (amount <= 0) throw errValidation("errors.finance.zeroPayment");
  if (amount > remainingBefore) throw errValidation("errors.store.overpayDebt");

  const ts = stamp();
  const paidAfter = num(debt.paid_minor) + amount;
  const repaymentId = crypto.randomUUID();

  await db.transaction(async () => {
    db.run(
      "INSERT INTO store_debt_payments (id, debt_id, amount_minor, method_code, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?)",
      [repaymentId, input.debtId, amount, input.methodCode, actor.userId, ts],
    );
    db.run("UPDATE store_debts SET paid_minor = ?, status = ?, updated_at = ? WHERE id = ?",
      [paidAfter, paidAfter >= num(debt.original_minor) ? "settled" : "open", ts, input.debtId]);
    insertLedgerEntry(db, {
      entryType: "payment",
      refTable: "store_debts",
      refId: repaymentId,
      memberId: debt.member_id == null ? null : String(debt.member_id),
      methodCode: input.methodCode,
      direction: 1,
      amountMinor: amount,
      occurredAt: ts,
      actor,
      box: "store",
    });
    recordAudit(db, actor, "STORE_DEBT_REPAID", "store_debt", input.debtId, { amountMinor: amount });
  });

  const debts = listStoreDebts(db, actor, { memberId: String(debt.member_id), pageSize: 200 });
  return debts.items.find((d) => d.id === input.debtId)!;
}

// ------------------------------ stats ------------------------------------

export interface StoreStats {
  salesCount: number;
  revenueMinor: number;
  costMinor: number;
  grossProfitMinor: number;
  creditOpenCount: number;
  creditOpenMinor: number;
  lowStockCount: number;
}

export function getStoreStats(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string },
): StoreStats {
  requirePermission(actor, "store.profit");
  const from = `${range.fromKey} 00:00:00`;
  const to = `${range.toKey} 23:59:59`;
  const agg = db.first<Row>(
    "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_minor),0) AS rev, COALESCE(SUM(cost_total_minor),0) AS cost\nFROM store_sales WHERE status = 'completed' AND sold_at BETWEEN ? AND ?",
    [from, to],
  );
  const returns = db.first<Row>(
    "SELECT COALESCE(SUM(r.total_minor),0) AS rev, COALESCE(SUM(COALESCE((SELECT SUM(unit_cost_minor * qty) FROM store_return_items WHERE return_id = r.id), 0)),0) AS cost\nFROM store_returns r JOIN store_sales s ON s.id = r.sale_id WHERE s.status = 'completed' AND r.created_at BETWEEN ? AND ?",
    [from, to],
  );
  const credit = db.first<Row>(
    "SELECT COUNT(*) AS cnt, COALESCE(SUM(original_minor - paid_minor),0) AS rem\nFROM store_debts WHERE status = 'open'",
  );
  const lowStock = Number(
    db.scalar("SELECT COUNT(*) FROM products WHERE is_active = 1 AND stock_qty <= min_stock_qty") ?? 0,
  );
  const saleRev = num(agg?.rev);
  const saleCost = num(agg?.cost);
  const returnRev = num(returns?.rev);
  const returnCost = num(returns?.cost);
  const revenueMinor = saleRev - returnRev;
  const costMinor = saleCost - returnCost;
  return {
    salesCount: num(agg?.cnt),
    revenueMinor,
    costMinor,
    grossProfitMinor: revenueMinor - costMinor,
    creditOpenCount: num(credit?.cnt),
    creditOpenMinor: num(credit?.rem),
    lowStockCount: lowStock,
  };
}

// ------------------------------ reports ----------------------------------

export interface DailySalesRow {
  dateKey: string;
  salesCount: number;
  revenueMinor: number;
  costMinor: number;
  returnsCount: number;
  returnsMinor: number;
  netMinor: number;
  grossProfitMinor: number;
}

/** Daily sales aggregation (sales − returns) for a date range. */
export function getDailySalesReport(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string },
): DailySalesRow[] {
  requirePermission(actor, "store.profit");
  const from = `${range.fromKey} 00:00:00`;
  const to = `${range.toKey} 23:59:59`;
  const rows = db.all<Row>(
    `SELECT substr(s.sold_at, 1, 10) AS date_key,
            COUNT(*) AS sales_count,
            COALESCE(SUM(s.total_minor), 0) AS revenue_minor,
            COALESCE(SUM(s.cost_total_minor), 0) AS cost_minor
     FROM store_sales s
     WHERE s.status = 'completed' AND s.sold_at BETWEEN ? AND ?
     GROUP BY date_key
     ORDER BY date_key`,
    [from, to],
  );
  const returnRows = db.all<Row>(
    `SELECT substr(r.created_at, 1, 10) AS date_key,
            COUNT(DISTINCT r.id) AS returns_count,
            COALESCE(SUM(r.total_minor), 0) AS returns_minor,
            SUM((SELECT COALESCE(SUM(ri.unit_cost_minor * ri.qty), 0) FROM store_return_items ri WHERE ri.return_id = r.id)) AS returns_cost
     FROM store_returns r JOIN store_sales s ON s.id = r.sale_id
     WHERE s.status = 'completed' AND r.created_at BETWEEN ? AND ?
     GROUP BY date_key`,
    [from, to],
  );
  const returnByDay = new Map<string, { count: number; minor: number; cost: number }>();
  for (const r of returnRows) {
    returnByDay.set(str(r.date_key), {
      count: num(r.returns_count),
      minor: num(r.returns_minor),
      cost: num(r.returns_cost),
    });
  }
  const days = new Map<string, DailySalesRow>();
  for (const r of rows) {
    const dateKey = str(r.date_key);
    const ret = returnByDay.get(dateKey);
    days.set(dateKey, {
      dateKey,
      salesCount: num(r.sales_count),
      revenueMinor: num(r.revenue_minor),
      costMinor: num(r.cost_minor),
      returnsCount: ret?.count ?? 0,
      returnsMinor: ret?.minor ?? 0,
      netMinor: num(r.revenue_minor) - (ret?.minor ?? 0),
      grossProfitMinor: num(r.revenue_minor) - (ret?.minor ?? 0) - (num(r.cost_minor) - (ret?.cost ?? 0)),
    });
  }
  for (const [dateKey, ret] of returnByDay) {
    if (!days.has(dateKey)) {
      days.set(dateKey, {
        dateKey,
        salesCount: 0,
        revenueMinor: 0,
        costMinor: 0,
        returnsCount: ret.count,
        returnsMinor: ret.minor,
        netMinor: -ret.minor,
        grossProfitMinor: -ret.minor + ret.cost,
      });
    }
  }
  return [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export interface ProductSalesRow {
  productId: string;
  productName: string;
  categoryName: string | null;
  unitsSold: number;
  unitsReturned: number;
  netUnits: number;
  revenueMinor: number;
  costMinor: number;
  grossProfitMinor: number;
}

/** Per-product sales ranking (net of returns), best-sellers first. */
export function getProductSalesReport(
  db: Db,
  actor: ServiceActor,
  range: { fromKey: string; toKey: string },
): ProductSalesRow[] {
  requirePermission(actor, "store.profit");
  const from = `${range.fromKey} 00:00:00`;
  const to = `${range.toKey} 23:59:59`;
  const sold = db.all<Row>(
    `SELECT si.product_id,
            COALESCE((SELECT p.name FROM products p WHERE p.id = si.product_id), MAX(si.product_name_snapshot)) AS product_name,
            (SELECT pc.name_ar FROM products p2 LEFT JOIN product_categories pc ON pc.id = p2.category_id WHERE p2.id = si.product_id) AS category_name,
            COALESCE(SUM(si.qty), 0) AS units_sold,
            COALESCE(SUM(si.line_total_minor), 0) AS revenue_minor,
            COALESCE(SUM(si.unit_cost_minor * si.qty), 0) AS cost_minor
     FROM store_sale_items si
     JOIN store_sales s ON s.id = si.sale_id
     WHERE s.status = 'completed' AND s.sold_at BETWEEN ? AND ?
     GROUP BY si.product_id`,
    [from, to],
  );
  const returned = db.all<Row>(
    `SELECT si2.product_id AS product_id,
            COALESCE(SUM(ri.qty), 0) AS units_returned,
            COALESCE(SUM(ri.line_total_minor), 0) AS rev_returned,
            COALESCE(SUM(ri.unit_cost_minor * ri.qty), 0) AS cost_returned
     FROM store_return_items ri
     JOIN store_returns r2 ON r2.id = ri.return_id
     JOIN store_sale_items si2 ON si2.id = ri.sale_item_id
     WHERE r2.created_at BETWEEN ? AND ?
     GROUP BY si2.product_id`,
    [from, to],
  );
  const retByProduct = new Map<string, { units: number; rev: number; cost: number }>();
  for (const r of returned) {
    retByProduct.set(str(r.product_id), {
      units: num(r.units_returned),
      rev: num(r.rev_returned),
      cost: num(r.cost_returned),
    });
  }
  return sold
    .map((r) => {
      const ret = retByProduct.get(str(r.product_id));
      const revenue = num(r.revenue_minor) - (ret?.rev ?? 0);
      const cost = num(r.cost_minor) - (ret?.cost ?? 0);
      const unitsSold = num(r.units_sold);
      const unitsReturned = ret?.units ?? 0;
      return {
        productId: str(r.product_id),
        productName: str(r.product_name),
        categoryName: r.category_name == null ? null : str(r.category_name),
        unitsSold,
        unitsReturned,
        netUnits: unitsSold - unitsReturned,
        revenueMinor: revenue,
        costMinor: cost,
        grossProfitMinor: revenue - cost,
      };
    })
    .sort((a, b) => b.revenueMinor - a.revenueMinor);
}

export interface StockValueRow {
  totalCostMinor: number;
  potentialRetailMinor: number;
  potentialGrossProfitMinor: number;
  productCount: number;
}

export function getStockValue(db: Db, actor: ServiceActor): StockValueRow {
  requirePermission(actor, "store.profit");
  const row = db.first<Row>(
    "SELECT COUNT(*) AS cnt, COALESCE(SUM(stock_qty * cost_minor),0) AS cost, COALESCE(SUM(stock_qty * price_minor),0) AS retail\nFROM products WHERE is_active = 1",
  );
  const cost = num(row?.cost);
  const retail = num(row?.retail);
  return {
    totalCostMinor: cost,
    potentialRetailMinor: retail,
    potentialGrossProfitMinor: retail - cost,
    productCount: num(row?.cnt),
  };
}

/** Low-stock products (stock at or below minimum), optionally a count-only form. */
export function listLowStockProducts(
  db: Db,
  actor: ServiceActor,
  query: { limit?: number; includeInactive?: boolean } = {},
): Array<ProductPublic> {
  requirePermission(actor, "store.profit");
  const limit = Math.min(200, Math.max(1, query.limit ?? 100));
  const rows = db.all<Row>(
    `${PRODUCT_SELECT} WHERE p.is_active = 1 AND p.stock_qty <= p.min_stock_qty ORDER BY (p.stock_qty - p.min_stock_qty) ASC LIMIT ?`,
    [limit],
  );
  return rows.map(mapProduct);
}