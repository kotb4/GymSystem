import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, SqlValue } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { randomUUID } from "node:crypto";

export interface SupplierInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  companyName?: string | null;
  notes?: string | null;
}

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  company_name: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  total_purchases_minor?: number;
  total_paid_minor?: number;
  total_remaining_minor?: number;
  invoices_count?: number;
}

export interface PurchaseInvoiceItemInput {
  productId: string;
  quantity: number;
  unitCostMinor: number;
}

export interface PurchaseInvoiceInput {
  supplierId: string;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  items: PurchaseInvoiceItemInput[];
  paidAmountMinor: number;
  methodCode?: string | null;
  notes?: string | null;
}

export interface PurchaseInvoiceRow {
  id: string;
  invoice_no: string;
  supplier_id: string;
  supplier_name?: string;
  invoice_date: string;
  total_amount_minor: number;
  paid_amount_minor: number;
  remaining_amount_minor: number;
  method_code: string | null;
  status: "paid" | "partial" | "unpaid";
  notes: string | null;
  created_by: string;
  creator_name?: string;
  created_at: string;
  items?: PurchaseInvoiceItemRow[];
}

export interface PurchaseInvoiceItemRow {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_cost_minor: number;
  total_cost_minor: number;
}

// ---------------- Suppliers ----------------

export function createSupplier(
  db: Db,
  actor: ServiceActor,
  input: SupplierInput,
): SupplierRow {
  requirePermission(actor, "suppliers.manage");

  if (!input.name || input.name.trim().length < 2) {
    throw errValidation("errors.supplier.nameRequired");
  }

  const id = randomUUID();
  const stamp = nowStamp();

  db.run(
    `INSERT INTO suppliers (
      id, name, phone, address, company_name, notes, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      input.name.trim(),
      input.phone?.trim() || null,
      input.address?.trim() || null,
      input.companyName?.trim() || null,
      input.notes?.trim() || null,
      stamp,
      stamp,
    ],
  );

  recordAudit(db, actor, "SUPPLIER_CREATED", "supplier", id, {
    name: input.name,
  });

  return getSupplierById(db, actor, id)!;
}

export function updateSupplier(
  db: Db,
  actor: ServiceActor,
  id: string,
  input: Partial<SupplierInput> & { isActive?: boolean },
): SupplierRow {
  requirePermission(actor, "suppliers.manage");

  const existing = getSupplierById(db, actor, id);
  if (!existing) throw errNotFound("errors.supplier.notFound");

  const stamp = nowStamp();
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (name.length < 2) throw errValidation("errors.supplier.nameRequired");

  const phone = input.phone !== undefined ? (input.phone?.trim() || null) : existing.phone;
  const address = input.address !== undefined ? (input.address?.trim() || null) : existing.address;
  const companyName = input.companyName !== undefined ? (input.companyName?.trim() || null) : existing.company_name;
  const notes = input.notes !== undefined ? (input.notes?.trim() || null) : existing.notes;
  const isActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active;

  db.run(
    `UPDATE suppliers 
     SET name = ?, phone = ?, address = ?, company_name = ?, notes = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
    [name, phone, address, companyName, notes, isActive, stamp, id],
  );

  recordAudit(db, actor, "SUPPLIER_UPDATED", "supplier", id, {
    name,
  });

  return getSupplierById(db, actor, id)!;
}

export function getSupplierById(
  db: Db,
  actor: ServiceActor,
  id: string,
): SupplierRow | null {
  requirePermission(actor, "suppliers.view");
  return db.first<SupplierRow>(
    `SELECT s.*,
            COALESCE(SUM(i.total_amount_minor), 0) AS total_purchases_minor,
            COALESCE(SUM(i.paid_amount_minor), 0) AS total_paid_minor,
            COALESCE(SUM(i.remaining_amount_minor), 0) AS total_remaining_minor,
            COUNT(i.id) AS invoices_count
     FROM suppliers s
     LEFT JOIN purchase_invoices i ON s.id = i.supplier_id
     WHERE s.id = ?
     GROUP BY s.id`,
    [id],
  );
}

export function listSuppliers(
  db: Db,
  actor: ServiceActor,
  filter?: { search?: string; activeOnly?: boolean },
): SupplierRow[] {
  requirePermission(actor, "suppliers.view");

  const conditions: string[] = ["1=1"];
  const params: SqlValue[] = [];

  if (filter?.activeOnly) {
    conditions.push("s.is_active = 1");
  }
  if (filter?.search && filter.search.trim()) {
    conditions.push("(s.name LIKE ? OR s.phone LIKE ? OR s.company_name LIKE ?)");
    const q = `%${filter.search.trim()}%`;
    params.push(q, q, q);
  }

  return db.all<SupplierRow>(
    `SELECT s.*,
            COALESCE(SUM(i.total_amount_minor), 0) AS total_purchases_minor,
            COALESCE(SUM(i.paid_amount_minor), 0) AS total_paid_minor,
            COALESCE(SUM(i.remaining_amount_minor), 0) AS total_remaining_minor,
            COUNT(i.id) AS invoices_count
     FROM suppliers s
     LEFT JOIN purchase_invoices i ON s.id = i.supplier_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    params,
  );
}

// ---------------- Purchase Invoices ----------------

export function createPurchaseInvoice(
  db: Db,
  actor: ServiceActor,
  input: PurchaseInvoiceInput,
): PurchaseInvoiceRow {
  requirePermission(actor, "purchases.manage");

  const supplier = db.first<{ id: string; name: string }>(
    "SELECT id, name FROM suppliers WHERE id = ?",
    [input.supplierId],
  );
  if (!supplier) throw errNotFound("errors.supplier.notFound");

  if (!input.items || input.items.length === 0) {
    throw errValidation("errors.purchases.emptyItems");
  }

  let totalAmountMinor = 0;
  for (const item of input.items) {
    if (item.quantity <= 0) throw errValidation("errors.purchases.quantityInvalid");
    if (item.unitCostMinor < 0) throw errValidation("errors.purchases.costInvalid");
    totalAmountMinor += Math.round(item.quantity * item.unitCostMinor);
  }

  if (input.paidAmountMinor < 0 || input.paidAmountMinor > totalAmountMinor) {
    throw errValidation("errors.purchases.paidInvalid");
  }

  const remainingAmountMinor = totalAmountMinor - input.paidAmountMinor;
  const status: "paid" | "partial" | "unpaid" =
    remainingAmountMinor === 0 ? "paid" : input.paidAmountMinor > 0 ? "partial" : "unpaid";

  const invoiceId = randomUUID();
  const invoiceNo =
    input.invoiceNo?.trim() ||
    `PINV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
  const invoiceDate = input.invoiceDate || todayKey();
  const stamp = nowStamp();

  return db.transaction(() => {
    db.run(
      `INSERT INTO purchase_invoices (
        id, invoice_no, supplier_id, invoice_date, total_amount_minor,
        paid_amount_minor, remaining_amount_minor, method_code, status,
        notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        invoiceNo,
        input.supplierId,
        invoiceDate,
        totalAmountMinor,
        input.paidAmountMinor,
        remainingAmountMinor,
        input.methodCode || null,
        status,
        input.notes?.trim() || null,
        actor.userId,
        stamp,
      ],
    );

    for (const item of input.items) {
      const lineCostMinor = Math.round(item.quantity * item.unitCostMinor);
      db.run(
        `INSERT INTO purchase_invoice_items (
          id, invoice_id, product_id, quantity, unit_cost_minor, total_cost_minor
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          invoiceId,
          item.productId,
          item.quantity,
          item.unitCostMinor,
          lineCostMinor,
        ],
      );

      // Increase stock_qty in products table
      const product = db.first<{ id: string; stock_qty: number; name: string }>(
        "SELECT id, stock_qty, name FROM products WHERE id = ?",
        [item.productId],
      );

      if (product) {
        const newStock = product.stock_qty + item.quantity;
        db.run("UPDATE products SET stock_qty = ?, cost_minor = ?, updated_at = ? WHERE id = ?", [
          newStock,
          item.unitCostMinor,
          stamp,
          item.productId,
        ]);

        db.run(
          `INSERT INTO stock_movements (
            id, product_id, movement_type, delta, result_qty, unit_cost_minor,
            ref_table, ref_id, notes, created_by, created_at
          ) VALUES (?, ?, 'stock_in', ?, ?, ?, 'purchase_invoices', ?, ?, ?, ?)`,
          [
            randomUUID(),
            item.productId,
            item.quantity,
            newStock,
            item.unitCostMinor,
            invoiceId,
            `شراء من المورد: ${supplier.name} (فاتورة ${invoiceNo})`,
            actor.userId,
            stamp,
          ],
        );
      }
    }

    // Expense ledger entry if paid
    if (input.paidAmountMinor > 0) {
      db.run(
        `INSERT INTO financial_ledger (
          entry_type, ref_table, ref_id, method_code, direction,
          amount_minor, occurred_at, created_by, created_at, box
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "expense",
          "purchase_invoices",
          invoiceId,
          input.methodCode || "cash",
          -1,
          input.paidAmountMinor,
          stamp,
          actor.userId,
          stamp,
          "gym",
        ],
      );
    }

    recordAudit(
      db,
      actor,
      "PURCHASE_INVOICE_CREATED",
      "purchase_invoice",
      invoiceId,
      {
        invoiceNo,
        supplierName: supplier.name,
        totalMinor: totalAmountMinor,
        paidMinor: input.paidAmountMinor,
      },
    );

    return getPurchaseInvoiceById(db, actor, invoiceId)!;
  });
}

export function getPurchaseInvoiceById(
  db: Db,
  actor: ServiceActor,
  id: string,
): PurchaseInvoiceRow | null {
  requirePermission(actor, "purchases.view");

  const inv = db.first<PurchaseInvoiceRow>(
    `SELECT i.*, 
            s.name AS supplier_name,
            u.full_name AS creator_name
     FROM purchase_invoices i
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     LEFT JOIN users u ON i.created_by = u.id
     WHERE i.id = ?`,
    [id],
  );
  if (!inv) return null;

  inv.items = db.all<PurchaseInvoiceItemRow>(
    `SELECT it.*, p.name AS product_name
     FROM purchase_invoice_items it
     LEFT JOIN products p ON it.product_id = p.id
     WHERE it.invoice_id = ?`,
    [id],
  );

  return inv;
}

export function listPurchaseInvoices(
  db: Db,
  actor: ServiceActor,
  filter?: {
    supplierId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
): { items: PurchaseInvoiceRow[]; total: number } {
  requirePermission(actor, "purchases.view");

  const conditions: string[] = ["1=1"];
  const params: SqlValue[] = [];

  if (filter?.supplierId && filter.supplierId !== "all") {
    conditions.push("i.supplier_id = ?");
    params.push(filter.supplierId);
  }
  if (filter?.startDate) {
    conditions.push("i.invoice_date >= ?");
    params.push(filter.startDate);
  }
  if (filter?.endDate) {
    conditions.push("i.invoice_date <= ?");
    params.push(filter.endDate);
  }
  if (filter?.status && filter.status !== "all") {
    conditions.push("i.status = ?");
    params.push(filter.status);
  }
  if (filter?.search && filter.search.trim()) {
    conditions.push("(i.invoice_no LIKE ? OR s.name LIKE ?)");
    const q = `%${filter.search.trim()}%`;
    params.push(q, q);
  }

  const whereClause = conditions.join(" AND ");
  const total = db.count(
    `SELECT COUNT(*) FROM purchase_invoices i
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     WHERE ${whereClause}`,
    params,
  );

  const limit = Math.min(Math.max(filter?.limit || 50, 1), 200);
  const offset = Math.max(filter?.offset || 0, 0);

  const items = db.all<PurchaseInvoiceRow>(
    `SELECT i.*, 
            s.name AS supplier_name,
            u.full_name AS creator_name
     FROM purchase_invoices i
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     LEFT JOIN users u ON i.created_by = u.id
     WHERE ${whereClause}
     ORDER BY i.invoice_date DESC, i.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return { items, total };
}

export function payPurchaseInvoiceDebt(
  db: Db,
  actor: ServiceActor,
  input: {
    invoiceId: string;
    amountMinor: number;
    methodCode: string;
    notes?: string;
  },
): { success: boolean; paidMinor: number; remainingMinor: number } {
  requirePermission(actor, "purchases.manage");

  if (input.amountMinor <= 0) {
    throw errValidation("errors.debt.amountInvalid");
  }

  const inv = db.first<{
    id: string;
    invoice_no: string;
    paid_amount_minor: number;
    remaining_amount_minor: number;
  }>("SELECT id, invoice_no, paid_amount_minor, remaining_amount_minor FROM purchase_invoices WHERE id = ?", [
    input.invoiceId,
  ]);
  if (!inv) throw errNotFound("errors.purchases.invoiceNotFound");

  if (input.amountMinor > inv.remaining_amount_minor) {
    throw errValidation("errors.overpayDebt");
  }

  const stamp = nowStamp();

  return db.transaction(() => {
    const newRemaining = inv.remaining_amount_minor - input.amountMinor;
    const newPaid = inv.paid_amount_minor + input.amountMinor;
    const newStatus = newRemaining === 0 ? "paid" : "partial";

    db.run(
      `UPDATE purchase_invoices 
       SET paid_amount_minor = ?, remaining_amount_minor = ?, status = ?
       WHERE id = ?`,
      [newPaid, newRemaining, newStatus, inv.id],
    );

    // Expense ledger entry
    db.run(
      `INSERT INTO financial_ledger (
        entry_type, ref_table, ref_id, method_code, direction,
        amount_minor, occurred_at, created_by, created_at, box
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "expense",
        "purchase_invoices",
        `${inv.id}-pay-${Date.now()}`,
        input.methodCode || "cash",
        -1,
        input.amountMinor,
        stamp,
        actor.userId,
        stamp,
          "gym",
      ],
    );

    recordAudit(
      db,
      actor,
      "PURCHASE_INVOICE_PAID",
      "purchase_invoice",
      inv.id,
      {
        invoiceNo: inv.invoice_no,
        paidMinor: input.amountMinor,
        remainingMinor: newRemaining,
      },
    );

    return {
      success: true,
      paidMinor: input.amountMinor,
      remainingMinor: newRemaining,
    };
  });
}
