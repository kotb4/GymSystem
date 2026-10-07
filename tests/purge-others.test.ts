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
import {
  createClass,
  createClassSession,
  createClassRecurrence,
  deleteClass,
  deleteClassSession,
  deleteClassRecurrence,
} from "@/core/services/classes.service";
import {
  createTrainer,
  deleteTrainer,
} from "@/core/services/trainers.service";
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

  it("purges an unsold product; purges a sold product by unlinking sales history", async () => {
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

    // The product is referenced by a sale line → purgeProduct unlinks historical sales
    await purgeProduct(db, owner, sold.id);
    expect(db.count("SELECT COUNT(*) AS c FROM products WHERE id = ?", [sold.id])).toBe(0);
    expect(
      db.count("SELECT COUNT(*) AS c FROM store_sale_items WHERE sale_id = ? AND product_id IS NULL", [sale.id]),
    ).toBe(1);
    expect(
      db.count("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?", [sold.id]),
    ).toBe(0);
    // sale document itself survives with its header totals and item snapshots
    expect(db.count("SELECT COUNT(*) AS c FROM store_sales WHERE id = ?", [sale.id])).toBe(1);
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'PRODUCT_PURGED' AND entity_id = ?",
        [sold.id],
      ),
    ).toBe(1);
  });

  it("deletes an OPEN cash session and allows authorized users to delete a CLOSED session", async () => {
    const session = await openCashSession(db, owner, { openingBalanceMinor: 10_000 });
    await deleteCashSession(db, owner, session.id);
    expect(listCashSessions(db, owner, {}).total).toBe(0);

    const reopened = await openCashSession(db, owner, { openingBalanceMinor: 5_000 });
    await closeCashSession(db, owner, reopened.id, 5_000, null);

    // reception lacks cash.purge permission
    expect(() => deleteCashSession(db, reception, reopened.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );

    // owner (with cash.purge) can delete the closed session
    await deleteCashSession(db, owner, reopened.id);
    expect(listCashSessions(db, owner, {}).total).toBe(0);
  });

  it("deletes a class with recurrences and sessions", async () => {
    const cls = await createClass(db, owner, {
      name: "حصة كاراتيه",
      discipline: "karate",
      capacity: 20,
    });
    const recResult = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [1, 3],
      startDate: "2026-10-01",
      startTime: "18:00",
      weeks: 1,
    });
    expect(recResult.created).toBeGreaterThan(0);

    // reception lacks classes.purge permission
    await expect(deleteClass(db, reception, cls.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // owner purges the class
    await deleteClass(db, owner, cls.id);
    expect(db.count("SELECT COUNT(*) AS c FROM classes WHERE id = ?", [cls.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM class_recurrences WHERE class_id = ?", [cls.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM class_sessions WHERE class_id = ?", [cls.id])).toBe(0);
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'CLASS_PURGED' AND entity_id = ?",
        [cls.id],
      ),
    ).toBe(1);
  });

  it("deletes a class session and class recurrence individually", async () => {
    const cls = await createClass(db, owner, {
      name: "ملاكمة",
      discipline: "boxing",
      capacity: 15,
    });
    const session = await createClassSession(db, owner, cls.id, {
      sessionDate: "2026-10-15",
      startTime: "17:00",
    });
    const recResult = await createClassRecurrence(db, owner, {
      classId: cls.id,
      daysOfWeek: [2],
      startDate: "2026-10-01",
      startTime: "17:00",
      weeks: 1,
    });

    // Delete session
    await expect(deleteClassSession(db, reception, session.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await deleteClassSession(db, owner, session.id);
    expect(db.count("SELECT COUNT(*) AS c FROM class_sessions WHERE id = ?", [session.id])).toBe(0);

    // Delete recurrence
    await expect(deleteClassRecurrence(db, reception, recResult.recurrence.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await deleteClassRecurrence(db, owner, recResult.recurrence.id);
    expect(db.count("SELECT COUNT(*) AS c FROM class_recurrences WHERE id = ?", [recResult.recurrence.id])).toBe(0);
  });

  it("deletes a trainer and unlinks associated entities", async () => {
    const trainer = await createTrainer(db, owner, {
      fullName: "كابتن أحمد",
      specialization: "mma",
      phone: "01011112222",
    });

    // reception lacks trainers.purge permission
    await expect(deleteTrainer(db, reception, trainer.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // owner deletes trainer
    await deleteTrainer(db, owner, trainer.id);
    expect(db.count("SELECT COUNT(*) AS c FROM trainers WHERE id = ?", [trainer.id])).toBe(0);
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'TRAINER_PURGED' AND entity_id = ?",
        [trainer.id],
      ),
    ).toBe(1);
  });
});
