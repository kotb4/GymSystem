import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import {
  createTrainer,
  linkTrainerToEmployee,
  createEmployeeForTrainer,
  listTrainers,
} from "@/core/services/trainers.service";
import {
  createEmployee,
  calculateTrainerMonthlyDues,
  getPayslipData,
  sendSalaryPayslipWhatsApp,
  recordSalary,
} from "@/core/services/employees.service";

import type { Db } from "@/db/engine";

async function createOwner(db: Db) {
  return buildActor(
    await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Password123!",
    }),
  );
}

describe("Trainer-Employee Link, Dues & Payslip WhatsApp Suite", () => {
  it("links existing employee to trainer and creates employee for trainer with 1-click", async () => {
    const db = await createTestDb();
    const actor = await createOwner(db);

    // 1. Create a trainer
    const trainer = await createTrainer(db, actor, {
      fullName: "كابتن زياد",
      phone: "01011112222",
      specialization: "كمال أجسام",
    });

    expect(trainer.employeeId).toBeNull();

    // 2. Create employee independently and link
    const emp1 = await createEmployee(db, actor, {
      fullName: "زياد أحمد",
      phone: "01011112222",
      roleTitle: "مدرب جيم",
      salaryType: "monthly",
      salaryBaseMinor: 500000,
    });

    const linked = await linkTrainerToEmployee(db, actor, trainer.id, emp1.id);
    expect(linked.employeeId).toBe(emp1.id);

    const list1 = listTrainers(db, actor);
    const found1 = list1.find((t) => t.id === trainer.id);
    expect(found1?.employeeId).toBe(emp1.id);

    // 3. Unlink
    const unlinked = await linkTrainerToEmployee(db, actor, trainer.id, null);
    expect(unlinked.employeeId).toBeNull();

    // 4. Create employee for trainer automatically (1-click)
    const res = await createEmployeeForTrainer(db, actor, trainer.id, {
      salaryType: "per_class",
      salaryBaseMinor: 15000, // 150 EGP per class
      commissionPct: 20,
    });

    expect(res.employeeId).toBeDefined();
    expect(res.trainer.employeeId).toBe(res.employeeId);
  });

  it("calculates PT sessions commission and group class dues accurately for salary month", async () => {
    const db = await createTestDb();
    const actor = await createOwner(db);

    // 1. Create trainer and linked employee
    const trainer = await createTrainer(db, actor, {
      fullName: "كابتن سارة",
      phone: "01033334444",
    });

    const emp = await createEmployee(db, actor, {
      fullName: "سارة محمود",
      phone: "01033334444",
      roleTitle: "مدربة فتنس وبيلاتس",
      salaryType: "per_class",
      salaryBaseMinor: 10000, // 100 EGP per class
      commissionPct: 15,
    });

    await linkTrainerToEmployee(db, actor, trainer.id, emp.id);

    // 2. Add private training package and sessions
    const pkgId = "pkg-pt-1";
    db.run(
      `INSERT INTO private_training_packages (id, name, sessions_count, price_minor, duration_days, coach_commission_percent, is_active, created_at)
       VALUES (?, 'باقة 10 جلسات', 10, 200000, 30, 25, 1, '2026-10-01T10:00:00Z')`,
      [pkgId],
    );

    const memberId = "mem-test-1";
    db.run(
      `INSERT INTO members (id, member_code, full_name, phone, gender, registration_date, created_at, updated_at)
       VALUES (?, 'B1-MEM-999', 'عضو تجريبي', '01099998888', 'female', '2026-10-01', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')`,
      [memberId],
    );

    const ptId = "pt-test-1";
    db.run(
      `INSERT INTO private_trainings (id, member_id, trainer_id, package_id, total_sessions, completed_sessions, price_minor, paid_amount_minor, remaining_amount_minor, start_date, end_date, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 10, 2, 200000, 200000, 0, '2026-10-01', '2026-10-31', 'active', ?, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')`,
      [ptId, memberId, trainer.id, pkgId, actor.userId],
    );

    // Add 2 completed PT sessions in October 2026
    db.run(
      `INSERT INTO private_training_sessions (id, private_training_id, trainer_id, session_date, session_time, created_by, created_at)
       VALUES ('s1', ?, ?, '2026-10-05', '14:00', ?, '2026-10-05T14:00:00Z'),
              ('s2', ?, ?, '2026-10-08', '14:00', ?, '2026-10-08T14:00:00Z')`,
      [ptId, trainer.id, actor.userId, ptId, trainer.id, actor.userId],
    );

    // 3. Add 3 completed class sessions in October 2026
    const classId = "cls-yoga-1";
    db.run(
      `INSERT INTO classes (id, name, trainer_id, capacity, is_active, created_by, created_at, updated_at)
       VALUES (?, 'يوغا الصباح', ?, 20, 1, ?, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z')`,
      [classId, trainer.id, actor.userId],
    );

    db.run(
      `INSERT INTO class_sessions (id, class_id, session_date, start_time, duration_min, capacity, status, created_by, created_at)
       VALUES ('cs1', ?, '2026-10-02', '09:00', 60, 20, 'done', ?, '2026-10-02T09:00:00Z'),
              ('cs2', ?, '2026-10-04', '09:00', 60, 20, 'done', ?, '2026-10-04T09:00:00Z'),
              ('cs3', ?, '2026-10-06', '09:00', 60, 20, 'done', ?, '2026-10-06T09:00:00Z')`,
      [classId, actor.userId, classId, actor.userId, classId, actor.userId],
    );

    // Calculate dues for October 2026
    const dues = calculateTrainerMonthlyDues(db, actor, emp.id, "2026-10");

    expect(dues.trainerId).toBe(trainer.id);
    expect(dues.ptSessionsCount).toBe(2);
    // Package price = 2000 EGP (200,000 minor) for 10 sessions = 200 EGP / session.
    // 25% commission = 50 EGP (5,000 minor) per session * 2 sessions = 10,000 minor (100 EGP).
    expect(dues.ptCommissionMinor).toBe(10000);

    // 3 classes * 10,000 minor (100 EGP per class rate) = 30,000 minor (300 EGP).
    expect(dues.classesCount).toBe(3);
    expect(dues.classesEarningsMinor).toBe(30000);

    // Total dues = 10000 + 30000 = 40000 minor (400 EGP).
    expect(dues.totalDuesMinor).toBe(40000);
    expect(dues.suggestedNotes).toContain("عمولة تدريب برايفت");
    expect(dues.suggestedNotes).toContain("حصص جماعية");
  });

  it("generates payslip and builds WhatsApp delivery text with direct link", async () => {
    const db = await createTestDb();
    const actor = await createOwner(db);

    const emp = await createEmployee(db, actor, {
      fullName: "محمد إبراهيم",
      phone: "01234567890",
      roleTitle: "مدير استقبال",
      salaryType: "monthly",
      salaryBaseMinor: 600000,
    });

    const salary = await recordSalary(db, actor, {
      employeeId: emp.id,
      periodMonth: "2026-10",
      bonusMinor: 50000,
      deductionMinor: 20000,
      notes: "مكافأة تميز في خدمة العملاء",
    });

    const payslip = getPayslipData(db, actor, salary.id);
    expect(payslip.salary.id).toBe(salary.id);
    expect(payslip.employee.fullName).toBe("محمد إبراهيم");
    expect(payslip.salary.baseMinor).toBe(600000);
    expect(payslip.salary.netMinor).toBe(630000);

    const whatsappResult = await sendSalaryPayslipWhatsApp(db, actor, salary.id);
    expect(whatsappResult.message).toContain("محمد إبراهيم");
    expect(whatsappResult.message).toContain("6,000.00 ج.م");
    expect(whatsappResult.message).toContain("6,300.00 ج.م");
    expect(whatsappResult.directUrl).toBeDefined();
    expect(whatsappResult.directUrl).toContain("https://wa.me/201234567890");
  });
});
