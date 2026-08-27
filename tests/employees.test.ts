import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  createEmployee,
  listEmployees,
  updateEmployee,
  recordSalary,
  listSalaries,
  paySalary,
} from "@/core/services/employees.service";
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

async function seedEmployee() {
  return createEmployee(db, owner, {
    fullName: "محمد المدرب",
    roleTitle: "مدرب عام",
    department: "general",
    salaryType: "monthly",
    salaryBaseMinor: 5000000,
  });
}

describe("employees CRUD", () => {
  it("creates, lists and updates an employee", async () => {
    const emp = await seedEmployee();
    expect(emp.fullName).toBe("محمد المدرب");
    expect(emp.salaryBaseMinor).toBe(5000000);

    const list = listEmployees(db, owner);
    expect(list.length).toBe(1);

    const updated = await updateEmployee(db, owner, emp.id, { roleTitle: "مدرب رياضي" });
    expect(updated.roleTitle).toBe("مدرب رياضي");
  });

  it("denies reception from creating employees", async () => {
    await expect(
      createEmployee(db, reception, { fullName: "ممنوع", salaryBaseMinor: 1000000 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("salaries", () => {
  it("records a salary and lists it", async () => {
    const emp = await seedEmployee();
    const salary = await recordSalary(db, owner, {
      employeeId: emp.id,
      periodMonth: "2026-08",
      methodCode: "cash",
    });
    expect(salary.status).toBe("pending");
    expect(salary.netMinor).toBe(5000000);

    const list = listSalaries(db, owner, { employeeId: emp.id });
    expect(list.length).toBe(1);
  });

  it("rejects duplicate employee+month", async () => {
    const emp = await seedEmployee();
    await recordSalary(db, owner, { employeeId: emp.id, periodMonth: "2026-08" });
    await expect(
      recordSalary(db, owner, { employeeId: emp.id, periodMonth: "2026-08" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("pays a salary: marks paid, creates expense and ledger entry", async () => {
    const emp = await seedEmployee();
    const salary = await recordSalary(db, owner, {
      employeeId: emp.id,
      periodMonth: "2026-08",
      methodCode: "cash",
    });

    const paid = await paySalary(db, owner, salary.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBeTruthy();

    const expense = db.first<{ category_id: string; amount_minor: number }>(
      "SELECT category_id, amount_minor FROM expenses WHERE description LIKE ?",
      [`%${emp.fullName}%`],
    );
    expect(expense).toBeDefined();
    expect(expense!.category_id).toBe("cat-salaries");
    expect(Number(expense!.amount_minor)).toBe(5000000);

    const ledger = db.first<{ entry_type: string; ref_table: string; direction: number }>(
      "SELECT entry_type, ref_table, direction FROM financial_ledger WHERE ref_id = ?",
      [salary.id],
    );
    expect(ledger).toBeDefined();
    expect(ledger!.entry_type).toBe("expense");
    expect(ledger!.ref_table).toBe("salaries");
    expect(ledger!.direction).toBe(-1);
  });

  it("denies reception from managing salaries", async () => {
    const emp = await seedEmployee();
    await expect(
      recordSalary(db, reception, { employeeId: emp.id, periodMonth: "2026-08" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
