import { addDaysKey, nowStamp, todayKey } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";

const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TrainerRow extends Row {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  joined_date: string;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicTrainer {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  joinedDate: string;
  isActive: boolean;
  notes: string | null;
}

function toTrainer(row: TrainerRow): PublicTrainer {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    specialization: row.specialization,
    joinedDate: row.joined_date,
    isActive: row.is_active === 1,
    notes: row.notes,
  };
}

export function getTrainerById(db: Db, trainerId: string): TrainerRow | null {
  return db.first<TrainerRow>("SELECT * FROM trainers WHERE id = ?", [trainerId]);
}

function assertOptionalPhone(phone: string | null | undefined): string | null {
  const value = phone?.trim() ?? "";
  if (value === "") return null;
  if (!PHONE_RE.test(value)) throw errValidation("errors.phoneInvalid");
  return value;
}

function assertOptionalEmail(email: string | null | undefined): string | null {
  const value = email?.trim() ?? "";
  if (value === "") return null;
  if (!EMAIL_RE.test(value)) throw errValidation("errors.emailInvalid");
  return value;
}

function assertPhoneFree(db: Db, phone: string | null, excludeTrainerId?: string): void {
  if (!phone) return;
  const existing = excludeTrainerId
    ? db.first<{ id: string }>("SELECT id FROM trainers WHERE phone = ? AND id != ?", [
        phone,
        excludeTrainerId,
      ])
    : db.first<{ id: string }>("SELECT id FROM trainers WHERE phone = ?", [phone]);
  if (existing) throw errConflict("errors.trainerPhoneTaken");
}

interface TrainerInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  specialization?: string | null;
  joinedDate?: string;
  notes?: string | null;
}

function assertTrainerInput(input: TrainerInput): {
  fullName: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  joinedDate: string;
  notes: string | null;
} {
  const fullName = input.fullName.trim();
  if (fullName.length < 3) throw errValidation("errors.fullNameRequired");
  const today = todayKey();
  const joinedDate = input.joinedDate?.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedDate)) throw errValidation("errors.invalidDate");
  if (joinedDate > addDaysKey(today, 365)) throw errValidation("errors.dateInFuture");
  return {
    fullName,
    phone: assertOptionalPhone(input.phone),
    email: assertOptionalEmail(input.email),
    specialization: input.specialization?.trim().slice(0, 120) || null,
    joinedDate,
    notes: input.notes?.trim().slice(0, 500) || null,
  };
}

export async function createTrainer(
  db: Db,
  actor: ServiceActor,
  input: TrainerInput,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const data = assertTrainerInput(input);
  assertPhoneFree(db, data.phone);

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO trainers (id, full_name, phone, email, specialization, joined_date, is_active, notes, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
      [
        id,
        data.fullName,
        data.phone,
        data.email,
        data.specialization,
        data.joinedDate,
        data.notes,
        actor.userId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "TRAINER_CREATED", "trainer", id, { name: data.fullName });
  });
  return toTrainer(getTrainerById(db, id)!);
}

export async function updateTrainer(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
  input: TrainerInput,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  const data = assertTrainerInput(input);
  assertPhoneFree(db, data.phone, trainerId);

  await db.transaction(async () => {
    db.run(
      "UPDATE trainers SET full_name = ?, phone = ?, email = ?, specialization = ?, joined_date = ?, notes = ?, updated_at = ? WHERE id = ?",
      [
        data.fullName,
        data.phone,
        data.email,
        data.specialization,
        data.joinedDate,
        data.notes,
        nowStamp(),
        trainerId,
      ],
    );
    recordAudit(db, actor, "TRAINER_UPDATED", "trainer", trainerId, { name: data.fullName });
  });
  return toTrainer(getTrainerById(db, trainerId)!);
}

export async function setTrainerActive(
  db: Db,
  actor: ServiceActor,
  trainerId: string,
  active: boolean,
): Promise<PublicTrainer> {
  requirePermission(actor, "trainers.manage");
  const trainer = getTrainerById(db, trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  const target = active ? 1 : 0;
  if (trainer.is_active === target) return toTrainer(trainer);

  if (!active) {
    const activePlans = db.count(
      "SELECT COUNT(*) FROM training_plans WHERE trainer_id = ? AND status = 'active'",
      [trainerId],
    );
    if (activePlans > 0) throw errConflict("errors.trainerHasActivePlans", { count: activePlans });
  }

  await db.transaction(async () => {
    db.run("UPDATE trainers SET is_active = ?, updated_at = ? WHERE id = ?", [
      target,
      nowStamp(),
      trainerId,
    ]);
    recordAudit(db, actor, active ? "TRAINER_ACTIVATED" : "TRAINER_DEACTIVATED", "trainer", trainerId, {
      name: trainer.full_name,
    });
  });
  return toTrainer(getTrainerById(db, trainerId)!);
}

export interface TrainerListQuery {
  search?: string;
  activeOnly?: boolean;
}

interface TrainerWithStats extends TrainerRow {
  active_plans: number;
}

export function listTrainers(
  db: Db,
  actor: ServiceActor,
  query: TrainerListQuery = {},
): Array<PublicTrainer & { activePlans: number }> {
  requirePermission(actor, "trainers.view");
  const conditions: string[] = [];
  const params: Array<string> = [];
  if (query.activeOnly) conditions.push("t.is_active = 1");
  const search = query.search?.trim();
  if (search) {
    conditions.push("(t.full_name LIKE ? OR t.phone LIKE ? OR t.specialization LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.all<TrainerWithStats>(
    `SELECT t.*, (SELECT COUNT(*) FROM training_plans tp WHERE tp.trainer_id = t.id AND tp.status = 'active') AS active_plans\nFROM trainers t ${where} ORDER BY t.is_active DESC, t.full_name COLLATE NOCASE`,
    params,
  );
  return rows.map((row) => ({ ...toTrainer(row), activePlans: Number(row.active_plans) }));
}
