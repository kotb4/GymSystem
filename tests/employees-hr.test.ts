import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createEmployee } from "@/core/services/employees.service";
import {
  clockIn,
  clockOut,
  listAttendance,
  requestLeave,
  decideLeave,
  cancelLeave,
  updateLeave,
  getLeaveBalance,
  addDeduction,
  addIncentive,
  listDeductions,
  listIncentives,
  updateDeduction,
  updateIncentive,
  deleteDeduction,
  deleteIncentive,
  monthlySalarySummary,
  employeeDailyActivity,
  setEmployeeBarcode,
  clockInByBarcode,
  clockOutByBarcode,
  setLeaveEntitlements,
  ensureSalariesForMonth,
  employeeMonthlyHours,
} from "@/core/services/employees-hr.service";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let manager: ReturnType<typeof buildActor>;
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
  manager = buildActor(
    await createUser(db, owner, {
      username: "manager",
      password: "Mngr@2026",
      fullName: "مدير",
      roleId: "manager",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
});

async function seedEmployee(baseMinor = 5000000) {
  return createEmployee(db, owner, {
    fullName: "محمد الموظف",
    roleTitle: "موظف",
    department: "general",
    salaryType: "monthly",
    salaryBaseMinor: baseMinor,
  });
}

async function linkEmployeeToUser(employeeId: string, userId: string) {
  db.run("UPDATE employees SET user_id = ? WHERE id = ?", [userId, employeeId]);
}

describe("attendance clock in/out", () => {
  it("clocks in then out, computing worked minutes", async () => {
    const emp = await seedEmployee();
    const inRec = await clockIn(db, owner, {
      employeeId: emp.id,
      dateKey: "2026-08-01",
      at: "2026-08-01 09:00:00",
    });
    expect(inRec.clockOutAt).toBeNull();
    expect(inRec.isLate).toBe(false);

    const outRec = await clockOut(db, owner, {
      employeeId: emp.id,
      dateKey: "2026-08-01",
      at: "2026-08-01 17:00:00",
    });
    expect(outRec.clockOutAt).toBe("2026-08-01 17:00:00");
    expect(outRec.workedMinutes).toBe(480);

    const list = listAttendance(db, owner, { month: "2026-08" });
    expect(list).toHaveLength(1);
    expect(list[0].workedMinutes).toBe(480);
  });

  it("rejects a duplicate clock-in for the same day", async () => {
    const emp = await seedEmployee();
    await clockIn(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 09:00:00" });
    await expect(
      clockIn(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 09:30:00" }),
    ).rejects.toMatchObject({ messageKey: "errors.hrAlreadyClockedIn" });
  });

  it("rejects clock-out before any clock-in", async () => {
    await expect(
      clockOut(db, owner, { employeeId: (await seedEmployee()).id, dateKey: "2026-08-01", at: "2026-08-01 17:00:00" }),
    ).rejects.toMatchObject({ messageKey: "errors.hrNotClockedIn" });
  });

  it("lets reception clock their own attendance but not another employee's", async () => {
    const emp = await seedEmployee();
    await linkEmployeeToUser(emp.id, reception.userId);

    const inRec = await clockIn(db, reception, {});
    expect(inRec.employeeId).toBe(emp.id);

    const other = await seedEmployee(3000000);
    await expect(
      clockIn(db, reception, { employeeId: other.id, dateKey: "2026-08-01", at: "2026-08-01 09:00:00" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies reception from listing other employees' attendance (scopes to self)", async () => {
    const emp = await seedEmployee();
    await linkEmployeeToUser(emp.id, reception.userId);
    await clockIn(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 09:00:00" });

    const other = await seedEmployee(3000000);
    await clockIn(db, owner, { employeeId: other.id, dateKey: "2026-08-01", at: "2026-08-01 10:00:00" });

    const list = listAttendance(db, reception, { month: "2026-08" });
    expect(list).toHaveLength(1);
    expect(list[0].employeeId).toBe(emp.id);
  });
});

describe("leaves", () => {
  it("requests annual leave and manager approves, consuming balance", async () => {
    const emp = await seedEmployee();
    const leave = await requestLeave(db, owner, {
      employeeId: emp.id,
      leaveType: "annual",
      startDate: "2026-08-10",
      endDate: "2026-08-14",
      reason: "إجازة سنوية",
    });
    expect(leave.status).toBe("pending");
    expect(leave.days).toBe(5);

    const decided = await decideLeave(db, manager, { leaveId: leave.id, approve: true });
    expect(decided.status).toBe("approved");

    const bal = getLeaveBalance(db, owner, { employeeId: emp.id, year: "2026" }).find((b) => b.type === "annual")!;
    expect(bal.entitlement).toBe(21);
    expect(bal.used).toBe(5);
    expect(bal.remaining).toBe(16);
  });

  it("rejects annual leave exceeding remaining balance", async () => {
    const emp = await seedEmployee();
    await expect(
      requestLeave(db, owner, {
        employeeId: emp.id,
        leaveType: "annual",
        startDate: "2026-08-10",
        endDate: "2026-09-05",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "errors.hrLeaveNoBalance" });
  });

  it("rejects a leave with end before start", async () => {
    const emp = await seedEmployee();
    await expect(
      requestLeave(db, owner, {
        employeeId: emp.id,
        leaveType: "annual",
        startDate: "2026-08-20",
        endDate: "2026-08-10",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.hrLeaveRangeInvalid" });
  });

  it("denies reception from approving leaves", async () => {
    const emp = await seedEmployee();
    const leave = await requestLeave(db, owner, { employeeId: emp.id, leaveType: "sick", startDate: "2026-08-10", endDate: "2026-08-11" });
    await expect(
      decideLeave(db, reception, { leaveId: leave.id, approve: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("edits a pending leave request", async () => {
    const emp = await seedEmployee();
    const leave = await requestLeave(db, owner, { employeeId: emp.id, leaveType: "sick", startDate: "2026-08-10", endDate: "2026-08-11", reason: "مرض" });
    const updated = await updateLeave(db, manager, {
      leaveId: leave.id,
      leaveType: "annual",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      reason: "إجازة سنوية",
    });
    expect(updated.leaveType).toBe("annual");
    expect(updated.days).toBe(3);
    expect(updated.status).toBe("pending");
  });

  it("rejects editing an already-approved leave", async () => {
    const emp = await seedEmployee();
    const leave = await requestLeave(db, owner, { employeeId: emp.id, leaveType: "sick", startDate: "2026-08-10", endDate: "2026-08-11" });
    await decideLeave(db, manager, { leaveId: leave.id, approve: true });
    await expect(
      updateLeave(db, manager, { leaveId: leave.id, leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-11" }),
    ).rejects.toMatchObject({ messageKey: "errors.hrLeaveNotEditable" });
  });

  it("rejects editing another employee's pending leave as reception", async () => {
    const emp = await seedEmployee();
    await linkEmployeeToUser(emp.id, reception.userId);
    const leave = await requestLeave(db, owner, { employeeId: emp.id, leaveType: "sick", startDate: "2026-08-10", endDate: "2026-08-11" });
    await expect(
      updateLeave(db, reception, { leaveId: leave.id, leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-11" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cancels a pending leave", async () => {
    const emp = await seedEmployee();
    const leave = await requestLeave(db, owner, { employeeId: emp.id, leaveType: "sick", startDate: "2026-08-10", endDate: "2026-08-11" });
    const cancelled = await cancelLeave(db, owner, leave.id);
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("deductions & incentives", () => {
  it("adds a deduction and incentive, visible on the summary", async () => {
    const emp = await seedEmployee();
    const ded = await addDeduction(db, manager, { employeeId: emp.id, amountMinor: 50000, reason: "الغياب", dateKey: "2026-08-05" });
    const inc = await addIncentive(db, manager, { employeeId: emp.id, amountMinor: 100000, reason: "أداء ممتاز", dateKey: "2026-08-06" });
    expect(ded.amountMinor).toBe(50000);
    expect(inc.amountMinor).toBe(100000);

    const summary = monthlySalarySummary(db, manager, { employeeId: emp.id, periodMonth: "2026-08" });
    expect(summary.deductionsMinor).toBe(50000);
    expect(summary.incentivesMinor).toBe(100000);
  });

  it("denies reception from adding deductions", async () => {
    const emp = await seedEmployee();
    await expect(
      addDeduction(db, reception, { employeeId: emp.id, amountMinor: 1000, reason: "ممنوع" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates a deduction's amount and reason", async () => {
    const emp = await seedEmployee();
    const ded = await addDeduction(db, manager, { employeeId: emp.id, amountMinor: 50000, reason: "الغياب", dateKey: "2026-08-05" });
    const updated = await updateDeduction(db, manager, { id: ded.id, amountMinor: 75000, reason: "الغياب المتكرر", dateKey: "2026-08-06" });
    expect(updated.amountMinor).toBe(75000);
    expect(updated.reason).toBe("الغياب المتكرر");
    expect(updated.dateKey).toBe("2026-08-06");

    const summary = monthlySalarySummary(db, manager, { employeeId: emp.id, periodMonth: "2026-08" });
    expect(summary.deductionsMinor).toBe(75000);
  });

  it("deletes a deduction and removes it from the summary", async () => {
    const emp = await seedEmployee();
    const ded = await addDeduction(db, manager, { employeeId: emp.id, amountMinor: 50000, reason: "الغياب", dateKey: "2026-08-05" });
    await deleteDeduction(db, manager, ded.id);

    const summary = monthlySalarySummary(db, manager, { employeeId: emp.id, periodMonth: "2026-08" });
    expect(summary.deductionsMinor).toBe(0);
    expect(listDeductions(db, manager, { month: "2026-08" })).toHaveLength(0);
  });

  it("updates and deletes an incentive", async () => {
    const emp = await seedEmployee();
    const inc = await addIncentive(db, manager, { employeeId: emp.id, amountMinor: 100000, reason: "أداء ممتاز", dateKey: "2026-08-06" });
    const updated = await updateIncentive(db, manager, { id: inc.id, amountMinor: 120000, reason: "أداء استثنائي", dateKey: "2026-08-06" });
    expect(updated.amountMinor).toBe(120000);
    await deleteIncentive(db, manager, inc.id);
    expect(listIncentives(db, manager, { month: "2026-08" })).toHaveLength(0);
  });

  it("denies reception from updating deductions", async () => {
    const emp = await seedEmployee();
    const ded = await addDeduction(db, manager, { employeeId: emp.id, amountMinor: 50000, reason: "الغياب", dateKey: "2026-08-05" });
    await expect(
      updateDeduction(db, reception, { id: ded.id, amountMinor: 9999, reason: "ممنوع", dateKey: "2026-08-05" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("monthly salary summary", () => {
  it("computes net = base + incentives - deductions - unpaid leave impact", async () => {
    const emp = await seedEmployee(5000000);
    await addDeduction(db, manager, { employeeId: emp.id, amountMinor: 50000, reason: "استقطاع", dateKey: "2026-08-05" });
    await addIncentive(db, manager, { employeeId: emp.id, amountMinor: 100000, reason: "حافز", dateKey: "2026-08-06" });
    const leave = await requestLeave(db, owner, { employeeId: emp.id, leaveType: "unpaid", startDate: "2026-08-10", endDate: "2026-08-11" });
    await decideLeave(db, manager, { leaveId: leave.id, approve: true });

    const summary = monthlySalarySummary(db, manager, { employeeId: emp.id, periodMonth: "2026-08" });
    expect(summary.baseMinor).toBe(5000000);
    expect(summary.incentivesMinor).toBe(100000);
    expect(summary.deductionsMinor).toBe(50000);
    expect(summary.unpaidLeaveDays).toBe(2);

    const dailyRate = Math.round(5000000 / 30);
    const impact = 2 * dailyRate;
    expect(summary.unpaidLeaveImpactMinor).toBe(impact);
    expect(summary.netMinor).toBe(5000000 + 100000 - 50000 - impact);
  });

  it("rejects reading another employee's summary without permission (reception)", async () => {
    const emp = await seedEmployee();
    const other = await seedEmployee(3000000);
    await linkEmployeeToUser(emp.id, reception.userId);
    expect(() => monthlySalarySummary(db, reception, { employeeId: other.id, periodMonth: "2026-08" }))
      .toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});

describe("daily activity (owner only)", () => {
  it("requires hr.activity_view and aggregates attendance", async () => {
    const emp = await seedEmployee();
    await clockIn(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 09:00:00" });
    await clockOut(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 17:00:00" });

    const report = employeeDailyActivity(db, owner, { employeeId: emp.id, dateKey: "2026-08-01" });
    expect(report.totals.attendanceIn).toBe(1);
    expect(report.totals.attendanceOut).toBe(1);
    expect(report.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("denies reception from viewing a daily activity report", async () => {
    const emp = await seedEmployee();
    expect(() => employeeDailyActivity(db, reception, { employeeId: emp.id, dateKey: "2026-08-01" }))
      .toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});

describe("employee barcode & barcode check-in/out", () => {
  it("sets a normalized barcode and clocks in/out by scanning it", async () => {
    const emp = await seedEmployee();
    await setEmployeeBarcode(db, manager, { employeeId: emp.id, barcode: "emp-0001" });

    const inRec = await clockInByBarcode(db, reception, { barcode: "EMP-0001", dateKey: "2026-08-01", at: "2026-08-01 09:00:00" });
    expect(inRec.employeeId).toBe(emp.id);
    expect(inRec.clockOutAt).toBeNull();

    const outRec = await clockOutByBarcode(db, reception, { barcode: "EMP-0001", dateKey: "2026-08-01", at: "2026-08-01 17:00:00" });
    expect(outRec.workedMinutes).toBe(480);
  });

  it("rejects an invalid barcode format", async () => {
    const emp = await seedEmployee();
    await expect(setEmployeeBarcode(db, manager, { employeeId: emp.id, barcode: "x" }))
      .rejects.toMatchObject({ messageKey: "errors.invalidBarcode" });
  });

  it("rejects a barcode already taken by another employee", async () => {
    const emp = await seedEmployee();
    const other = await seedEmployee(3000000);
    await setEmployeeBarcode(db, manager, { employeeId: other.id, barcode: "EMP-0001" });
    await expect(setEmployeeBarcode(db, manager, { employeeId: emp.id, barcode: "EMP-0001" }))
      .rejects.toMatchObject({ messageKey: "errors.barcodeTaken" });
  });

  it("rejects scanning an unknown barcode", async () => {
    await expect(clockInByBarcode(db, reception, { barcode: "EMP-NOPE" }))
      .rejects.toMatchObject({ messageKey: "errors.employeeBarcodeUnknown" });
  });

  it("denies reception from setting an employee barcode", async () => {
    const emp = await seedEmployee();
    await expect(setEmployeeBarcode(db, reception, { employeeId: emp.id, barcode: "EMP-0001" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("per-employee leave entitlements", () => {
  it("sets per-type quotas and reflects them in the balance", async () => {
    const emp = await seedEmployee();
    await setLeaveEntitlements(db, manager, { employeeId: emp.id, annualDays: 10, sickDays: 5, unpaidDays: 3 });

    const balances = getLeaveBalance(db, owner, { employeeId: emp.id, year: "2026" });
    expect(balances.find((b) => b.type === "annual")?.entitlement).toBe(10);
    expect(balances.find((b) => b.type === "sick")?.entitlement).toBe(5);
    expect(balances.find((b) => b.type === "unpaid")?.entitlement).toBe(3);
  });

  it("denies reception from setting entitlements", async () => {
    const emp = await seedEmployee();
    await expect(setLeaveEntitlements(db, reception, { employeeId: emp.id, annualDays: 10 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("auto monthly salary generation", () => {
  it("generates pending salary rows for every active employee without one, idempotently", async () => {
    await seedEmployee();
    await seedEmployee(3000000);

    const first = await ensureSalariesForMonth(db, manager, { periodMonth: "2026-08" });
    expect(first.created).toBe(2);

    const second = await ensureSalariesForMonth(db, manager, { periodMonth: "2026-08" });
    expect(second.created).toBe(0);
  });

  it("denies reception from generating salaries", async () => {
    await expect(ensureSalariesForMonth(db, reception, { periodMonth: "2026-08" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("monthly worked hours", () => {
  it("aggregates per-day hours for an employee", async () => {
    const emp = await seedEmployee();
    await clockIn(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 09:00:00" });
    await clockOut(db, owner, { employeeId: emp.id, dateKey: "2026-08-01", at: "2026-08-01 17:00:00" });
    await clockIn(db, owner, { employeeId: emp.id, dateKey: "2026-08-02", at: "2026-08-02 08:00:00" });
    await clockOut(db, owner, { employeeId: emp.id, dateKey: "2026-08-02", at: "2026-08-02 16:00:00" });

    const res = employeeMonthlyHours(db, owner, { employeeId: emp.id, month: "2026-08" });
    expect(res.days).toHaveLength(2);
    const total = res.days.reduce((sum, d) => sum + d.workedMinutes, 0);
    expect(total).toBe(960);
  });

  it("denies reception from viewing another employee's hours", async () => {
    const emp = await seedEmployee();
    expect(() => employeeMonthlyHours(db, reception, { employeeId: emp.id, month: "2026-08" }))
      .toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
