import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  createEmployee,
  recordSalary,
  paySalary,
  purgeEmployee,
} from "@/core/services/employees.service";
import {
  createProduct,
  createSale,
  purgeProduct,
} from "@/core/services/store.service";
import {
  openCashSession,
  closeCashSession,
  deleteCashSession,
  listCashSessions,
} from "@/core/services/cash-session.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;

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
      fullName: "الاستقبال",
      roleId: "reception",
    }),
  );
});

async function employee(salaryBaseMinor = 30_000) {
  return createEmployee(db, owner, {
    fullName: `موظف ${Math.random().toString(36).slice(2, 6)}`,
    joinedDate: "2026-01-01",
    salaryType: "monthly",
    salaryBaseMinor,
  });
}

describe("hard-delete surfaces for previously non-deletable entities (ADR-008)", () => {
  it("purges an employee with an unpaid salary", async () => {
    const emp = await employee();
    await recordSalary(db, owner, {
      employeeId: emp.id,
      periodMonth: "2026-08",
      methodCode: "cash",
    });

    await purgeEmployee(db, owner, emp.id);

    expect(db.count("SELECT COUNT(*) AS c FROM employees WHERE id = ?", [emp.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM salaries WHERE employee_id = ?", [emp.id])).toBe(0);
  });

  it("purges a paid salary's treasury movement and keeps the expense document", async () => {
    const emp = await employee();
    const salary = await recordSalary(db, owner, {
      employeeId: emp.id,
      periodMonth: "2026-07",
      methodCode: "cash",
    });
    await paySalary(db, owner, salary.id);

    const expensesBefore = db.count("SELECT COUNT(*) AS c FROM expenses");
    const ledgerBefore = db.count(
      "SELECT COUNT(*) AS c FROM financial_ledger WHERE ref_table = 'salaries' AND ref_id = ?",
      [salary.id],
    );
    expect(ledgerBefore).toBe(1);

    await purgeEmployee(db, owner, emp.id);

    expect(db.count("SELECT COUNT(*) AS c FROM salaries WHERE employee_id = ?", [emp.id])).toBe(0);
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM financial_ledger WHERE ref_table = 'salaries' AND ref_id = ?",
        [salary.id],
      ),
    ).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM expenses")).toBe(expensesBefore);
  });

  it("denies reception from purging employees", async () => {
    const emp = await employee();
    await expect(purgeEmployee(db, reception, emp.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("purges an unsold product; refuses to purge a product that has sales history", async () => {
    const fresh = await createProduct(db, owner, {
      name: "غير مباع",
      costMinor: 1000,
      priceMinor: 2000,
      stockQty: 5,
      minStockQty: 1,
    });
    await purgeProduct(db, owner, fresh.id);
    expect(db.count("SELECT COUNT(*) AS c FROM products WHERE id = ?", [fresh.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?", [fresh.id])).toBe(0);

    const sold = await createProduct(db, owner, {
      name: "مباع",
      costMinor: 1000,
      priceMinor: 2000,
      stockQty: 10,
      minStockQty: 1,
    });
    const sale = await createSale(db, owner, {
      items: [{ productId: sold.id, qty: 2 }],
      methodCode: "cash",
    });

    // The product is referenced by a sale line → destructive delete is refused
    // (archive via updateProduct is the intended retirement path). No data or
    // audit record is produced by the refused attempt.
    await expect(purgeProduct(db, owner, sold.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db.count("SELECT COUNT(*) AS c FROM products WHERE id = ?", [sold.id])).toBe(1);
    expect(
      db.count("SELECT COUNT(*) AS c FROM store_sale_items WHERE sale_id = ?", [sale.id]),
    ).toBe(1);
    expect(
      db.count("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?", [sold.id]),
    ).toBe(2);
    // sale document itself survives with its header totals
    expect(db.count("SELECT COUNT(*) AS c FROM store_sales WHERE id = ?", [sale.id])).toBe(1);
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'PRODUCT_PURGED' AND entity_id = ?",
        [sold.id],
      ),
    ).toBe(0);
  });

  it("deletes an OPEN cash session (abort) but never a CLOSED one", async () => {
    const session = await openCashSession(db, owner, { openingBalanceMinor: 10_000 });
    await deleteCashSession(db, owner, session.id);
    expect(listCashSessions(db, owner, {}).total).toBe(0);

    const reopened = await openCashSession(db, owner, { openingBalanceMinor: 5_000 });
    await closeCashSession(db, owner, reopened.id, 5_000, null);
    expect(() => deleteCashSession(db, owner, reopened.id)).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(() => deleteCashSession(db, reception, reopened.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});
