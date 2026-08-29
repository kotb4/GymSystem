import {
  addDaysKey,
  isValidDateKey,
  nowStamp,
  todayKey,
} from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import {
  requirePermission,
  type DepartmentScope,
  type ServiceActor,
} from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, departmentScopeCondition } from "./department";
import { PHONE_RE, createMember, getMemberRowById } from "./members.service";
import { getPlanRow, type PlanRow } from "./plans.service";
import { createSubscription } from "./subscriptions.service";

const TRIAL_TYPES = ["free", "paid", "day_1", "day_3", "day_7", "custom"] as const;
export type TrialType = (typeof TRIAL_TYPES)[number];

const STATUSES = ["active", "expired", "converted", "cancelled"] as const;
export type TrialStatus = (typeof STATUSES)[number];

const DEPARTMENTS: readonly DepartmentScope[] = ["general", "men", "women"];

/** Fixed duration (inclusive days) for the labelled shortcut types. */
function fixedDurationDays(type: TrialType): number | null {
  switch (type) {
    case "day_1":
      return 1;
    case "day_3":
      return 3;
    case "day_7":
      return 7;
    default:
      return null;
  }
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function stamp(): string {
  return nowStamp();
}

// ------------------------------- rows -------------------------------------

interface TrialRow extends Row {
  id: string;
  trial_type: string;
  lead_id: string | null;
  member_id: string | null;
  member_code: string | null;
  member_name: string | null;
  phone: string | null;
  preferred_plan_id: string | null;
  plan_name: string | null;
  department: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: string;
  converted_member_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  converted_at: string | null;
}

export interface Trial {
  id: string;
  trialType: TrialType;
  leadId: string | null;
  memberId: string | null;
  memberCode: string | null;
  memberName: string | null;
  phone: string | null;
  preferredPlanId: string | null;
  planName: string | null;
  department: DepartmentScope;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: TrialStatus;
  /** Status reflective of the date window even before the sweep runs. */
  effectiveStatus: "active" | "expired" | "converted" | "cancelled";
  convertedMemberId: string | null;
  createdAt: string;
  updatedAt: string;
  expiredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  convertedAt: string | null;
}

function toTrial(row: TrialRow, today: string): Trial {
  const stored = row.status as TrialStatus;
  let effectiveStatus: Trial["effectiveStatus"] = stored;
  if (stored !== "converted" && stored !== "cancelled") {
    // An "active" trial whose window has lapsed is effectively expired.
    if (row.end_date < today) effectiveStatus = "expired";
  }
  return {
    id: str(row.id),
    trialType: str(row.trial_type) as TrialType,
    leadId: row.lead_id == null ? null : str(row.lead_id),
    memberId: row.member_id == null ? null : str(row.member_id),
    memberCode: row.member_code == null ? null : str(row.member_code),
    memberName: row.member_name == null ? null : str(row.member_name),
    phone: row.phone == null ? null : str(row.phone),
    preferredPlanId: row.preferred_plan_id == null ? null : str(row.preferred_plan_id),
    planName: row.plan_name == null ? null : str(row.plan_name),
    department: (str(row.department) || "general") as DepartmentScope,
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    notes: row.notes == null ? null : str(row.notes),
    status: stored,
    effectiveStatus,
    convertedMemberId: row.converted_member_id == null ? null : str(row.converted_member_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    expiredAt: row.expired_at == null ? null : str(row.expired_at),
    cancelledAt: row.cancelled_at == null ? null : str(row.cancelled_at),
    cancelReason: row.cancel_reason == null ? null : str(row.cancel_reason),
    convertedAt: row.converted_at == null ? null : str(row.converted_at),
  };
}

function getTrialRow(db: Db, trialId: string, actor: ServiceActor): TrialRow {
  const row = db.first<TrialRow>("SELECT * FROM trials WHERE id = ?", [trialId]);
  if (!row) throw errNotFound("errors.trialNotFound");
  assertDepartmentAccess(actor, row.department);
  return row;
}

// --------------------------- check-in authority ---------------------------

export interface ActiveTrialAuthority {
  id: string;
  trialType: TrialType;
  endDate: string;
}

/**
 * The trial that authorizes a member to attend today (active window in date),
 * used as a targeted alternative to a paid subscription at the check-in desk.
 * Members without a live trial window fall through to the normal rules.
 */
export function activeTrialForMember(
  db: Db,
  memberId: string,
  today: string,
): ActiveTrialAuthority | null {
  const row = db.first<TrialRow>(
    "SELECT * FROM trials WHERE member_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ? ORDER BY end_date DESC LIMIT 1",
    [memberId, today, today],
  );
  if (!row) return null;
  return { id: row.id, trialType: str(row.trial_type) as TrialType, endDate: str(row.end_date) };
}

/** Count of trials whose effective window is expired but not yet swept. */
export function countExpiredTrials(db: Db, department: DepartmentScope | "all" = "all"): number {
  const today = todayKey();
  const andDept =
    department && department !== "all" ? " AND department = ?" : "";
  const params: Array<string> = [];
  if (department && department !== "all") params.push(department);
  return num(
    db.scalar(
      `SELECT COUNT(*) FROM trials WHERE status = 'active' AND end_date < ?${andDept}`,
      [today, ...params],
    ),
  );
}

// ------------------------------ validation ---------------------------------

export interface TrialInput {
  trialType: TrialType;
  leadId?: string | null;
  memberId?: string | null;
  phone?: string | null;
  preferredPlanId?: string | null;
  department?: DepartmentScope;
  startDate?: string;
  endDate?: string;
  notes?: string | null;
}

function resolveDates(input: TrialInput, type: TrialType): { startDate: string; endDate: string } {
  const startDate = input.startDate?.trim() || todayKey();
  if (!isValidDateKey(startDate)) throw errValidation("errors.invalidDate");

  const fixed = fixedDurationDays(type);
  const endDate =
    input.endDate?.trim() || (fixed == null ? "" : addDaysKey(startDate, fixed - 1));

  if (endDate === "") throw errValidation("errors.trialEndDateRequired");
  if (!isValidDateKey(endDate)) throw errValidation("errors.invalidDate");
  if (endDate < startDate) throw errValidation("errors.trialDateRange");

  return { startDate, endDate };
}

function resolvePlan(db: Db, planId?: string | null): PlanRow | null {
  if (!planId) return null;
  const plan = getPlanRow(db, planId);
  if (!plan || num(plan.is_active, 1) !== 1) throw errValidation("errors.trialPlanInvalid");
  return plan;
}

/**
 * Validate shared shape. Department-access checks run separately against the
 * actor in create/update (they need the caller, not just the record).
 */
function assertShape(db: Db, input: TrialInput): {
  phone: string | null;
  plan: PlanRow | null;
} {
  if (!TRIAL_TYPES.includes(input.trialType)) throw errValidation("errors.trialTypeInvalid");
  if (input.department && !DEPARTMENTS.includes(input.department)) {
    throw errValidation("errors.trialDepartmentInvalid");
  }
  const phone = input.phone?.trim() || null;
  if (phone && !PHONE_RE.test(phone)) throw errValidation("errors.trialPhoneInvalid");
  const plan = resolvePlan(db, input.preferredPlanId);
  return { phone, plan };
}

function linkMemberSnapshot(
  db: Db,
  memberId: string | null | undefined,
): { memberId: string | null; memberCode: string | null; memberName: string | null; phone: string | null } {
  if (!memberId) {
    return { memberId: null, memberCode: null, memberName: null, phone: null };
  }
  const member = getMemberRowById(db, memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  if (member.status === "archived") throw errConflict("errors.memberArchived");
  return {
    memberId: member.id,
    memberCode: str(member.member_code),
    memberName: str(member.full_name),
    phone: str(member.phone) || null,
  };
}

function linkLead(
  db: Db,
  leadId: string | null | undefined,
  department: DepartmentScope,
): string | null {
  if (!leadId) return null;
  const lead = db.first<Row>("SELECT * FROM leads WHERE id = ?", [leadId]);
  if (!lead) throw errNotFound("errors.leadNotFound");
  if (str(lead.department) !== department && str(lead.department) !== "general") {
    throw errValidation("errors.trialDepartmentInvalid");
  }
  return str(lead.id) || null;
}

// ------------------------------- create -----------------------------------

export async function createTrial(
  db: Db,
  actor: ServiceActor,
  input: TrialInput,
): Promise<Trial> {
  requirePermission(actor, "trials.create");
  const department: DepartmentScope = input.department ?? "general";
  assertDepartmentAccess(actor, department);
  if (input.leadId) {
    assertDepartmentAccess(actor, leadDepartmentOf(db, input.leadId));
  }
  if (input.memberId) {
    assertDepartmentAccess(actor, memberDepartmentOf(db, input.memberId));
  }

  const { phone, plan } = assertShape(db, input);
  const { startDate, endDate } = resolveDates(input, input.trialType);
  const member = linkMemberSnapshot(db, input.memberId);
  const leadId = linkLead(db, input.leadId, department);
  // When no member is linked, carry the lead's name/phone forward so a later
  // conversion can create a real member record from the trial.
  if (!member.memberId && leadId) {
    const lead = db.first<Row>("SELECT full_name, phone FROM leads WHERE id = ?", [leadId]);
    if (lead) {
      member.memberName = str(lead.full_name) || null;
      if (!member.phone) member.phone = str(lead.phone) || null;
    }
  }
  const today = todayKey();
  const now = nowStamp();

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    const status: TrialStatus = endDate < today ? "expired" : "active";
    db.run(
      "INSERT INTO trials (id, trial_type, lead_id, member_id, member_code, member_name, phone, preferred_plan_id, plan_name, department, start_date, end_date, notes, status, expired_at, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.trialType,
        leadId,
        member.memberId,
        member.memberCode,
        member.memberName,
        phone || member.phone,
        plan?.id ?? null,
        plan?.name ?? null,
        department,
        startDate,
        endDate,
        input.notes?.trim() || null,
        status,
        status === "expired" ? now : null,
        actor.userId,
        now,
        now,
      ],
    );
    recordAudit(db, actor, "TRIAL_CREATED", "trial", id, {
      trialType: input.trialType,
      memberId: member.memberId,
      leadId,
      startDate,
      endDate,
    });
  });

  if (leadId) pushLeadToTrial(db, leadId);
  return toTrial(getTrialRow(db, id, actor), today);
}

function leadDepartmentOf(db: Db, leadId: string): DepartmentScope {
  const row = db.first<Row>("SELECT department FROM leads WHERE id = ?", [leadId]);
  return (str(row?.department) || "general") as DepartmentScope;
}

function memberDepartmentOf(db: Db, memberId: string): DepartmentScope {
  const row = db.first<Row>("SELECT department FROM members WHERE id = ?", [memberId]);
  return (str(row?.department) || "general") as DepartmentScope;
}

/** Best-effort: nudge a linked CRM lead into the trial pipeline stage. */
function pushLeadToTrial(db: Db, leadId: string): void {
  const lead = db.first<Row>("SELECT status, converted_member_id FROM leads WHERE id = ?", [leadId]);
  if (!lead || lead.converted_member_id) return;
  const current = str(lead.status);
  if (current !== "trial" && current !== "joined" && current !== "lost") {
    db.run(
      "UPDATE leads SET status = 'trial', trial_at = ?, updated_at = ? WHERE id = ?",
      [stamp(), stamp(), leadId],
    );
  }
}

// ------------------------------- update -----------------------------------

export interface TrialPatch {
  trialType?: TrialType;
  memberId?: string | null;
  phone?: string | null;
  preferredPlanId?: string | null;
  department?: DepartmentScope;
  startDate?: string;
  endDate?: string;
  notes?: string | null;
}

export async function updateTrial(
  db: Db,
  actor: ServiceActor,
  trialId: string,
  patch: TrialPatch,
): Promise<Trial> {
  requirePermission(actor, "trials.manage");
  const row = getTrialRow(db, trialId, actor);
  if (row.status === "converted" || row.status === "cancelled") {
    throw errValidation("errors.trialNotEditable");
  }

  const trialType = patch.trialType ?? (row.trial_type as TrialType);
  const merged: TrialInput = {
    trialType,
    memberId:
      patch.memberId === undefined ? (row.member_id ?? null) : patch.memberId,
    phone: patch.phone === undefined ? (row.phone ?? null) : patch.phone,
    preferredPlanId:
      patch.preferredPlanId === undefined
        ? (row.preferred_plan_id ?? null)
        : patch.preferredPlanId,
    department: patch.department ?? (row.department as DepartmentScope),
    startDate: patch.startDate ?? row.start_date,
    endDate: patch.endDate ?? row.end_date,
    notes: patch.notes === undefined ? (row.notes ?? null) : patch.notes,
  };

  const department = merged.department as DepartmentScope;
  assertDepartmentAccess(actor, department);
  if (merged.memberId) assertDepartmentAccess(actor, memberDepartmentOf(db, merged.memberId));

  const { phone, plan } = assertShape(db, merged);
  const { startDate, endDate } = resolveDates(merged, trialType);
  const member = linkMemberSnapshot(db, merged.memberId);
  const today = todayKey();
  const now = nowStamp();
  const nextStatus: TrialStatus =
    row.status === "expired" && endDate >= today
      ? "active"
      : row.status === "active" && endDate < today
        ? "expired"
        : (row.status as TrialStatus);

  await db.transaction(() => {
    db.run(
      "UPDATE trials SET trial_type = ?, member_id = ?, member_code = ?, member_name = ?, phone = ?, preferred_plan_id = ?, plan_name = ?, department = ?, start_date = ?, end_date = ?, notes = ?, status = ?, expired_at = ?, updated_at = ? WHERE id = ?",
      [
        trialType,
        member.memberId,
        member.memberCode,
        member.memberName,
        phone || member.phone,
        plan?.id ?? null,
        plan?.name ?? null,
        department,
        startDate,
        endDate,
        merged.notes?.trim() || null,
        nextStatus,
        nextStatus === "expired" ? now : row.expired_at,
        now,
        row.id,
      ],
    );
    if (member.memberId && (!row.member_id || member.memberId !== row.member_id)) {
      db.run("UPDATE trials SET member_id = ? WHERE id = ?", [member.memberId, row.id]);
    }
    recordAudit(db, actor, "TRIAL_UPDATED", "trial", row.id, {
      trialType,
      startDate,
      endDate,
    });
  });

  return toTrial(getTrialRow(db, row.id, actor), today);
}

// ------------------------------- listing ----------------------------------

export interface TrialListQuery {
  status?: TrialStatus | "all";
  department?: DepartmentScope | "all";
  search?: string;
  leadId?: string;
  memberId?: string;
  page?: number;
  pageSize?: number;
}

export interface TrialListResult {
  items: Trial[];
  total: number;
}

export function listTrials(db: Db, actor: ServiceActor, query: TrialListQuery = {}): TrialListResult {
  requirePermission(actor, "trials.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status && query.status !== "all") {
    conditions.push("t.status = ?");
    params.push(query.status);
  }
  if (query.department && query.department !== "all") {
    conditions.push("t.department = ?");
    params.push(query.department);
  }
  if (query.leadId) {
    conditions.push("t.lead_id = ?");
    params.push(query.leadId);
  }
  if (query.memberId) {
    conditions.push("t.member_id = ?");
    params.push(query.memberId);
  }
  const search = query.search?.trim();
  if (search) {
    conditions.push("(t.member_name LIKE ? OR t.member_code LIKE ? OR t.phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const scope = departmentScopeCondition(actor, "t");
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^\s*AND\s+/, ""));
    params.push(...scope.params);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = num(db.scalar(`SELECT COUNT(*) FROM trials t ${where}`, params));
  const today = todayKey();
  const items = db
    .all<TrialRow>(`SELECT t.* FROM trials t ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, [
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ])
    .map((r) => toTrial(r, today));
  return { items, total };
}

export function getTrial(db: Db, actor: ServiceActor, trialId: string): Trial {
  requirePermission(actor, "trials.view");
  return toTrial(getTrialRow(db, trialId, actor), todayKey());
}

// ------------------------------- lifecycle --------------------------------

/** Flip every lapsed active trial to expired; returns how many changed. */
export function sweepExpiredTrials(db: Db, actor: ServiceActor): number {
  requirePermission(actor, "trials.manage");
  const today = todayKey();
  const rows = db.all<TrialRow>(
    "SELECT * FROM trials WHERE status = 'active' AND end_date < ?",
    [today],
  );
  let changed = 0;
  for (const row of rows) {
    try {
      assertDepartmentAccess(actor, row.department);
    } catch {
      continue;
    }
    db.transaction(() => {
      db.run("UPDATE trials SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ?", [
        stamp(),
        stamp(),
        row.id,
      ]);
      recordAudit(db, actor, "TRIAL_EXPIRED", "trial", row.id, { endDate: row.end_date });
      changed += 1;
    });
  }
  return changed;
}

export async function expireTrial(db: Db, actor: ServiceActor, trialId: string): Promise<Trial> {
  requirePermission(actor, "trials.manage");
  const row = getTrialRow(db, trialId, actor);
  if (row.status === "converted" || row.status === "cancelled") {
    throw errValidation("errors.trialNotEditable");
  }
  if (row.end_date >= todayKey()) throw errValidation("errors.trialNotYetExpired");
  const now = stamp();
  await db.transaction(() => {
    db.run("UPDATE trials SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ?", [
      now,
      now,
      row.id,
    ]);
    recordAudit(db, actor, "TRIAL_EXPIRED", "trial", row.id, { endDate: row.end_date });
  });
  return toTrial(getTrialRow(db, row.id, actor), todayKey());
}

export async function cancelTrial(
  db: Db,
  actor: ServiceActor,
  trialId: string,
  reason?: string | null,
): Promise<Trial> {
  requirePermission(actor, "trials.manage");
  const row = getTrialRow(db, trialId, actor);
  if (row.status === "converted" || row.status === "cancelled") {
    throw errValidation("errors.trialNotEditable");
  }
  const now = stamp();
  await db.transaction(() => {
    db.run(
      "UPDATE trials SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
      [now, actor.userId, reason?.trim() || null, now, row.id],
    );
    recordAudit(db, actor, "TRIAL_CANCELLED", "trial", row.id, { reason: reason ?? null });
  });
  return toTrial(getTrialRow(db, row.id, actor), todayKey());
}

// ------------------------------- conversion --------------------------------

export interface ConvertTrialInput {
  trialId: string;
  existingMemberId?: string;
  /** Optionally attach a real paid subscription in the same conversion. */
  planId?: string;
  price?: number;
  startDate?: string;
}

export interface ConvertTrialResult {
  trialId: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  linkedExisting: boolean;
  subscriptionId: string | null;
}

export async function convertTrial(
  db: Db,
  actor: ServiceActor,
  input: ConvertTrialInput,
): Promise<ConvertTrialResult> {
  requirePermission(actor, "trials.manage");
  requirePermission(actor, "members.create");
  const row = getTrialRow(db, input.trialId, actor);
  if (row.status === "converted" || row.converted_member_id) {
    throw errConflict("errors.trialAlreadyConverted");
  }
  if (row.status === "cancelled") throw errValidation("errors.trialNotEditable");

  let memberId = row.member_id ? str(row.member_id) : null;
  let linkedExisting = false;

  if (input.existingMemberId) {
    const existing = getMemberRowById(db, input.existingMemberId);
    if (!existing) throw errNotFound("errors.memberNotFound");
    assertDepartmentAccess(actor, existing.department);
    memberId = existing.id;
    linkedExisting = true;
  } else if (!memberId) {
    // No linked member: dedupe by phone or create one from the trial/lead info.
    const phone = row.phone == null ? null : str(row.phone) || null;
    if (phone) {
      const dup = db.first<Row>(
        "SELECT id, full_name, member_code FROM members WHERE phone = ? AND deleted_at IS NULL",
        [phone],
      );
      if (dup) {
        memberId = str(dup.id);
        linkedExisting = true;
      }
    }
    if (!memberId) {
      const name = (row.member_name ? str(row.member_name) : "").trim();
      if (name === "") throw errValidation("errors.trialNameRequired");
      const member = await createMember(db, actor, {
        fullName: name,
        phone: row.phone == null ? null : str(row.phone) || null,
        department: (row.department as DepartmentScope) ?? "general",
      });
      memberId = member.id;
    }
  }

  const now = stamp();
  await db.transaction(() => {
    db.run(
      "UPDATE trials SET status = 'converted', converted_member_id = ?, member_id = ?, member_code = COALESCE(member_code, (SELECT member_code FROM members WHERE id = ?)), member_name = COALESCE(member_name, (SELECT full_name FROM members WHERE id = ?)), converted_at = ?, updated_at = ? WHERE id = ?",
      [memberId, memberId, memberId, memberId, now, now, row.id],
    );
    recordAudit(db, actor, "TRIAL_CONVERTED", "trial", row.id, {
      memberId,
      linkedExisting: linkedExisting ? 1 : 0,
    });
  });

  if (row.lead_id) markLeadJoined(db, str(row.lead_id), memberId);

  let subscriptionId: string | null = null;
  if (input.planId) {
    const sub = await createSubscription(db, actor, {
      memberId,
      planId: input.planId,
      price: input.price,
      startDate: input.startDate,
      notes: `converted from trial ${row.id}`,
    });
    subscriptionId = sub.id;
  }

  const memberRow = getMemberRowById(db, memberId)!;
  return {
    trialId: row.id,
    memberId,
    memberCode: str(memberRow.member_code),
    memberName: str(memberRow.full_name),
    linkedExisting,
    subscriptionId,
  };
}

function markLeadJoined(db: Db, leadId: string, convertedMemberId: string): void {
  const lead = db.first<Row>("SELECT status, converted_member_id FROM leads WHERE id = ?", [leadId]);
  if (!lead || lead.converted_member_id) return;
  if (str(lead.status) === "joined") return;
  db.run(
    "UPDATE leads SET status = 'joined', joined_at = ?, converted_member_id = ?, updated_at = ? WHERE id = ?",
    [stamp(), convertedMemberId, stamp(), leadId],
  );
}

// ------------------------------- stats ------------------------------------

export interface TrialStats {
  total: number;
  active: number;
  expired: number;
  converted: number;
  cancelled: number;
  byType: Record<TrialType, number>;
  byStatus: Record<TrialStatus, number>;
}

function bucketize(rows: Array<{ k: string; c: number }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.k] = r.c;
    return acc;
  }, {});
}

export function trialStats(db: Db, actor: ServiceActor): TrialStats {
  requirePermission(actor, "trials.view");
  const scope = departmentScopeCondition(actor, "t");
  const scopeWhere = scope.sql ? "WHERE " + scope.sql.replace(/^\s*AND\s+/, "") : "";
  const scopeParams = scope.params;

  const byStatus = bucketize(
    db.all<{ k: string; c: number }>(
      `SELECT t.status AS k, COUNT(*) AS c FROM trials t ${scopeWhere} GROUP BY t.status`,
      scopeParams,
    ),
  );
  const byType = bucketize(
    db.all<{ k: string; c: number }>(
      `SELECT t.trial_type AS k, COUNT(*) AS c FROM trials t ${scopeWhere} GROUP BY t.trial_type`,
      scopeParams,
    ),
  );
  const total = num(db.scalar(`SELECT COUNT(*) FROM trials t ${scopeWhere}`, scopeParams));
  for (const s of STATUSES) if (!(s in byStatus)) byStatus[s] = 0;
  for (const s of TRIAL_TYPES) if (!(s in byType)) byType[s] = 0;

  return {
    total,
    active: byStatus["active"] ?? 0,
    expired: byStatus["expired"] ?? 0,
    converted: byStatus["converted"] ?? 0,
    cancelled: byStatus["cancelled"] ?? 0,
    byType: byType as Record<TrialType, number>,
    byStatus: byStatus as Record<TrialStatus, number>,
  };
}
