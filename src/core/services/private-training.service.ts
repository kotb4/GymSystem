import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row, SqlValue } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { randomUUID } from "node:crypto";

export interface PTPackageInput {
  name: string;
  sessionsCount: number;
  priceMinor: number;
  durationDays: number;
  coachCommissionPercent?: number;
}

export interface PTPackageRow extends Row {
  id: string;
  name: string;
  sessions_count: number;
  price_minor: number;
  duration_days: number;
  coach_commission_percent: number;
  is_active: number;
  created_at: string;
}

export interface PrivateTrainingInput {
  memberId: string;
  trainerId: string;
  packageId?: string | null;
  totalSessions: number;
  priceMinor: number;
  paidAmountMinor: number;
  methodCode?: string | null;
  startDate: string;
  endDate: string;
  notes?: string | null;
}

export interface PTSessionInput {
  privateTrainingId: string;
  trainerId?: string;
  sessionDate?: string;
  sessionTime?: string;
  notes?: string;
}

export interface PrivateTrainingRow {
  id: string;
  member_id: string;
  trainer_id: string;
  package_id: string | null;
  total_sessions: number;
  completed_sessions: number;
  remaining_sessions?: number;
  price_minor: number;
  paid_amount_minor: number;
  remaining_amount_minor: number;
  method_code: string | null;
  start_date: string;
  end_date: string;
  status: "active" | "completed" | "cancelled" | "expired";
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_name?: string;
  member_phone?: string;
  member_code?: string;
  trainer_name?: string;
  package_name?: string;
  sessions?: PTSessionRow[];
}

export interface PTSessionRow {
  id: string;
  private_training_id: string;
  trainer_id: string;
  trainer_name?: string;
  session_date: string;
  session_time: string;
  notes: string | null;
  created_by: string;
  created_at: string;
}

// ---------------- Packages ----------------

export function createPTPackage(
  db: Db,
  actor: ServiceActor,
  input: PTPackageInput,
): PTPackageRow {
  requirePermission(actor, "private_training.manage");

  if (!input.name || input.name.trim().length < 2) {
    throw errValidation("errors.pt.packageNameRequired");
  }
  if (input.sessionsCount <= 0) {
    throw errValidation("errors.pt.sessionsInvalid");
  }
  if (input.priceMinor < 0) {
    throw errValidation("errors.pt.priceInvalid");
  }
  if (input.durationDays <= 0) {
    throw errValidation("errors.pt.durationInvalid");
  }

  const id = randomUUID();
  const stamp = nowStamp();

  db.run(
    `INSERT INTO private_training_packages (
      id, name, sessions_count, price_minor, duration_days,
      coach_commission_percent, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      input.name.trim(),
      input.sessionsCount,
      input.priceMinor,
      input.durationDays,
      input.coachCommissionPercent || 0,
      stamp,
    ],
  );

  return db.first<PTPackageRow>(
    "SELECT * FROM private_training_packages WHERE id = ?",
    [id],
  )!;
}

export function listPTPackages(
  db: Db,
  actor: ServiceActor,
  includeInactive = false,
): PTPackageRow[] {
  requirePermission(actor, "private_training.view");
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return db.all<PTPackageRow>(
    `SELECT * FROM private_training_packages ${where} ORDER BY price_minor ASC`,
  );
}

// ---------------- Private Trainings ----------------

export function createPrivateTraining(
  db: Db,
  actor: ServiceActor,
  input: PrivateTrainingInput,
): PrivateTrainingRow {
  requirePermission(actor, "private_training.manage");

  const member = db.first<{ id: string; full_name: string }>(
    "SELECT id, full_name FROM members WHERE id = ? AND deleted_at IS NULL",
    [input.memberId],
  );
  if (!member) throw errNotFound("errors.memberNotFound");

  const trainer = db.first<{ id: string; full_name: string }>(
    "SELECT id, full_name FROM trainers WHERE id = ?",
    [input.trainerId],
  );
  if (!trainer) throw errNotFound("errors.trainerNotFound");

  if (input.totalSessions <= 0) throw errValidation("errors.pt.sessionsInvalid");
  if (input.priceMinor < 0) throw errValidation("errors.pt.priceInvalid");
  if (input.paidAmountMinor < 0 || input.paidAmountMinor > input.priceMinor) {
    throw errValidation("errors.pt.paidInvalid");
  }
  if (!input.startDate || !input.endDate || input.endDate < input.startDate) {
    throw errValidation("errors.invalidRange");
  }

  const id = randomUUID();
  const stamp = nowStamp();
  const remainingAmountMinor = input.priceMinor - input.paidAmountMinor;

  return db.transaction(() => {
    db.run(
      `INSERT INTO private_trainings (
        id, member_id, trainer_id, package_id, total_sessions,
        completed_sessions, price_minor, paid_amount_minor,
        remaining_amount_minor, method_code, start_date, end_date,
        status, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        id,
        input.memberId,
        input.trainerId,
        input.packageId || null,
        input.totalSessions,
        input.priceMinor,
        input.paidAmountMinor,
        remainingAmountMinor,
        input.methodCode || null,
        input.startDate,
        input.endDate,
        input.notes?.trim() || null,
        actor.userId,
        stamp,
        stamp,
      ],
    );

    // Ledger payment entry
    if (input.paidAmountMinor > 0) {
      db.run(
        `INSERT INTO financial_ledger (
          entry_type, ref_table, ref_id, member_id, method_code, direction,
          amount_minor, occurred_at, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "payment",
          "private_trainings",
          id,
          input.memberId,
          input.methodCode || "cash",
          1,
          input.paidAmountMinor,
          input.startDate,
          actor.userId,
          stamp,
        ],
      );
    }

    recordAudit(
      db,
      actor,
      "PRIVATE_TRAINING_CREATED",
      "private_training",
      id,
      {
        memberName: member.full_name,
        trainerName: trainer.full_name,
        sessions: input.totalSessions,
        priceMinor: input.priceMinor,
      },
    );

    return getPrivateTrainingById(db, actor, id)!;
  });
}

export function recordPTSession(
  db: Db,
  actor: ServiceActor,
  input: {
    privateTrainingId: string;
    trainerId?: string;
    sessionDate?: string;
    sessionTime?: string;
    notes?: string;
  },
): { success: boolean; completedSessions: number; remainingSessions: number } {
  requirePermission(actor, "private_training.manage");

  const pt = db.first<{
    id: string;
    trainer_id: string;
    total_sessions: number;
    completed_sessions: number;
    status: string;
  }>("SELECT id, trainer_id, total_sessions, completed_sessions, status FROM private_trainings WHERE id = ?", [
    input.privateTrainingId,
  ]);
  if (!pt) throw errNotFound("errors.ptNotFound");

  if (pt.status !== "active") {
    throw errValidation("errors.pt.notActive");
  }
  if (pt.completed_sessions >= pt.total_sessions) {
    throw errValidation("errors.pt.sessionsExhausted");
  }

  const id = randomUUID();
  const stamp = nowStamp();
  const sessionDate = input.sessionDate || todayKey();
  const now = new Date();
  const sessionTime =
    input.sessionTime ||
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const trainerId = input.trainerId || pt.trainer_id;
  const newCompleted = pt.completed_sessions + 1;
  const newStatus = newCompleted >= pt.total_sessions ? "completed" : "active";

  return db.transaction(() => {
    db.run(
      `INSERT INTO private_training_sessions (
        id, private_training_id, trainer_id, session_date, session_time,
        notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        pt.id,
        trainerId,
        sessionDate,
        sessionTime,
        input.notes?.trim() || null,
        actor.userId,
        stamp,
      ],
    );

    db.run(
      `UPDATE private_trainings 
       SET completed_sessions = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [newCompleted, newStatus, stamp, pt.id],
    );

    recordAudit(
      db,
      actor,
      "PRIVATE_TRAINING_SESSION_RECORDED",
      "private_training",
      pt.id,
      {
        completed: newCompleted,
        total: pt.total_sessions,
      },
    );

    return {
      success: true,
      completedSessions: newCompleted,
      remainingSessions: pt.total_sessions - newCompleted,
    };
  });
}

export function getPrivateTrainingById(
  db: Db,
  actor: ServiceActor,
  id: string,
): PrivateTrainingRow | null {
  requirePermission(actor, "private_training.view");

  const row = db.first<PrivateTrainingRow>(
    `SELECT pt.*,
            m.full_name AS member_name, m.phone AS member_phone, m.member_code,
            t.full_name AS trainer_name,
            pkg.name AS package_name
     FROM private_trainings pt
     JOIN members m ON pt.member_id = m.id
     JOIN trainers t ON pt.trainer_id = t.id
     LEFT JOIN private_training_packages pkg ON pt.package_id = pkg.id
     WHERE pt.id = ?`,
    [id],
  );
  if (!row) return null;

  row.sessions = db.all<PTSessionRow>(
    `SELECT s.*, t.full_name AS trainer_name
     FROM private_training_sessions s
     LEFT JOIN trainers t ON s.trainer_id = t.id
     WHERE s.private_training_id = ?
     ORDER BY s.session_date DESC, s.session_time DESC`,
    [id],
  );

  row.remaining_sessions = row.total_sessions - row.completed_sessions;

  return row;
}

export function listPrivateTrainings(
  db: Db,
  actor: ServiceActor,
  filter?: {
    memberId?: string;
    trainerId?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
): { items: PrivateTrainingRow[]; total: number } {
  requirePermission(actor, "private_training.view");

  const conditions: string[] = ["1=1"];
  const params: SqlValue[] = [];

  if (filter?.memberId) {
    conditions.push("pt.member_id = ?");
    params.push(filter.memberId);
  }
  if (filter?.trainerId && filter.trainerId !== "all") {
    conditions.push("pt.trainer_id = ?");
    params.push(filter.trainerId);
  }
  if (filter?.status && filter.status !== "all") {
    conditions.push("pt.status = ?");
    params.push(filter.status);
  }
  if (filter?.search && filter.search.trim()) {
    conditions.push("(m.full_name LIKE ? OR m.phone LIKE ? OR t.full_name LIKE ?)");
    const q = `%${filter.search.trim()}%`;
    params.push(q, q, q);
  }

  const whereClause = conditions.join(" AND ");
  const total = db.count(
    `SELECT COUNT(*) FROM private_trainings pt
     JOIN members m ON pt.member_id = m.id
     JOIN trainers t ON pt.trainer_id = t.id
     WHERE ${whereClause}`,
    params,
  );

  const limit = Math.min(Math.max(filter?.limit || 50, 1), 200);
  const offset = Math.max(filter?.offset || 0, 0);

  const items = db.all<PrivateTrainingRow>(
    `SELECT pt.*,
            m.full_name AS member_name, m.phone AS member_phone, m.member_code,
            t.full_name AS trainer_name,
            pkg.name AS package_name
     FROM private_trainings pt
     JOIN members m ON pt.member_id = m.id
     JOIN trainers t ON pt.trainer_id = t.id
     LEFT JOIN private_training_packages pkg ON pt.package_id = pkg.id
     WHERE ${whereClause}
     ORDER BY pt.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  for (const item of items) {
    item.remaining_sessions = item.total_sessions - item.completed_sessions;
  }

  return { items, total };
}

export function getPTSummary(
  db: Db,
  actor: ServiceActor,
): {
  activeCount: number;
  completedCount: number;
  totalRevenueMinor: number;
  totalCompletedSessions: number;
} {
  requirePermission(actor, "private_training.view");

  const row = db.first<{
    active_count: number;
    completed_count: number;
    total_rev: number;
    completed_sessions: number;
  }>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
            COALESCE(SUM(paid_amount_minor), 0) AS total_rev,
            COALESCE(SUM(completed_sessions), 0) AS completed_sessions
     FROM private_trainings`,
  );

  return {
    activeCount: Number(row?.active_count || 0),
    completedCount: Number(row?.completed_count || 0),
    totalRevenueMinor: Number(row?.total_rev || 0),
    totalCompletedSessions: Number(row?.completed_sessions || 0),
  };
}
