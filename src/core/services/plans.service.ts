import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { nowStamp } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import {
  type ClassScheduleSlot,
  parseScheduleSlots,
  syncAcademyClassForPlan,
} from "./classes.service";

export type PlanCategory = "gym" | "academy";

export interface PlanRow extends Row {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string | null;
  color: string | null;
  kind: PlanKind;
  category: string | null;
  sessions_count: number | null;
  invitations_count: number | null;
  allowed_days: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type PlanKind = "time" | "sessions" | "open";

export interface Plan {
  id: string;
  name: string;
  durationDays: number;
  price: number;
  description: string | null;
  color: string | null;
  kind: PlanKind;
  category: PlanCategory;
  sessionsCount: number | null;
  invitationsCount: number;
  allowedDays?: number[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  trainerId?: string | null;
  trainerName?: string | null;
  capacity?: number;
  scheduleSlots?: ClassScheduleSlot[];
  classId?: string | null;
}

export interface PlanInput {
  name: string;
  durationDays: number;
  price: number;
  description?: string | null;
  color?: string | null;
  kind?: PlanKind;
  category?: PlanCategory;
  sessionsCount?: number | null;
  invitationsCount?: number;
  allowedDays?: number[] | null;
  trainerId?: string | null;
  capacity?: number;
  scheduleSlots?: ClassScheduleSlot[];
}

function normalizeKind(kind: PlanKind | undefined): PlanKind {
  return kind ?? "time";
}

function toPlan(row: PlanRow & Record<string, unknown>): Plan {
  return {
    id: row.id,
    name: row.name,
    durationDays: Number(row.duration_days),
    price: Number(row.price),
    description: row.description,
    color: row.color,
    kind: (row.kind ?? "time") as PlanKind,
    category: (row.category === "academy" ? "academy" : "gym") as PlanCategory,
    sessionsCount: row.sessions_count == null ? null : Number(row.sessions_count),
    invitationsCount: Math.max(0, Number(row.invitations_count || 0)),
    allowedDays: row.allowed_days ? JSON.parse(row.allowed_days) : null,
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trainerId: row.trainer_id ? String(row.trainer_id) : null,
    trainerName: row.trainer_name ? String(row.trainer_name) : null,
    capacity: row.academy_capacity != null ? Number(row.academy_capacity) : (row.capacity != null ? Number(row.capacity) : undefined),
    scheduleSlots: parseScheduleSlots(row.schedule_json),
    classId: row.class_id ? String(row.class_id) : null,
  };
}

const PLAN_SELECT_JOIN = `
  SELECT 
    p.*,
    c.id AS class_id,
    c.trainer_id,
    c.capacity AS academy_capacity,
    c.schedule_json,
    t.full_name AS trainer_name
  FROM membership_plans p
  LEFT JOIN classes c ON c.plan_id = p.id
  LEFT JOIN trainers t ON t.id = c.trainer_id
`;

export function getPlanRow(db: Db, planId: string): (PlanRow & Record<string, unknown>) | null {
  return db.first<PlanRow & Record<string, unknown>>(`${PLAN_SELECT_JOIN} WHERE p.id = ?`, [planId]);
}

export function getPlan(db: Db, actor: ServiceActor, planId: string): Plan | null {
  requirePermission(actor, "plans.view");
  const row = getPlanRow(db, planId);
  return row ? toPlan(row) : null;
}

export function listPlans(
  db: Db,
  actor: ServiceActor,
  includeInactive = false,
  category?: PlanCategory | "all",
): Plan[] {
  requirePermission(actor, "plans.view");
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (!includeInactive) {
    conditions.push("p.is_active = 1");
  }
  if (category && category !== "all") {
    conditions.push("p.category = ?");
    params.push(category);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<PlanRow & Record<string, unknown>>(
      `${PLAN_SELECT_JOIN} ${where} ORDER BY p.duration_days ASC`,
      params,
    )
    .map(toPlan);
}

export async function createPlan(
  db: Db,
  actor: ServiceActor,
  input: PlanInput,
): Promise<Plan> {
  requirePermission(actor, "plans.create");
  const name = input.name.trim();
  if (name === "") throw errValidation("errors.planNameRequired");
  if (!Number.isFinite(input.durationDays) || input.durationDays <= 0) {
    throw errValidation("errors.planDurationInvalid");
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw errValidation("errors.planPriceInvalid");
  }
  const kind = normalizeKind(input.kind);
  let sessionsCount: number | null = null;
  if (kind === "sessions") {
    if (!Number.isInteger(input.sessionsCount) || (input.sessionsCount ?? 0) <= 0) {
      throw errValidation("errors.planSessionsInvalid");
    }
    sessionsCount = input.sessionsCount as number;
  }
  if (db.first("SELECT id FROM membership_plans WHERE name = ?", [name])) {
    throw errConflict("errors.planNameTaken", { name });
  }

  const allowedDaysJson =
    input.allowedDays && Array.isArray(input.allowedDays) && input.allowedDays.length > 0
      ? JSON.stringify(input.allowedDays)
      : null;

  const category: PlanCategory = input.category === "academy" ? "academy" : "gym";
  const id = crypto.randomUUID();
  const invitationsCount = Math.max(0, Math.round(input.invitationsCount ?? 0));
  await db.transaction(async () => {
    db.run(
      "INSERT INTO membership_plans (id, name, duration_days, price, description, color, kind, category, sessions_count, invitations_count, allowed_days, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      [
        id,
        name,
        Math.round(input.durationDays),
        input.price,
        input.description?.trim() || null,
        input.color?.trim() || null,
        kind,
        category,
        sessionsCount,
        invitationsCount,
        allowedDaysJson,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "PLAN_CREATED", "plan", id, {
      name,
      durationDays: input.durationDays,
      kind,
      category,
      sessionsCount,
      invitationsCount,
    });
    if (category === "academy") {
      syncAcademyClassForPlan(
        db,
        actor,
        id,
        name,
        input.trainerId,
        input.capacity,
        input.scheduleSlots,
      );
    }
  });

  const row = getPlanRow(db, id);
  if (!row) throw new Error("plan vanished after insert");
  return toPlan(row);
}

export interface PlanPatch {
  name?: string;
  durationDays?: number;
  price?: number;
  description?: string | null;
  color?: string | null;
  isActive?: boolean;
  kind?: PlanKind;
  category?: PlanCategory;
  sessionsCount?: number | null;
  invitationsCount?: number;
  allowedDays?: number[] | null;
  trainerId?: string | null;
  capacity?: number;
  scheduleSlots?: ClassScheduleSlot[];
}

export async function updatePlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
  patch: PlanPatch,
): Promise<Plan> {
  requirePermission(actor, "plans.edit");
  const row = getPlanRow(db, planId);
  if (!row) throw errNotFound("errors.planNotFound");

  const name = patch.name !== undefined ? patch.name.trim() : row.name;
  if (name === "") throw errValidation("errors.planNameRequired");
  const nameOwner = db.first<{ id: string }>(
    "SELECT id FROM membership_plans WHERE name = ? AND id != ?",
    [name, planId],
  );
  if (nameOwner) throw errConflict("errors.planNameTaken", { name });

  const durationDays =
    patch.durationDays !== undefined ? Math.round(patch.durationDays) : Number(row.duration_days);
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw errValidation("errors.planDurationInvalid");
  }
  const price = patch.price !== undefined ? patch.price : Number(row.price);
  if (!Number.isFinite(price) || price < 0) throw errValidation("errors.planPriceInvalid");
  const description =
    patch.description !== undefined ? patch.description?.trim() || null : row.description;
  const color = patch.color !== undefined ? patch.color?.trim() || null : row.color;
  const isActive =
    patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : Number(row.is_active);
  const kind = patch.kind !== undefined ? patch.kind : ((row.kind ?? "time") as PlanKind);
  const category: PlanCategory =
    patch.category !== undefined
      ? patch.category
      : ((row.category === "academy" ? "academy" : "gym") as PlanCategory);
  let sessionsCount: number | null =
    patch.sessionsCount !== undefined
      ? patch.sessionsCount
      : row.sessions_count == null
        ? null
        : Number(row.sessions_count);
  if (kind === "sessions") {
    if (!Number.isInteger(sessionsCount) || (sessionsCount ?? 0) <= 0) {
      throw errValidation("errors.planSessionsInvalid");
    }
    sessionsCount = sessionsCount as number;
  } else {
    sessionsCount = null;
  }

  const invitationsCount =
    patch.invitationsCount !== undefined
      ? Math.max(0, Math.round(patch.invitationsCount))
      : Math.max(0, Number(row.invitations_count || 0));

  const allowedDays =
    patch.allowedDays !== undefined
      ? patch.allowedDays && patch.allowedDays.length > 0
        ? JSON.stringify(patch.allowedDays)
        : null
      : (row.allowed_days ?? null);

  await db.transaction(async () => {
    db.run(
      "UPDATE membership_plans SET name = ?, duration_days = ?, price = ?, description = ?, color = ?, kind = ?, category = ?, sessions_count = ?, invitations_count = ?, allowed_days = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [name, durationDays, price, description, color, kind, category, sessionsCount, invitationsCount, allowedDays, isActive, nowStamp(), planId],
    );
    if (category === "academy") {
      const currentTrainerId = patch.trainerId !== undefined ? patch.trainerId : (row.trainer_id ? String(row.trainer_id) : null);
      const currentCapacity = patch.capacity !== undefined ? patch.capacity : (row.academy_capacity != null ? Number(row.academy_capacity) : 15);
      const currentSlots = patch.scheduleSlots !== undefined ? patch.scheduleSlots : parseScheduleSlots(row.schedule_json);
      syncAcademyClassForPlan(
        db,
        actor,
        planId,
        name,
        currentTrainerId,
        currentCapacity,
        currentSlots,
      );
    }
    recordAudit(db, actor, "PLAN_UPDATED", "plan", planId, { name, category, invitationsCount });
  });

  const fresh = getPlanRow(db, planId);
  if (!fresh) throw errNotFound("errors.planNotFound");
  return toPlan(fresh);
}

export async function deletePlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
): Promise<{ success: boolean; softDeactivated?: boolean }> {
  requirePermission(actor, "plans.edit");
  const plan = getPlanRow(db, planId);
  if (!plan) throw errNotFound("errors.planNotFound");

  const subscriptionsCount = db.count(
    "SELECT COUNT(*) FROM member_subscriptions WHERE plan_id = ?",
    [planId],
  );

  if (subscriptionsCount > 0) {
    // If subscriptions exist, deactivate it instead of breaking foreign keys
    await db.transaction(async () => {
      db.run("UPDATE membership_plans SET is_active = 0, updated_at = ? WHERE id = ?", [
        nowStamp(),
        planId,
      ]);
      recordAudit(db, actor, "PLAN_DEACTIVATED", "plan", planId, {
        name: plan.name,
        reason: "has_subscriptions",
        subscriptionsCount,
      });
    });
    return { success: true, softDeactivated: true };
  }

  await db.transaction(async () => {
    // Also remove any package referencing this as synthetic_plan_id if unreferenced
    db.run("DELETE FROM packages WHERE synthetic_plan_id = ?", [planId]);
    db.run("DELETE FROM membership_plans WHERE id = ?", [planId]);
    recordAudit(db, actor, "PLAN_DELETED", "plan", planId, { name: plan.name });
  });

  return { success: true, softDeactivated: false };
}

