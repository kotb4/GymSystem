import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { nowStamp } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";

export interface PlanRow extends Row {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string | null;
  color: string | null;
  kind: PlanKind;
  sessions_count: number | null;
  invitations_count: number | null;
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
  sessionsCount: number | null;
  invitationsCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlanInput {
  name: string;
  durationDays: number;
  price: number;
  description?: string | null;
  color?: string | null;
  kind?: PlanKind;
  sessionsCount?: number | null;
  invitationsCount?: number;
}

function normalizeKind(kind: PlanKind | undefined): PlanKind {
  return kind ?? "time";
}

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    durationDays: Number(row.duration_days),
    price: Number(row.price),
    description: row.description,
    color: row.color,
    kind: (row.kind ?? "time") as PlanKind,
    sessionsCount: row.sessions_count == null ? null : Number(row.sessions_count),
    invitationsCount: Math.max(0, Number(row.invitations_count || 0)),
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPlanRow(db: Db, planId: string): PlanRow | null {
  return db.first<PlanRow>("SELECT * FROM membership_plans WHERE id = ?", [planId]);
}

export function listPlans(
  db: Db,
  actor: ServiceActor,
  includeInactive = false,
): Plan[] {
  requirePermission(actor, "plans.view");
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return db
    .all<PlanRow>(
      `SELECT * FROM membership_plans ${where} ORDER BY duration_days ASC`,
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

  const id = crypto.randomUUID();
  const invitationsCount = Math.max(0, Math.round(input.invitationsCount ?? 0));
  await db.transaction(async () => {
    db.run(
      "INSERT INTO membership_plans (id, name, duration_days, price, description, color, kind, sessions_count, invitations_count, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      [
        id,
        name,
        Math.round(input.durationDays),
        input.price,
        input.description?.trim() || null,
        input.color?.trim() || null,
        kind,
        sessionsCount,
        invitationsCount,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "PLAN_CREATED", "plan", id, {
      name,
      durationDays: input.durationDays,
      kind,
      sessionsCount,
      invitationsCount,
    });
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
  sessionsCount?: number | null;
  invitationsCount?: number;
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

  await db.transaction(async () => {
    db.run(
      "UPDATE membership_plans SET name = ?, duration_days = ?, price = ?, description = ?, color = ?, kind = ?, sessions_count = ?, invitations_count = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [name, durationDays, price, description, color, kind, sessionsCount, invitationsCount, isActive, nowStamp(), planId],
    );
    recordAudit(db, actor, "PLAN_UPDATED", "plan", planId, { name, invitationsCount });
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

