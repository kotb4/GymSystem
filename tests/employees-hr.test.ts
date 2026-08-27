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
  getLeaveBalance,
  addDeduction,
  addIncentive,
  monthlySalarySummary,
  employeeDailyActivity,
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

    const bal = getLeaveBalance(db, owner, { employeeId: emp.id, year: "2026" });
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
