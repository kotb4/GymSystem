import {
  addDaysKey,
  calcSubscriptionEndDate,
  diffDaysKeys,
  isValidDateKey,
  nowStamp,
  todayKey,
} from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById } from "./members.service";
import {
  assertDepartmentAccess,
  departmentScopeCondition,
  memberDepartmentById,
} from "./department";
import { getPlanRow } from "./plans.service";
import { getPackageRow, type PackageRow } from "./packages.service";
import { applyEarnRule } from "./loyalty.service";
import { insertLedgerEntry } from "./payments.service";

export type SubscriptionRowStatus = "active" | "suspended" | "cancelled";
export type EffectiveSubscriptionStatus = "active" | "upcoming" | "expired" | "suspended" | "cancelled" | "frozen";

export interface SubscriptionRow extends Row {
  id: string;
  member_id: string;
  plan_id: string;
  start_date: string;
  end_date: string;
  price: number;
  status: SubscriptionRowStatus;
  sessions_total: number | null;
  sessions_used: number;
  frozen_at: string | null;
  frozen_days: number;
  resume_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  package_id: string | null;
  package_name: string | null;
  package_model: "time" | "visit" | "hybrid" | null;
  package_duration_days: number | null;
  package_price: number | null;
  package_visit_limit: number | null;
  package_unlimited_visits: number;
  package_freeze_allowance_days: number;
  package_allowed_freezes: number;
  package_pt_sessions: number;
}

export type SubscriptionKind = "time" | "sessions" | "open";

export interface Subscription extends Row {
  id: string;
  memberId: string;
  planId: string;
  planName: string | null;
  startDate: string;
  endDate: string;
  price: number;
  status: SubscriptionRowStatus;
  effectiveStatus: EffectiveSubscriptionStatus;
  kind: SubscriptionKind;
  sessionsTotal: number | null;
  sessionsUsed: number;
  frozenAt: string | null;
  frozenDays: number;
  resumeDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateSubscriptionInput {
  memberId: string;
  planId: string;
  startDate?: string;
  price?: number;
  notes?: string | null;
  /** When set, the package's full config is snapshotted onto the new row. */
  packageId?: string;
}

export interface EffectiveStatusInput {
  status: SubscriptionRowStatus;
  startDate: string;
  endDate: string;
  frozenAt?: string | null;
}

export function effectiveStatus(
  input: EffectiveStatusInput,
  today: string,
): EffectiveSubscriptionStatus {
  if (input.status === "suspended") return input.frozenAt ? "frozen" : "suspended";
  if (input.status === "cancelled") return "cancelled";
  if (today < input.startDate) return "upcoming";
  if (today > input.endDate) return "expired";
  return "active";
}

function toSubscription(
  row: SubscriptionRow,
  planName: string | null,
  today: string,
  kind: SubscriptionKind = "time",
): Subscription {
  return {
    id: row.id,
    memberId: row.member_id,
    planId: row.plan_id,
    planName,
    startDate: row.start_date,
    endDate: row.end_date,
    price: Number(row.price),
    status: row.status,
    effectiveStatus: effectiveStatus(
      { status: row.status, startDate: row.start_date, endDate: row.end_date, frozenAt: row.frozen_at },
      today,
    ),
    kind,
    sessionsTotal: row.sessions_total == null ? null : Number(row.sessions_total),
    sessionsUsed: Number(row.sessions_used ?? 0),
    frozenAt: row.frozen_at ?? null,
    frozenDays: Number(row.frozen_days ?? 0),
    resumeDate: row.resume_date ?? null,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function withPlanInfo(db: Db, row: SubscriptionRow, today: string): Subscription {
  const info = planNameFor(db, row.plan_id);
  return toSubscription(row, info?.name ?? null, today, info?.kind ?? "time");
}

function planNameFor(db: Db, planId: string): { name: string; kind: SubscriptionKind } | null {
  const row = db.first<{ name: string; kind: string | null }>(
    "SELECT name, kind FROM membership_plans WHERE id = ?",
    [planId],
  );
  return row ? { name: row.name, kind: (row.kind ?? "time") as SubscriptionKind } : null;
}

function getSubscriptionRow(db: Db, subscriptionId: string): SubscriptionRow | null {
return db.first<SubscriptionRow>(
"SELECT * FROM member_subscriptions WHERE id = ?",
[subscriptionId],
);
}

/** Department IDOR guard for anything hanging off a subscription. */
function assertSubMemberAccess(db: Db, actor: ServiceActor, memberId: string): void {
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
}

function findOverlap(
  db: Db,
  memberId: string,
  startDate: string,
  endDate: string,
  excludeId?: string,
): SubscriptionRow | null {
  const exclusion = excludeId ? "AND id != ?" : "";
  const params: Array<string> = [memberId, startDate, endDate];
  if (excludeId) params.push(excludeId);
  return db.first<SubscriptionRow>(
    `SELECT * FROM member_subscriptions\nWHERE member_id = ? AND status = 'active' AND NOT (end_date < ? OR start_date > ?) ${exclusion}\nORDER BY end_date DESC`,
    params,
  );
}

export async function createSubscription(
  db: Db,
  actor: ServiceActor,
  input: CreateSubscriptionInput,
): Promise<Subscription> {
  requirePermission(actor, "subscriptions.create");
  const member = getMemberRowById(db, input.memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  if (member.status === "archived") throw errConflict("errors.memberArchived");
  assertDepartmentAccess(actor, member.department);

  // Resolve an optional package; a package subscription uses the package's
  // synthetic membership_plans row as its legacy plan token so every existing
  // JOIN keeps working, while the full package config is snapshotted below.
  let packageRow: PackageRow | null = null;
  let effectivePlanId = input.planId;
  if (input.packageId) {
    packageRow = getPackageRow(db, input.packageId);
    if (!packageRow) throw errNotFound("errors.packageNotFound");
    if (Number(packageRow.is_active) !== 1) throw errValidation("errors.packageInactive");
    const synthetic = packageRow.synthetic_plan_id;
    if (!synthetic) throw errValidation("errors.packageNotFound");
    effectivePlanId = synthetic;
  }

  const plan = getPlanRow(db, effectivePlanId);
  if (!plan) throw errNotFound("errors.planNotFound");
  if (Number(plan.is_active) !== 1) throw errValidation("errors.planInactive");

  const startDate = input.startDate?.trim() || todayKey();
  if (!isValidDateKey(startDate)) throw errValidation("errors.invalidDate");
  const endDate = calcSubscriptionEndDate(startDate, Number(plan.duration_days));
  const price =
    input.price !== undefined && Number.isFinite(input.price)
      ? Math.max(0, input.price)
      : Number(plan.price);
  const kind = (plan.kind ?? "time") as "time" | "sessions" | "open";
  const unlimitedVisits = packageRow != null && Number(packageRow.unlimited_visits) === 1;
  const sessionsTotal =
    kind === "sessions" && !unlimitedVisits ? Number(plan.sessions_count ?? 0) : null;
  if (kind === "sessions" && !unlimitedVisits && (!sessionsTotal || sessionsTotal <= 0)) {
    throw errValidation("errors.planSessionsInvalid");
  }

  const overlap = findOverlap(db, input.memberId, startDate, endDate);
  if (overlap) {
    throw errConflict("errors.subscriptionOverlap", {
      suggestedStart: calcSubscriptionEndDate(overlap.end_date, 2),
      endDate: overlap.end_date,
    });
  }

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      `INSERT INTO member_subscriptions (id, member_id, plan_id, start_date, end_date, price, status, sessions_total, sessions_used, notes, created_by, created_at, updated_at,
        package_id, package_name, package_model, package_duration_days, package_price, package_visit_limit, package_unlimited_visits, package_freeze_allowance_days, package_allowed_freezes, package_pt_sessions)
VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.memberId,
        effectivePlanId,
        startDate,
        endDate,
        price,
        sessionsTotal,
        input.notes?.trim() || null,
        actor.userId,
        nowStamp(),
        nowStamp(),
        packageRow?.id ?? null,
        packageRow?.name ?? null,
        packageRow?.model ?? null,
        packageRow ? Number(packageRow.duration_days) : null,
        packageRow ? Number(packageRow.price) : null,
        packageRow && packageRow.visit_limit != null ? Number(packageRow.visit_limit) : null,
        packageRow ? Number(packageRow.unlimited_visits) : 0,
        packageRow ? Number(packageRow.freeze_allowance_days ?? 0) : 0,
        packageRow ? Number(packageRow.allowed_freezes ?? 0) : 0,
        packageRow ? Number(packageRow.pt_sessions ?? 0) : 0,
      ],
    );
    recordAudit(db, actor, "SUBSCRIPTION_CREATED", "subscription", id, {
      memberCode: member.member_code,
      planName: plan.name,
      startDate,
      endDate,
      ...(packageRow ? { packageId: packageRow.id } : {}),
    });
  });

  return toSubscription(getSubscriptionRow(db, id)!, plan.name, todayKey(), (plan.kind ?? "time") as SubscriptionKind);
}

export interface UpdateSubscriptionPatch {
  startDate?: string;
  price?: number;
  notes?: string | null;
}

export async function updateSubscription(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
  patch: UpdateSubscriptionPatch,
): Promise<Subscription> {
  requirePermission(actor, "subscriptions.edit");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  if (row.status === "cancelled") throw errValidation("errors.subscriptionCancelled");
  assertSubMemberAccess(db, actor, row.member_id);

  const startDate = patch.startDate?.trim() || row.start_date;
  if (!isValidDateKey(startDate)) throw errValidation("errors.invalidDate");
  const lengthDays = diffDaysKeys(row.start_date, row.end_date) + 1;
  const endDate = calcSubscriptionEndDate(startDate, lengthDays);
  const price =
    patch.price !== undefined && Number.isFinite(patch.price)
      ? Math.max(0, patch.price)
      : Number(row.price);
  const notes = patch.notes !== undefined ? patch.notes?.trim() || null : row.notes;

  const overlap = findOverlap(db, row.member_id, startDate, endDate, subscriptionId);
  if (overlap) {
    throw errConflict("errors.subscriptionOverlap", {
      suggestedStart: calcSubscriptionEndDate(overlap.end_date, 2),
      endDate: overlap.end_date,
    });
  }

  await db.transaction(async () => {
    db.run(
      "UPDATE member_subscriptions SET start_date = ?, end_date = ?, price = ?, notes = ?, updated_at = ? WHERE id = ?",
      [startDate, endDate, price, notes, nowStamp(), subscriptionId],
    );
    recordAudit(db, actor, "SUBSCRIPTION_UPDATED", "subscription", subscriptionId, {
      startDate,
      endDate,
    });
  });

  const fresh = getSubscriptionRow(db, subscriptionId)!;
  return withPlanInfo(db, fresh, todayKey());
}

export async function setSubscriptionStatus(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
  status: SubscriptionRowStatus,
): Promise<Subscription> {
  requirePermission(actor, status === "cancelled" ? "subscriptions.cancel" : "subscriptions.edit");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  if (row.status === status) {
    return withPlanInfo(db, row, todayKey());
  }
  if (status === "active" && row.status !== "suspended") {
    throw errConflict("errors.subscriptionCancelled");
  }
  assertSubMemberAccess(db, actor, row.member_id);

  await db.transaction(async () => {
    db.run(
      "UPDATE member_subscriptions SET status = ?, updated_at = ? WHERE id = ?",
      [status, nowStamp(), subscriptionId],
    );
    if (status === "cancelled") {
      const payments = db.all<{ id: string; method_code: string; paid_amount_minor: number; paid_at: string; member_id: string }>(
        "SELECT id, method_code, paid_amount_minor, paid_at, member_id FROM payments WHERE subscription_id = ? AND status IN ('partial', 'paid')",
        [subscriptionId],
      );
      for (const pay of payments) {
        const alreadyReversed =
          db.count(
            "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ? AND entry_type = 'reversal_payment'",
            [pay.id],
          ) > 0;
        if (alreadyReversed) continue;
        insertLedgerEntry(db, {
          entryType: "reversal_payment",
          refTable: "payments",
          refId: pay.id,
          memberId: pay.member_id,
          methodCode: pay.method_code,
          direction: -1,
          amountMinor: pay.paid_amount_minor,
          occurredAt: nowStamp(),
          actor,
        });
      }
    }
    recordAudit(
      db,
      actor,
      status === "cancelled" ? "SUBSCRIPTION_CANCELLED" : "SUBSCRIPTION_UPDATED",
      "subscription",
      subscriptionId,
      { to: status },
    );
  });

  const fresh = getSubscriptionRow(db, subscriptionId)!;
  return withPlanInfo(db, fresh, todayKey());
}

export async function undoCancelSubscription(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): Promise<Subscription> {
  requirePermission(actor, "subscriptions.cancel");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  if (row.status !== "cancelled") throw errConflict("errors.subscriptionNotCancelled");
  assertSubMemberAccess(db, actor, row.member_id);

  await db.transaction(async () => {
    db.run(
      "UPDATE member_subscriptions SET status = 'active', updated_at = ? WHERE id = ?",
      [nowStamp(), subscriptionId],
    );
    const payments = db.all<{ id: string }>(
      "SELECT id FROM payments WHERE subscription_id = ? AND status IN ('partial', 'paid')",
      [subscriptionId],
    );
    for (const pay of payments) {
      db.run(
        "DELETE FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ? AND entry_type = 'reversal_payment'",
        [pay.id],
      );
    }
    recordAudit(db, actor, "SUBSCRIPTION_UNCANCELLED", "subscription", subscriptionId, {});
  });

  const fresh = getSubscriptionRow(db, subscriptionId)!;
  return withPlanInfo(db, fresh, todayKey());
}

export function listMemberSubscriptions(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): Subscription[] {
  requirePermission(actor, "subscriptions.view");
  assertSubMemberAccess(db, actor, memberId);
  const rows = db.all<SubscriptionRow>(
    "SELECT * FROM member_subscriptions WHERE member_id = ? ORDER BY start_date DESC",
    [memberId],
  );
  const today = todayKey();
  return rows.map((row) =>
    withPlanInfo(db, row, today),
  );
}

export interface SubscriptionListQuery {
  page?: number;
  pageSize?: number;
  effective?: "all" | EffectiveSubscriptionStatus;
  memberId?: string;
}

export interface SubscriptionWithMember extends Subscription {
  memberCode: string;
  memberName: string;
}

export function listSubscriptions(
  db: Db,
  actor: ServiceActor,
  query: SubscriptionListQuery = {},
): { items: SubscriptionWithMember[]; total: number } {
  requirePermission(actor, "subscriptions.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));
  const today = todayKey();

  const conditions: string[] = [];
  const params: Array<string> = [];
  if (query.effective === "upcoming") {
    conditions.push("s.status = 'active' AND s.start_date > ?");
    params.push(today);
  } else if (query.effective === "expired") {
    conditions.push("s.status = 'active' AND s.end_date < ?");
    params.push(today);
  } else if (query.effective === "active") {
    conditions.push("s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?");
    params.push(today, today);
  } else if (query.effective === "frozen") {
    conditions.push("s.status = 'suspended' AND s.frozen_at IS NOT NULL");
  } else if (query.effective === "suspended") {
    conditions.push("s.status = 'suspended' AND s.frozen_at IS NULL");
  } else if (query.effective === "cancelled") {
    conditions.push("s.status = 'cancelled'");
  }
  if (query.memberId) {
    conditions.push("s.member_id = ?");
    params.push(query.memberId);
  }

  const scope = departmentScopeCondition(actor, "m");
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ""));
    params.push(...scope.params);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const baseFrom =
    "FROM member_subscriptions s\nJOIN members m ON m.id = s.member_id\nJOIN membership_plans p ON p.id = s.plan_id";
  const total = db.count(`SELECT COUNT(*) ${baseFrom.replace(/\n/g, " ")} ${where}`, params);
  const rows = db.all<
    SubscriptionRow & { plan_name: string; member_code: string; full_name: string }
  >(
    `SELECT s.*, p.name AS plan_name, p.kind AS plan_kind, m.member_code AS member_code, m.full_name AS full_name\n${baseFrom}\n${where} ORDER BY s.start_date DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  const items = rows.map((row) => ({
    ...toSubscription(row, row.plan_name, today, (row.plan_kind ?? "time") as SubscriptionKind),
    memberCode: row.member_code,
    memberName: row.full_name,
  }));
  return { items, total };
}

export function listExpiringSubscriptions(
  db: Db,
  actor: ServiceActor,
  withinDays = 7,
): SubscriptionWithMember[] {
  requirePermission(actor, "subscriptions.view");
  const today = todayKey();
  const horizon = calcSubscriptionEndDate(today, withinDays + 1);
  const rows = db.all<
    SubscriptionRow & { plan_name: string; plan_kind: string | null; member_code: string; full_name: string }
  >(
    "SELECT s.*, p.name AS plan_name, p.kind AS plan_kind, m.member_code AS member_code, m.full_name AS full_name\nFROM member_subscriptions s\nJOIN membership_plans p ON p.id = s.plan_id\nJOIN members m ON m.id = s.member_id\nWHERE s.status = 'active' AND s.end_date >= ? AND s.end_date <= ?\nORDER BY s.end_date ASC",
    [today, horizon],
  );
  return rows.map((row) => ({
    ...toSubscription(row, row.plan_name, today, (row.plan_kind ?? "time") as SubscriptionKind),
    memberCode: row.member_code,
    memberName: row.full_name,
  }));
}

export function countActiveSubscriptions(db: Db): number {
  const today = todayKey();
  return db.count(
    "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active' AND start_date <= ? AND end_date >= ?",
    [today, today],
  );
}

// ---------------------------------------------------------------------------
// Lifecycle: freeze / unfreeze / renew
// ---------------------------------------------------------------------------

export interface FreezeInfo {
  id: string;
  subscriptionId: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  frozenAt: string;
  expectedResumeDate: string | null;
  actualResumeDate: string | null;
  reason: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

function toFreezeInfo(row: Row): FreezeInfo {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    durationDays: Number(row.duration_days ?? 0),
    frozenAt: String(row.frozen_at),
    expectedResumeDate: row.expected_resume_date == null ? null : String(row.expected_resume_date),
    actualResumeDate: row.actual_resume_date == null ? null : String(row.actual_resume_date),
    reason: row.reason == null ? null : String(row.reason),
    notes: row.notes == null ? null : String(row.notes),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  };
}

export function listSubscriptionFreezes(db: Db, actor: ServiceActor, subscriptionId: string): FreezeInfo[] {
  requirePermission(actor, "subscriptions.view");
  const sub = db.first<{ member_id: string }>(
    "SELECT member_id FROM member_subscriptions WHERE id = ?",
    [subscriptionId],
  );
  if (sub) assertSubMemberAccess(db, actor, sub.member_id);
  return db
    .all<Row>(
      "SELECT * FROM subscription_freezes WHERE subscription_id = ? ORDER BY created_at DESC",
      [subscriptionId],
    )
    .map(toFreezeInfo);
}

/**
 * Freezes an active in-window subscription. The original record is preserved;
 * the new expiry date is automatically calculated based on actual frozen duration
 * when unfreezing (manual unfreeze always extends; auto-unfreeze respects setting).
 */
export async function freezeSubscription(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
  input: { startDate?: string | null; endDate: string; reason?: string | null; notes?: string | null } = { endDate: "" },
): Promise<Subscription> {
  requirePermission(actor, "subscriptions.freeze");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  if (row.status === "cancelled") throw errValidation("errors.subscriptionCancelled");
  if (row.status === "suspended") throw errConflict("errors.subscriptionAlreadyFrozen");
  assertSubMemberAccess(db, actor, row.member_id);

  const today = todayKey();

  // Validate subscription is in active window
  if (row.start_date > today || row.end_date < today) {
    throw errValidation("errors.freezeWindowInvalid");
  }

  // Package freeze limits: enforce allowed freeze COUNT (captured at purchase
  // time, history-safe snapshot). The cumulative DAYS allowance is checked below
  // once the requested duration is known.
  const allowedFreezes = Number(row.package_allowed_freezes ?? 0);
  const allowanceDays = Number(row.package_freeze_allowance_days ?? 0);
  if (allowedFreezes > 0) {
    const freezesSoFar = db.count(
      "SELECT COUNT(*) FROM subscription_freezes WHERE subscription_id = ?",
      [subscriptionId],
    );
    if (freezesSoFar >= allowedFreezes) {
      throw errValidation("errors.freezeMaxReached", { max: allowedFreezes });
    }
  }

  // Validate input dates
  const startDate = (input.startDate?.trim() || today);
  if (!isValidDateKey(startDate)) throw errValidation("errors.freezeStartDateInvalid");
  if (startDate < row.start_date) throw errValidation("errors.freezeStartDateInvalid");
  if (startDate > row.end_date) throw errValidation("errors.freezeStartDateInvalid");

  const endDate = input.endDate?.trim();
  if (!endDate) throw errValidation("errors.freezeEndDateInvalid");
  if (!isValidDateKey(endDate)) throw errValidation("errors.freezeEndDateInvalid");
  if (endDate < startDate) throw errValidation("errors.freezeEndDateInvalid");
  if (endDate > row.end_date) throw errValidation("errors.freezeEndDateInvalid");

  const durationDays = diffDaysKeys(startDate, endDate) + 1;
  if (durationDays <= 0) throw errValidation("errors.freezeDurationInvalid");

  // Cumulative DAYS allowance: the new request must not push the member past the
  // allowed total (frozen_days already consumed + this request's duration).
  if (allowanceDays > 0 && Number(row.frozen_days ?? 0) + durationDays > allowanceDays) {
    throw errValidation("errors.freezeAllowanceExhausted", { days: allowanceDays });
  }

  // Check for overlapping freezes (only open freezes with actual_resume_date IS NULL)
  const overlapFreeze = db.first<{ id: string }>(
    `SELECT id FROM subscription_freezes
     WHERE subscription_id = ? AND actual_resume_date IS NULL
     AND NOT (end_date < ? OR start_date > ?)
     LIMIT 1`,
    [subscriptionId, startDate, endDate]
  );
  if (overlapFreeze) {
    throw errValidation("errors.freezeOverlap");
  }

  const freezeId = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      `INSERT INTO subscription_freezes (id, subscription_id, frozen_at, expected_resume_date, reason, created_by, created_at,
        start_date, end_date, duration_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        freezeId,
        subscriptionId,
        nowStamp(),
        endDate,
        input.reason?.trim() || null,
        actor.userId,
        nowStamp(),
        startDate,
        endDate,
        durationDays,
        input.notes?.trim() || null,
      ],
    );
    db.run(
      "UPDATE member_subscriptions SET status = 'suspended', frozen_at = ?, resume_date = ?, updated_at = ? WHERE id = ?",
      [nowStamp(), endDate, nowStamp(), subscriptionId],
    );
    recordAudit(db, actor, "SUBSCRIPTION_FROZEN", "subscription", subscriptionId, {
      reason: input.reason?.trim() || null,
      startDate,
      endDate,
      durationDays,
      notes: input.notes?.trim() || null,
    });
  });

  return withPlanInfo(db, getSubscriptionRow(db, subscriptionId)!, today);
}

/** Resumes a frozen subscription; extends end_date by actual frozen duration.
 * Manual unfreeze always extends; auto-unfreeze (check-in) respects freeze_extends_expiry setting.
 */
export async function unfreezeSubscription(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
  options: { isAutoUnfreeze?: boolean } = {},
): Promise<Subscription> {
  requirePermission(actor, "subscriptions.freeze");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  if (row.status !== "suspended") throw errConflict("errors.subscriptionNotFrozen");
  assertSubMemberAccess(db, actor, row.member_id);

  const openFreeze = db.first<{ id: string; start_date: string; duration_days: number }>(
    "SELECT id, start_date, duration_days FROM subscription_freezes WHERE subscription_id = ? AND actual_resume_date IS NULL ORDER BY created_at DESC LIMIT 1",
    [subscriptionId],
  );

  const today = todayKey();

  // Actual frozen days: from freeze start_date to today (capped at planned
  // duration). A same-day freeze/unfreeze (unfreeze date == start date) grants
  // NO extension — otherwise a freeze followed by an immediate unfreeze would
  // inflate the subscription end date by one day, repeatable for free days.
  const actualFrozenDays = openFreeze
    ? today === openFreeze.start_date
      ? 0
      : Math.max(0, Math.min(
          diffDaysKeys(openFreeze.start_date, today) + 1,
          Number(openFreeze.duration_days ?? 0)
        ))
    : 0;

  await db.transaction(async () => {
    let endDate = row.end_date;
    if (openFreeze) {
      if (actualFrozenDays > 0) {
        // Manual unfreeze always extends; auto-unfreeze only if setting enabled
        const extendsExpirySetting = db.first<{ value: string }>(
          "SELECT value FROM settings WHERE key = 'freeze_extends_expiry'",
        )?.value;
        const extendsExpiry = extendsExpirySetting == null || extendsExpirySetting === "1";
        const shouldExtend = options.isAutoUnfreeze ? extendsExpiry : true;

        if (shouldExtend) {
          endDate = addDaysKey(endDate, actualFrozenDays);
          db.run(
            "UPDATE member_subscriptions SET end_date = ?, frozen_days = frozen_days + ? WHERE id = ?",
            [endDate, actualFrozenDays, subscriptionId],
          );
        }
      }
      db.run(
        "UPDATE subscription_freezes SET actual_resume_date = ? WHERE id = ?",
        [today, openFreeze.id],
      );
    }
    db.run(
      "UPDATE member_subscriptions SET status = 'active', frozen_at = NULL, resume_date = NULL, updated_at = ? WHERE id = ?",
      [nowStamp(), subscriptionId],
    );
    recordAudit(db, actor, "SUBSCRIPTION_UNFROZEN", "subscription", subscriptionId, {
      extendedEndDate: endDate,
      actualFrozenDays,
      isAutoUnfreeze: !!options.isAutoUnfreeze,
    });
  });

  return withPlanInfo(db, getSubscriptionRow(db, subscriptionId)!, today);
}

export interface RenewResult {
  previous: Subscription;
  next: Subscription;
  startedToday: boolean;
}

/**
 * Renews by creating a NEW historical subscription that starts after the old
 * one ends (or today when the old one already expired). History is preserved.
 */
export async function renewSubscription(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
  input: { price?: number; notes?: string | null } = {},
): Promise<RenewResult> {
  requirePermission(actor, "subscriptions.create");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  if (row.status === "cancelled") throw errConflict("errors.subscriptionCancelled");
  if (row.status === "suspended") throw errConflict("errors.subscriptionFrozenRenew");
  assertSubMemberAccess(db, actor, row.member_id);

  const plan = getPlanRow(db, row.plan_id);
  if (!plan) throw errNotFound("errors.planNotFound");
  if (Number(plan.is_active) !== 1) throw errValidation("errors.planInactive");

  const today = todayKey();
  const startDate = row.end_date >= today ? calcSubscriptionEndDate(row.end_date, 2) : today;

  const overlap = findOverlap(db, row.member_id, startDate, calcSubscriptionEndDate(startDate, Number(plan.duration_days)));
  if (overlap && overlap.id !== subscriptionId) {
    throw errConflict("errors.subscriptionOverlap", {
      suggestedStart: calcSubscriptionEndDate(overlap.end_date, 2),
      endDate: overlap.end_date,
    });
  }

  const next = await createSubscription(db, actor, {
    memberId: row.member_id,
    planId: row.plan_id,
    startDate,
    price: input.price !== undefined ? input.price : undefined,
    notes: input.notes ?? row.notes,
    packageId: row.package_id ?? undefined,
  });

  applyEarnRule(db, actor, row.member_id, "renewal", "member_subscriptions", next.id, { reason: "renewal" });

  return {
    previous: withPlanInfo(db, getSubscriptionRow(db, subscriptionId)!, today),
    next,
    startedToday: startDate === today,
  };
}

/**
 * Hard-deletes a subscription (ADR-008, owner request). Removes its payments,
 * refunds and their treasury ledger rows, its freeze history — while keeping
 * attendance and class bookings alive with the subscription reference
 * detached (NULL) so visit history is never lost.
 */
export async function purgeSubscription(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): Promise<void> {
  requirePermission(actor, "subscriptions.purge");
  const row = getSubscriptionRow(db, subscriptionId);
  if (!row) throw errNotFound("errors.subscriptionNotFound");
  assertSubMemberAccess(db, actor, row.member_id);

  const memberCode =
    db.first<{ member_code: string }>(
      "SELECT member_code FROM members WHERE id = ?",
      [row.member_id],
    )?.member_code ?? null;

  await db.transaction(async () => {
    db.run(
      "UPDATE class_bookings SET consumed_subscription_id = NULL WHERE consumed_subscription_id = ?",
      [subscriptionId],
    );
    db.run("UPDATE attendance SET subscription_id = NULL WHERE subscription_id = ?", [subscriptionId]);

    const payIds = db
      .all<{ id: string }>("SELECT id FROM payments WHERE subscription_id = ?", [subscriptionId])
      .map((p) => p.id);
    if (payIds.length > 0) {
      const ph = payIds.map(() => "?").join(",");
      db.run(
        `DELETE FROM financial_ledger WHERE (ref_table = 'payments' AND ref_id IN (${ph})) OR (ref_table = 'payment_refunds' AND ref_id IN (SELECT id FROM payment_refunds WHERE payment_id IN (${ph})))`,
        [...payIds, ...payIds],
      );
      db.run(`DELETE FROM payment_refunds WHERE payment_id IN (${ph})`, payIds);
      db.run(`DELETE FROM payments WHERE id IN (${ph})`, payIds);
    }

    db.run("DELETE FROM subscription_freezes WHERE subscription_id = ?", [subscriptionId]);
    db.run("DELETE FROM member_subscriptions WHERE id = ?", [subscriptionId]);
    recordAudit(db, actor, "SUBSCRIPTION_PURGED", "subscription", subscriptionId, {
      memberCode,
      planName: row.plan_id,
      paymentsRemoved: payIds.length,
    });
  });
}
