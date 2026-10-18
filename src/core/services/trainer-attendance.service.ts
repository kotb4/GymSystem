import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row, SqlValue } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { randomUUID } from "node:crypto";

export interface TrainerAttendanceRow extends Row {
  id: string;
  trainer_id: string;
  trainer_name: string;
  trainer_phone: string | null;
  trainer_specialization: string | null;
  date: string;
  check_in_time: string;
  check_out_time: string | null;
  status: "present" | "late" | "absent" | "excused";
  notes: string | null;
  created_at: string;
}

export interface TrainerAttendanceSummary {
  totalTrainers: number;
  presentToday: number;
  currentlyPresent: number;
  absentToday: number;
}

export function listTrainerAttendance(
  db: Db,
  date?: string,
  trainerId?: string
): TrainerAttendanceRow[] {
  let sql = `
    SELECT ta.*,
      t.full_name AS trainer_name,
      t.phone AS trainer_phone,
      t.specialization AS trainer_specialization
    FROM trainer_attendance ta
    JOIN trainers t ON ta.trainer_id = t.id
  `;
  const conds: string[] = [];
  const params: SqlValue[] = [];

  if (date) {
    conds.push("ta.date = ?");
    params.push(date);
  }
  if (trainerId) {
    conds.push("ta.trainer_id = ?");
    params.push(trainerId);
  }

  if (conds.length > 0) {
    sql += " WHERE " + conds.join(" AND ");
  }

  sql += " ORDER BY ta.check_in_time DESC";
  return db.all<TrainerAttendanceRow>(sql, params);
}

export function getTrainerAttendanceSummary(db: Db, date?: string): TrainerAttendanceSummary {
  const targetDate = date || todayKey();
  const totalTrainers = db.count("SELECT COUNT(*) FROM trainers WHERE is_active = 1");
  const presentToday = db.count(
    "SELECT COUNT(DISTINCT trainer_id) FROM trainer_attendance WHERE date = ?",
    [targetDate]
  );
  const currentlyPresent = db.count(
    "SELECT COUNT(*) FROM trainer_attendance WHERE date = ? AND check_out_time IS NULL",
    [targetDate]
  );
  const absentToday = Math.max(0, totalTrainers - presentToday);

  return {
    totalTrainers,
    presentToday,
    currentlyPresent,
    absentToday,
  };
}

export function recordTrainerCheckIn(
  db: Db,
  actor: ServiceActor,
  input: {
    trainerId: string;
    date?: string;
    time?: string;
    status?: "present" | "late" | "absent" | "excused";
    notes?: string;
  }
): TrainerAttendanceRow {
  requirePermission(actor, "trainer_attendance.manage");
  if (!input.trainerId) throw errValidation("errors.trainers.trainerRequired");

  const trainer = db.first("SELECT id, full_name FROM trainers WHERE id = ?", [input.trainerId]);
  if (!trainer) throw errNotFound("errors.trainers.notFound");

  const id = randomUUID();
  const stamp = nowStamp();
  const targetDate = input.date || todayKey();
  const now = new Date();
  const timeStr = input.time || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const status = input.status || "present";

  db.run(
    `INSERT INTO trainer_attendance (id, trainer_id, date, check_in_time, check_out_time, status, notes, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, input.trainerId, targetDate, timeStr, status, input.notes?.trim() || null, stamp]
  );

  recordAudit(db, actor, "TRAINER_ATTENDANCE_CHECKIN", "trainer_attendance", id, {
    trainer_id: input.trainerId,
    trainer_name: (trainer as { full_name: string }).full_name,
    date: targetDate,
    time: timeStr,
  });

  return db.first<TrainerAttendanceRow>(
    `SELECT ta.*,
       t.full_name AS trainer_name,
       t.phone AS trainer_phone,
       t.specialization AS trainer_specialization
     FROM trainer_attendance ta
     JOIN trainers t ON ta.trainer_id = t.id
     WHERE ta.id = ?`,
    [id]
  )!;
}

export function recordTrainerCheckOut(
  db: Db,
  actor: ServiceActor,
  input: {
    attendanceId: string;
    time?: string;
  }
): TrainerAttendanceRow {
  requirePermission(actor, "trainer_attendance.manage");
  if (!input.attendanceId) throw errValidation("errors.trainerAttendance.idRequired");

  const att = db.first<TrainerAttendanceRow>(
    "SELECT * FROM trainer_attendance WHERE id = ?",
    [input.attendanceId]
  );
  if (!att) throw errNotFound("errors.trainerAttendance.notFound");

  const now = new Date();
  const timeStr = input.time || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  db.run("UPDATE trainer_attendance SET check_out_time = ? WHERE id = ?", [
    timeStr,
    input.attendanceId,
  ]);

  recordAudit(db, actor, "TRAINER_ATTENDANCE_CHECKOUT", "trainer_attendance", input.attendanceId, {
    trainer_id: att.trainer_id,
    check_out_time: timeStr,
  });

  return db.first<TrainerAttendanceRow>(
    `SELECT ta.*,
       t.full_name AS trainer_name,
       t.phone AS trainer_phone,
       t.specialization AS trainer_specialization
     FROM trainer_attendance ta
     JOIN trainers t ON ta.trainer_id = t.id
     WHERE ta.id = ?`,
    [input.attendanceId]
  )!;
}
