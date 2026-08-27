import { addDaysKey, nowStamp, todayKey } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById } from "./members.service";
import { getTrainerById } from "./trainers.service";
import {
  assertDepartmentAccess,
  departmentScopeCondition,
  memberDepartmentById,
} from "./department";

export type TrainingPlanStatus = "active" | "ended" | "cancelled";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TrainingPlanRow extends Row {
  id: string;
  member_id: string;
  trainer_id: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: TrainingPlanStatus;
  created_at: string;
  updated_at: string;
}

export interface PublicTrainingPlan {
  id: string;
  memberId: string;
  trainerId: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: TrainingPlanStatus;
}

function toPlan(row: TrainingPlanRow): PublicTrainingPlan {
  return {
    id: row.id,
    memberId: row.member_id,
    trainerId: row.trainer_id,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    status: row.status,
  };
}

function getPlanRow(db: Db, planId: string): TrainingPlanRow | null {
  return db.first<TrainingPlanRow>("SELECT * FROM training_plans WHERE id = ?", [planId]);
}

export function getTrainingPlanById(db: Db, actor: ServiceActor, planId: string): PublicTrainingPlan {
  requirePermission(actor, "members.view");
  const row = getPlanRow(db, planId);
  if (!row) throw errNotFound("errors.trainingPlanNotFound");
  return toPlan(row);
}

interface PlanInput {
  memberId: string;
  trainerId: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
}

function assertPlanDates(startDate: string, endDate: string): void {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw errValidation("errors.invalidDate");
  }
  if (endDate < startDate) throw errValidation("errors.trainingPlanDateRange");
}

function assertNoActiveOverlap(
  db: Db,
  memberId: string,
  startDate: string,
  endDate: string,
  excludePlanId?: string,
): void {
  const existing = excludePlanId
    ? db.first<{ id: string }>(
        "SELECT id FROM training_plans WHERE member_id = ? AND status = 'active' AND id != ? AND (start_date <= ? AND end_date >= ?)",
        [memberId, excludePlanId, endDate, startDate],
      )
    : db.first<{ id: string }>(
        "SELECT id FROM training_plans WHERE member_id = ? AND status = 'active' AND (start_date <= ? AND end_date >= ?)",
        [memberId, endDate, startDate],
      );
  if (existing) throw errConflict("errors.trainingPlanOverlap");
}

export async function createTrainingPlan(
  db: Db,
  actor: ServiceActor,
  input: PlanInput,
): Promise<PublicTrainingPlan> {
  requirePermission(actor, "training.manage");
  assertPlanDates(input.startDate, input.endDate);

  const member = getMemberRowById(db, input.memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  if (member.status === "archived") throw errValidation("errors.memberArchived");
  assertDepartmentAccess(actor, member.department);

  const trainer = getTrainerById(db, input.trainerId);
  if (!trainer) throw errNotFound("errors.trainerNotFound");
  if (trainer.is_active !== 1) throw errValidation("errors.trainerInactive");

  assertNoActiveOverlap(db, member.id, input.startDate, input.endDate);

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO training_plans (id, member_id, trainer_id, start_date, end_date, notes, status, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
      [
        id,
        member.id,
        trainer.id,
        input.startDate,
        input.endDate,
        input.notes?.trim().slice(0, 500) || null,
        actor.userId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "TRAINING_PLAN_CREATED", "training_plan", id, {
      memberCode: member.member_code,
      trainerName: trainer.full_name,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  });
  return toPlan(getPlanRow(db, id)!);
}

interface PlanUpdateInput {
  trainerId?: string;
  startDate?: string;
  endDate?: string;
  notes?: string | null;
}

export async function updateTrainingPlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
  input: PlanUpdateInput,
): Promise<PublicTrainingPlan> {
  requirePermission(actor, "training.manage");
  const plan = getPlanRow(db, planId);
  if (!plan) throw errNotFound("errors.trainingPlanNotFound");
  if (plan.status !== "active") throw errValidation("errors.trainingPlanNotEditable");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(plan.member_id)));

  const startDate = input.startDate ?? plan.start_date;
  const endDate = input.endDate ?? plan.end_date;
  assertPlanDates(startDate, endDate);

  let trainerId = plan.trainer_id;
  if (input.trainerId && input.trainerId !== plan.trainer_id) {
    const trainer = getTrainerById(db, input.trainerId);
    if (!trainer) throw errNotFound("errors.trainerNotFound");
    if (trainer.is_active !== 1) throw errValidation("errors.trainerInactive");
    trainerId = trainer.id;
  }

  assertNoActiveOverlap(db, plan.member_id, startDate, endDate, planId);

  await db.transaction(async () => {
    db.run(
      "UPDATE training_plans SET trainer_id = ?, start_date = ?, end_date = ?, notes = ?, updated_at = ? WHERE id = ?",
      [
        trainerId,
        startDate,
        endDate,
        input.notes === undefined ? plan.notes : input.notes?.trim().slice(0, 500) || null,
        nowStamp(),
        planId,
      ],
    );
    recordAudit(db, actor, "TRAINING_PLAN_UPDATED", "training_plan", planId, {
      trainerId,
      startDate,
      endDate,
    });
  });
  return toPlan(getPlanRow(db, planId)!);
}

async function transitionPlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
  target: Extract<TrainingPlanStatus, "ended" | "cancelled">,
): Promise<PublicTrainingPlan> {
  requirePermission(actor, "training.manage");
  const plan = getPlanRow(db, planId);
  if (!plan) throw errNotFound("errors.trainingPlanNotFound");
  if (plan.status !== "active") throw errValidation("errors.trainingPlanNotEditable");

  const today = todayKey();
  const endDate = target === "ended" && today > plan.end_date ? today : plan.end_date;
  await db.transaction(async () => {
    db.run("UPDATE training_plans SET status = ?, end_date = ?, updated_at = ? WHERE id = ?", [
      target,
      endDate,
      nowStamp(),
      planId,
    ]);
    recordAudit(db, actor, target === "ended" ? "TRAINING_PLAN_ENDED" : "TRAINING_PLAN_CANCELLED", "training_plan", planId, {});
  });
  return toPlan(getPlanRow(db, planId)!);
}

export function endTrainingPlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
): Promise<PublicTrainingPlan> {
  const tp = db.first<{ member_id: string }>(
    "SELECT member_id FROM training_plans WHERE id = ?",
    [planId],
  );
  if (tp) assertDepartmentAccess(actor, memberDepartmentById(db, tp.member_id));
  return transitionPlan(db, actor, planId, "ended");
}

export function cancelTrainingPlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
): Promise<PublicTrainingPlan> {
  const tp = db.first<{ member_id: string }>(
    "SELECT member_id FROM training_plans WHERE id = ?",
    [planId],
  );
  if (tp) assertDepartmentAccess(actor, memberDepartmentById(db, tp.member_id));
  return transitionPlan(db, actor, planId, "cancelled");
}

export function reactivateTrainingPlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
): PublicTrainingPlan {
  requirePermission(actor, "training.manage");
  const plan = getPlanRow(db, planId);
  if (!plan) throw errNotFound("errors.trainingPlanNotFound");
  if (plan.status === "active") throw errValidation("errors.trainingPlanNotEditable");
  const tp = db.first<{ member_id: string }>(
    "SELECT member_id FROM training_plans WHERE id = ?",
    [planId],
  );
  if (tp) assertDepartmentAccess(actor, memberDepartmentById(db, tp.member_id));

  const today = todayKey();
  if (plan.end_date < today) throw errValidation("errors.trainingPlanNotEditable");
  db.transaction(() => {
    db.run("UPDATE training_plans SET status = 'active', updated_at = ? WHERE id = ?", [nowStamp(), planId]);
    recordAudit(db, actor, "TRAINING_PLAN_REACTIVATED", "training_plan", planId, {});
  });
  return toPlan(getPlanRow(db, planId)!);
}

export interface PlanWithNames extends PublicTrainingPlan {
  memberCode: string;
  memberName: string;
  trainerName: string;
}

interface PlanJoinRow extends TrainingPlanRow {
  member_code: string;
  full_name: string;
  trainer_name: string;
}

function toPlanWithNames(row: PlanJoinRow): PlanWithNames {
  return {
    ...toPlan(row),
    memberCode: row.member_code,
    memberName: row.full_name,
    trainerName: row.trainer_name,
  };
}

const PLAN_JOIN =
  "SELECT tp.*, m.member_code AS member_code, m.full_name AS full_name, t.full_name AS trainer_name\nFROM training_plans tp\nJOIN members m ON m.id = tp.member_id\nJOIN trainers t ON t.id = tp.trainer_id";

export interface TrainingPlanListQuery {
  memberId?: string;
  trainerId?: string;
  status?: TrainingPlanStatus | "all";
  limit?: number;
}

export function listTrainingPlans(
  db: Db,
  actor: ServiceActor,
  query: TrainingPlanListQuery = {},
): { items: PlanWithNames[]; total: number } {
  requirePermission(actor, "members.view");
  const conditions: string[] = [];
  const params: Array<string> = [];
  if (query.memberId) {
    conditions.push("tp.member_id = ?");
    params.push(query.memberId);
  }
  if (query.trainerId) {
    conditions.push("tp.trainer_id = ?");
    params.push(query.trainerId);
  }
  if (query.status && query.status !== "all") {
    conditions.push("tp.status = ?");
    params.push(query.status);
  }
  // department scope via EXISTS so the COUNT(*) query (no members join) stays valid
  const scope = departmentScopeCondition(actor, "m2");
  if (scope.sql) {
    const pred = scope.sql.replace(/^ AND /, "");
    conditions.push(`EXISTS (SELECT 1 FROM members m2 WHERE m2.id = tp.member_id AND ${pred})`);
    params.push(...scope.params);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const countSql = `SELECT COUNT(*) AS cnt FROM training_plans tp ${where}`;
  const total = Number(db.scalar(countSql, params) ?? 0);
  const items = db
    .all<PlanJoinRow>(`${PLAN_JOIN} ${where} ORDER BY tp.created_at DESC LIMIT ?`, [...params, String(limit)])
    .map(toPlanWithNames);
  return { items, total };
}

/** Auto-close plans whose end date has passed (idempotent maintenance task). */
export function sweepExpiredPlans(db: Db, actor: ServiceActor): number {
  requirePermission(actor, "training.manage");
  const today = todayKey();
  const pending = db.count(
    "SELECT COUNT(*) FROM training_plans WHERE status = 'active' AND end_date < ?",
    [addDaysKey(today, -1)],
  );
  if (pending === 0) return 0;
  db.run(
    "UPDATE training_plans SET status = 'ended', updated_at = ? WHERE status = 'active' AND end_date < ?",
    [nowStamp(), addDaysKey(today, -1)],
  );
  return pending;
}
