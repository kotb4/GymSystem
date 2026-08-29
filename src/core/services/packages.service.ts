import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { nowStamp, todayKey } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";

export type PackageModel = "time" | "visit" | "hybrid";

/** Access areas mirror member departments. */
export const ACCESS_AREAS = ["general", "men", "women"] as const;
export type AccessArea = (typeof ACCESS_AREAS)[number];

export interface PackageRow extends Row {
  id: string;
  name: string;
  model: PackageModel;
  duration_days: number;
  price: number;
  visit_limit: number | null;
  unlimited_visits: number;
  freeze_allowance_days: number;
  allowed_freezes: number;
  pt_sessions: number;
  allowed_areas: string | null;
  description: string | null;
  is_active: number;
  synthetic_plan_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Package {
  id: string;
  name: string;
  model: PackageModel;
  durationDays: number;
  price: number;
  visitLimit: number | null;
  unlimitedVisits: boolean;
  freezeAllowanceDays: number;
  allowedFreezes: number;
  ptSessions: number;
  allowedAreas: AccessArea[];
  description: string | null;
  isActive: boolean;
  syntheticPlanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PackageInput {
  name: string;
  model: PackageModel;
  durationDays: number;
  price: number;
  visitLimit?: number | null;
  unlimitedVisits?: boolean;
  freezeAllowanceDays?: number;
  allowedFreezes?: number;
  ptSessions?: number;
  allowedAreas?: AccessArea[];
  description?: string | null;
}

export interface PackagePatch {
  name?: string;
  model?: PackageModel;
  durationDays?: number;
  price?: number;
  visitLimit?: number | null;
  unlimitedVisits?: boolean;
  freezeAllowanceDays?: number;
  allowedFreezes?: number;
  ptSessions?: number;
  allowedAreas?: AccessArea[];
  description?: string | null;
  isActive?: boolean;
}

function parseAreas(raw: string | null): AccessArea[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AccessArea => (ACCESS_AREAS as readonly string[]).includes(s));
}

function toPackage(row: PackageRow): Package {
  return {
    id: row.id,
    name: row.name,
    model: (row.model ?? "time") as PackageModel,
    durationDays: Number(row.duration_days),
    price: Number(row.price),
    visitLimit: row.visit_limit == null ? null : Number(row.visit_limit),
    unlimitedVisits: Number(row.unlimited_visits) === 1,
    freezeAllowanceDays: Number(row.freeze_allowance_days ?? 0),
    allowedFreezes: Number(row.allowed_freezes ?? 0),
    ptSessions: Number(row.pt_sessions ?? 0),
    allowedAreas: parseAreas(row.allowed_areas),
    description: row.description,
    isActive: Number(row.is_active) === 1,
    syntheticPlanId: row.synthetic_plan_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPackageRow(db: Db, packageId: string): PackageRow | null {
  return db.first<PackageRow>("SELECT * FROM packages WHERE id = ?", [packageId]);
}

function getPackageById(db: Db, packageId: string): Package {
  const row = getPackageRow(db, packageId);
  if (!row) throw errNotFound("errors.packageNotFound");
  return toPackage(row);
}

export function listPackages(db: Db, actor: ServiceActor, includeInactive = false): Package[] {
  requirePermission(actor, "packages.view");
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return db
    .all<PackageRow>(`SELECT * FROM packages ${where} ORDER BY duration_days ASC, name COLLATE NOCASE`)
    .map(toPackage);
}

/**
 * Legacy plan token that lets all existing JOINs (check-in, reports, payments,
 * CRM) keep working for a package subscription.
 *   time   → kind 'time'   (authorized purely by the date window)
 *   visit  → kind 'sessions' (authorized while visits remain AND in window)
 *   hybrid → kind 'sessions' (BOTH time window AND visits remaining required)
 *   visit/hybrid + unlimitedVisits → kind 'time' (date window only; no session bucket)
 */
function modelToPlanKind(model: PackageModel): "time" | "sessions" {
  return model === "time" ? "time" : "sessions";
}

/** Unlimited visit/hybrid packages authorize by date window only (no session bucket). */
function syntheticKind(model: PackageModel, unlimitedVisits: boolean): "time" | "sessions" {
  return unlimitedVisits ? "time" : modelToPlanKind(model);
}

interface PlanSync {
  planId: string;
  name: string;
  durationDays: number;
  price: number;
  kind: "time" | "sessions";
  sessionsCount: number | null;
  isActive: number;
}

/** Build the synthetic membership_plans row values from a package's config. */
function planSyncFor(input: {
  name: string;
  model: PackageModel;
  durationDays: number;
  price: number;
  unlimitedVisits: boolean;
  visitLimit: number | null;
  isActive: number;
}): PlanSync {
  const kind = syntheticKind(input.model, input.unlimitedVisits);
  const sessionsCount = kind === "sessions" ? input.visitLimit ?? null : null;
  return {
    planId: crypto.randomUUID(),
    name: input.name,
    durationDays: input.durationDays,
    price: input.price,
    kind,
    sessionsCount,
    isActive: input.isActive,
  };
}

function insertSyntheticPlan(db: Db, sync: PlanSync): void {
  db.run(
    "INSERT INTO membership_plans (id, name, duration_days, price, description, color, kind, sessions_count, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)",
    [
      sync.planId,
      sync.name,
      sync.durationDays,
      sync.price,
      sync.kind,
      sync.sessionsCount,
      sync.isActive,
      nowStamp(),
      nowStamp(),
    ],
  );
}

function updateSyntheticPlan(db: Db, planId: string, sync: PlanSync): void {
  db.run(
    "UPDATE membership_plans SET name = ?, duration_days = ?, price = ?, kind = ?, sessions_count = ?, is_active = ?, updated_at = ? WHERE id = ?",
    [
      sync.name,
      sync.durationDays,
      sync.price,
      sync.kind,
      sync.sessionsCount,
      sync.isActive,
      nowStamp(),
      planId,
    ],
  );
}

interface NormalizedPackage {
  name: string;
  model: PackageModel;
  durationDays: number;
  price: number;
  visitLimit: number | null;
  unlimitedVisits: boolean;
  freezeAllowanceDays: number;
  allowedFreezes: number;
  ptSessions: number;
  allowedAreas: AccessArea[];
  description: string | null;
}

function normalizePackageInput(input: {
  name: string;
  model: PackageModel;
  durationDays: number;
  price: number;
  visitLimit?: number | null;
  unlimitedVisits?: boolean;
  freezeAllowanceDays?: number;
  allowedFreezes?: number;
  ptSessions?: number;
  allowedAreas?: AccessArea[];
  description?: string | null;
}): NormalizedPackage {
  const name = input.name.trim();
  if (name === "") throw errValidation("errors.packageNameRequired");

  const model = input.model;
  if (model !== "time" && model !== "visit" && model !== "hybrid") {
    throw errValidation("errors.packageModelInvalid");
  }

  if (!Number.isFinite(input.durationDays) || Number.isInteger(input.durationDays) !== true || input.durationDays <= 0) {
    throw errValidation("errors.packageDurationInvalid");
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw errValidation("errors.packagePriceInvalid");
  }

  const unlimitedVisits = Boolean(input.unlimitedVisits);

  let visitLimit: number | null = null;
  if (model === "visit" || model === "hybrid") {
    if (!unlimitedVisits) {
      if (!Number.isInteger(input.visitLimit) || (input.visitLimit ?? 0) <= 0) {
        throw errValidation("errors.packageVisitLimitInvalid");
      }
      visitLimit = input.visitLimit as number;
    }
  } else if (input.visitLimit != null && !unlimitedVisits) {
    throw errValidation("errors.packageVisitLimitInvalid");
  }

  const freezeAllowanceDays = Number.isFinite(input.freezeAllowanceDays) ? Number(input.freezeAllowanceDays) : 0;
  if (!Number.isInteger(freezeAllowanceDays) || freezeAllowanceDays < 0) {
    throw errValidation("errors.packageFreezeInvalid");
  }
  const allowedFreezes = Number.isFinite(input.allowedFreezes) ? Number(input.allowedFreezes) : 0;
  if (!Number.isInteger(allowedFreezes) || allowedFreezes < 0) {
    throw errValidation("errors.packageFreezeInvalid");
  }
  if (freezeAllowanceDays === 0 && allowedFreezes > 0) {
    throw errValidation("errors.packageFreezeInvalid");
  }

  const ptSessions = Number.isFinite(input.ptSessions) ? Number(input.ptSessions) : 0;
  if (!Number.isInteger(ptSessions) || ptSessions < 0) {
    throw errValidation("errors.packagePtsInvalid");
  }

  const allowedAreas = input.allowedAreas ?? [];
  for (const area of allowedAreas) {
    if (!(ACCESS_AREAS as readonly string[]).includes(area)) {
      throw errValidation("errors.packageAreaInvalid");
    }
  }

  return {
    name,
    model,
    durationDays: input.durationDays,
    price: input.price,
    visitLimit,
    unlimitedVisits,
    freezeAllowanceDays,
    allowedFreezes,
    ptSessions,
    allowedAreas,
    description: input.description?.trim() || null,
  };
}

function assertUniqueName(db: Db, name: string, excludeId?: string): void {
  const row = db.first<{ id: string }>(
    excludeId
      ? "SELECT id FROM packages WHERE name = ? AND id != ?"
      : "SELECT id FROM packages WHERE name = ?",
    excludeId ? [name, excludeId] : [name],
  );
  if (row) throw errConflict("errors.packageNameTaken", { name });
}

export async function createPackage(
  db: Db,
  actor: ServiceActor,
  input: PackageInput,
): Promise<Package> {
  requirePermission(actor, "packages.create");
  const norm = normalizePackageInput(input);
  assertUniqueName(db, norm.name);

  const id = crypto.randomUUID();
  const planSync = planSyncFor({
    name: norm.name,
    model: norm.model,
    durationDays: norm.durationDays,
    price: norm.price,
    unlimitedVisits: norm.unlimitedVisits,
    visitLimit: norm.visitLimit,
    isActive: 1,
  });

  await db.transaction(async () => {
    insertSyntheticPlan(db, planSync);
    db.run(
      "INSERT INTO packages (id, name, model, duration_days, price, visit_limit, unlimited_visits, freeze_allowance_days, allowed_freezes, pt_sessions, allowed_areas, description, is_active, synthetic_plan_id, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      [
        id,
        norm.name,
        norm.model,
        norm.durationDays,
        norm.price,
        norm.visitLimit,
        norm.unlimitedVisits ? 1 : 0,
        norm.freezeAllowanceDays,
        norm.allowedFreezes,
        norm.ptSessions,
        norm.allowedAreas.length ? norm.allowedAreas.join(",") : null,
        norm.description,
        planSync.planId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "PACKAGE_CREATED", "package", id, {
      name: norm.name,
      model: norm.model,
      durationDays: norm.durationDays,
    });
  });

  return getPackageById(db, id);
}

export async function updatePackage(
  db: Db,
  actor: ServiceActor,
  packageId: string,
  patch: PackagePatch,
): Promise<Package> {
  requirePermission(actor, "packages.edit");
  const row = getPackageRow(db, packageId);
  if (!row) throw errNotFound("errors.packageNotFound");

  const merged: {
    name: string;
    model: PackageModel;
    durationDays: number;
    price: number;
    visitLimit?: number | null;
    unlimitedVisits?: boolean;
    freezeAllowanceDays?: number;
    allowedFreezes?: number;
    ptSessions?: number;
    allowedAreas?: AccessArea[];
    description?: string | null;
  } = {
    name: patch.name !== undefined ? patch.name : row.name,
    model:
      patch.model !== undefined
        ? patch.model
        : ((row.model ?? "time") as PackageModel),
    durationDays:
      patch.durationDays !== undefined ? patch.durationDays : Number(row.duration_days),
    price: patch.price !== undefined ? patch.price : Number(row.price),
    visitLimit:
      patch.visitLimit !== undefined ? patch.visitLimit : row.visit_limit == null ? null : Number(row.visit_limit),
    unlimitedVisits:
      patch.unlimitedVisits !== undefined ? patch.unlimitedVisits : Number(row.unlimited_visits) === 1,
    freezeAllowanceDays:
      patch.freezeAllowanceDays !== undefined
        ? patch.freezeAllowanceDays
        : Number(row.freeze_allowance_days ?? 0),
    allowedFreezes:
      patch.allowedFreezes !== undefined ? patch.allowedFreezes : Number(row.allowed_freezes ?? 0),
    ptSessions: patch.ptSessions !== undefined ? patch.ptSessions : Number(row.pt_sessions ?? 0),
    allowedAreas:
      patch.allowedAreas !== undefined ? patch.allowedAreas : parseAreas(row.allowed_areas),
    description: patch.description !== undefined ? patch.description : row.description,
  };

  const norm = normalizePackageInput(merged);
  assertUniqueName(db, norm.name, packageId);

  const isActive =
    patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : Number(row.is_active);

  await db.transaction(async () => {
    db.run(
      "UPDATE packages SET name = ?, model = ?, duration_days = ?, price = ?, visit_limit = ?, unlimited_visits = ?, freeze_allowance_days = ?, allowed_freezes = ?, pt_sessions = ?, allowed_areas = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [
        norm.name,
        norm.model,
        norm.durationDays,
        norm.price,
        norm.visitLimit,
        norm.unlimitedVisits ? 1 : 0,
        norm.freezeAllowanceDays,
        norm.allowedFreezes,
        norm.ptSessions,
        norm.allowedAreas.length ? norm.allowedAreas.join(",") : null,
        norm.description,
        isActive,
        nowStamp(),
        packageId,
      ],
    );
    const planId = row.synthetic_plan_id;
    if (planId) {
      updateSyntheticPlan(db, planId, {
        planId,
        name: norm.name,
        durationDays: norm.durationDays,
        price: norm.price,
        kind: syntheticKind(norm.model, norm.unlimitedVisits),
        sessionsCount:
          syntheticKind(norm.model, norm.unlimitedVisits) === "sessions" ? norm.visitLimit : null,
        isActive,
      });
    }
    recordAudit(db, actor, "PACKAGE_UPDATED", "package", packageId, {
      name: norm.name,
      model: norm.model,
    });
  });

  return getPackageById(db, packageId);
}

export async function setPackageActive(
  db: Db,
  actor: ServiceActor,
  packageId: string,
  isActive: boolean,
): Promise<Package> {
  requirePermission(actor, "packages.edit");
  const row = getPackageRow(db, packageId);
  if (!row) throw errNotFound("errors.packageNotFound");
  const active = isActive ? 1 : 0;
  await db.transaction(async () => {
    db.run("UPDATE packages SET is_active = ?, updated_at = ? WHERE id = ?", [active, nowStamp(), packageId]);
    if (row.synthetic_plan_id) {
      db.run("UPDATE membership_plans SET is_active = ?, updated_at = ? WHERE id = ?", [active, nowStamp(), row.synthetic_plan_id]);
    }
    recordAudit(db, actor, "PACKAGE_TOGGLED", "package", packageId, { isActive: active });
  });
  return getPackageById(db, packageId);
}

export async function duplicatePackage(
  db: Db,
  actor: ServiceActor,
  sourcePackageId: string,
): Promise<Package> {
  requirePermission(actor, "packages.create");
  const src = getPackageRow(db, sourcePackageId);
  if (!src) throw errNotFound("errors.packageNotFound");

  const baseName = `${src.name} (نسخة)`;
  const used = db.count("SELECT COUNT(*) FROM packages WHERE name = ?", [baseName]);
  const name = used > 0 ? `${baseName} ${used + 1}` : baseName;

  const norm = normalizePackageInput({
    name,
    model: (src.model ?? "time") as PackageModel,
    durationDays: Number(src.duration_days),
    price: Number(src.price),
    visitLimit: src.visit_limit == null ? null : Number(src.visit_limit),
    unlimitedVisits: Number(src.unlimited_visits) === 1,
    freezeAllowanceDays: Number(src.freeze_allowance_days ?? 0),
    allowedFreezes: Number(src.allowed_freezes ?? 0),
    ptSessions: Number(src.pt_sessions ?? 0),
    allowedAreas: parseAreas(src.allowed_areas),
    description: src.description,
  });

  const id = crypto.randomUUID();
  const planSync = planSyncFor({
    name: norm.name,
    model: norm.model,
    durationDays: norm.durationDays,
    price: norm.price,
    unlimitedVisits: norm.unlimitedVisits,
    visitLimit: norm.visitLimit,
    isActive: Number(src.is_active),
  });

  await db.transaction(async () => {
    insertSyntheticPlan(db, planSync);
    db.run(
      "INSERT INTO packages (id, name, model, duration_days, price, visit_limit, unlimited_visits, freeze_allowance_days, allowed_freezes, pt_sessions, allowed_areas, description, is_active, synthetic_plan_id, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        norm.name,
        norm.model,
        norm.durationDays,
        norm.price,
        norm.visitLimit,
        norm.unlimitedVisits ? 1 : 0,
        norm.freezeAllowanceDays,
        norm.allowedFreezes,
        norm.ptSessions,
        norm.allowedAreas.length ? norm.allowedAreas.join(",") : null,
        norm.description,
        Number(src.is_active),
        planSync.planId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "PACKAGE_DUPLICATED", "package", id, {
      source: sourcePackageId,
      name: norm.name,
    });
  });

  return getPackageById(db, id);
}

export interface PackageStat {
  packageId: string;
  packageName: string;
  model: PackageModel;
  isActive: boolean;
  totalSubscriptions: number;
  activeSubscriptions: number;
  revenueMinor: number;
}

export interface PackageStats {
  totalPackages: number;
  activePackages: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  byModel: Record<PackageModel, number>;
  perPackage: PackageStat[];
}

/** Aggregates package usage from live subscription snapshots (history-safe). */
export function packageStats(db: Db, actor: ServiceActor): PackageStats {
  requirePermission(actor, "packages.view");
  const today = todayKey();
  const rows = db.all<PackageRow>("SELECT * FROM packages ORDER BY name COLLATE NOCASE");

  const activeCond = "s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?";
  const todayParams = [today, today];

  const perPackage: PackageStat[] = rows.map((pkg) => {
    const totalSubscriptions = db.count(
      "SELECT COUNT(*) FROM member_subscriptions WHERE package_id = ?",
      [pkg.id],
    );
    const activeSubscriptions = db.count(
      `SELECT COUNT(*) FROM member_subscriptions s WHERE s.package_id = ? AND s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?`,
      [pkg.id, ...todayParams],
    );
    const revenueMinor = Number(
      db.scalar(
        "SELECT COALESCE(SUM(p.paid_amount_minor + p.discount_amount_minor), 0) FROM payments p JOIN member_subscriptions s ON s.id = p.subscription_id WHERE s.package_id = ? AND p.status IN ('partial', 'paid')",
        [pkg.id],
      ) ?? 0,
    );
    return {
      packageId: pkg.id,
      packageName: pkg.name,
      model: (pkg.model ?? "time") as PackageModel,
      isActive: Number(pkg.is_active) === 1,
      totalSubscriptions,
      activeSubscriptions,
      revenueMinor,
    };
  });

  const byModel: Record<PackageModel, number> = { time: 0, visit: 0, hybrid: 0 };
  for (const p of perPackage) byModel[p.model] += 1;

  const totalSubscriptions = db.count(
    "SELECT COUNT(*) FROM member_subscriptions WHERE package_id IS NOT NULL",
  );
  const activeSubscriptions = db.count(
    `SELECT COUNT(*) FROM member_subscriptions s WHERE s.package_id IS NOT NULL AND ${activeCond}`,
    todayParams,
  );

  return {
    totalPackages: rows.length,
    activePackages: rows.filter((r) => Number(r.is_active) === 1).length,
    totalSubscriptions,
    activeSubscriptions,
    byModel,
    perPackage,
  };
}

export function getPackage(db: Db, actor: ServiceActor, packageId: string): Package {
  requirePermission(actor, "packages.view");
  return getPackageById(db, packageId);
}
