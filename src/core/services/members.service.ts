import { nowStamp, todayKey, isValidDateKey, addDaysKey } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type DepartmentScope, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import {
  assertDepartmentAccess,
  departmentScopeCondition,
} from "./department";

const MEMBER_STATUSES = ["active", "inactive", "suspended", "archived"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;

export interface MemberRow extends Row {
  id: string;
  member_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  address: string | null;
  notes: string | null;
  registration_date: string;
  status: MemberStatus;
  height_cm: number | null;
  weight_kg: number | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  department: DepartmentScope;
  photo_file_id: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicMember {
  id: string;
  memberCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: "male" | "female" | null;
  dateOfBirth: string | null;
  address: string | null;
  notes: string | null;
  registrationDate: string;
  status: MemberStatus;
  heightCm: number | null;
  weightKg: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  department: DepartmentScope;
  photoFileId: string | null;
  deletedAt: string | null;
}

export interface MemberInput {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  gender?: "male" | "female" | null;
  dateOfBirth?: string | null;
  address?: string | null;
  notes?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  department?: DepartmentScope;
}

interface NormalizedMemberValues {
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: "male" | "female" | null;
  dateOfBirth: string | null;
  address: string | null;
  notes: string | null;
  heightCm: number | null;
  weightKg: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  department: DepartmentScope;
}

export type SmartFilter =
  | "all"
  | "active"
  | "expired"
  | "frozen"
  | "renewed"
  | "birthday"
  | "inactive"
  | "sessions_low"
  | "outstanding"
  | "trash";

export interface MemberListQuery {
  search?: string;
  status?: MemberStatus | "all";
  smart?: SmartFilter;
  inactiveDays?: number;
  page?: number;
  pageSize?: number;
}

const DEPARTMENTS: readonly DepartmentScope[] = ["general", "men", "women"];

const EMPTY_BASE: NormalizedMemberValues = {
  fullName: "",
  phone: null,
  email: null,
  gender: null,
  dateOfBirth: null,
  address: null,
  notes: null,
  heightCm: null,
  weightKg: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  department: "general",
};

export function toPublicMember(row: MemberRow): PublicMember {
  return {
    id: row.id,
    memberCode: row.member_code,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    address: row.address,
    notes: row.notes,
    registrationDate: row.registration_date,
    status: row.status,
    heightCm: row.height_cm == null ? null : Number(row.height_cm),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    emergencyContactName: row.emergency_contact_name ?? null,
    emergencyContactPhone: row.emergency_contact_phone ?? null,
    department: (row.department ?? "general") as DepartmentScope,
    photoFileId: row.photo_file_id == null ? null : String(row.photo_file_id),
    deletedAt: row.deleted_at ?? null,
  };
}

function bumpCounter(db: Db, name: string): number {
  db.run("UPDATE counters SET value = value + 1 WHERE name = ?", [name]);
  return Number(db.scalar("SELECT value FROM counters WHERE name = ?", [name]));
}

export function formatMemberCode(value: number): string {
  return `MEM-${String(value).padStart(6, "0")}`;
}

export function getMemberRowById(db: Db, memberId: string): MemberRow | null {
  return db.first<MemberRow>("SELECT * FROM members WHERE id = ?", [memberId]);
}

export function getMember(db: Db, actor: ServiceActor, memberId: string): PublicMember {
  requirePermission(actor, "members.view");
  const row = getMemberRowById(db, memberId);
  if (!row) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, row.department);
  return toPublicMember(row);
}

function resolveValues(base: NormalizedMemberValues, patch: MemberInput): NormalizedMemberValues {
  return {
    fullName: patch.fullName !== undefined ? patch.fullName.trim() : base.fullName,
    phone: patch.phone !== undefined ? patch.phone?.trim() || null : base.phone,
    email: patch.email !== undefined ? patch.email?.trim() || null : base.email,
    gender: patch.gender !== undefined ? patch.gender : base.gender,
    dateOfBirth: patch.dateOfBirth !== undefined ? patch.dateOfBirth?.trim() || null : base.dateOfBirth,
    address: patch.address !== undefined ? patch.address?.trim() || null : base.address,
    notes: patch.notes !== undefined ? patch.notes?.trim() || null : base.notes,
    heightCm:
      patch.heightCm !== undefined
        ? patch.heightCm == null
          ? null
          : Math.round(patch.heightCm * 10) / 10
        : base.heightCm,
    weightKg:
      patch.weightKg !== undefined
        ? patch.weightKg == null
          ? null
          : Math.round(patch.weightKg * 10) / 10
        : base.weightKg,
    emergencyContactName:
      patch.emergencyContactName !== undefined
        ? patch.emergencyContactName?.trim() || null
        : base.emergencyContactName,
    emergencyContactPhone:
      patch.emergencyContactPhone !== undefined
        ? patch.emergencyContactPhone?.trim() || null
        : base.emergencyContactPhone,
    department:
      patch.department !== undefined && DEPARTMENTS.includes(patch.department)
        ? patch.department
        : base.department,
  };
}

function assertValidValues(db: Db, values: NormalizedMemberValues, excludeId?: string): void {
  if (values.fullName === "") throw errValidation("errors.nameRequired");
  if (values.phone && !PHONE_RE.test(values.phone)) throw errValidation("errors.phoneInvalid");
  if (values.phone) {
    const existing = excludeId
      ? db.first("SELECT id FROM members WHERE phone = ? AND id != ?", [values.phone, excludeId])
      : db.first("SELECT id FROM members WHERE phone = ?", [values.phone]);
    if (existing) throw errConflict("errors.phoneTaken", { phone: values.phone });
  }
  if (values.email && !EMAIL_RE.test(values.email)) throw errValidation("errors.emailInvalid");
  if (values.dateOfBirth) {
    if (!isValidDateKey(values.dateOfBirth)) throw errValidation("errors.invalidDate");
    if (values.dateOfBirth > todayKey()) throw errValidation("errors.dateInFuture");
  }
  if (values.heightCm != null && (values.heightCm < 50 || values.heightCm > 280)) {
    throw errValidation("errors.heightInvalid");
  }
  if (values.weightKg != null && (values.weightKg < 10 || values.weightKg > 500)) {
    throw errValidation("errors.weightInvalid");
  }
  if (
    values.emergencyContactPhone &&
    !PHONE_RE.test(values.emergencyContactPhone)
  ) {
    throw errValidation("errors.phoneInvalid");
  }
}

// Department isolation helpers live in ./department and are shared across
// member-scoped services; members.service re-exports them for callers that
// historically reached them through this module.
export {
  assertDepartmentAccess,
  departmentScopeCondition,
};

export async function createMember(
  db: Db,
  actor: ServiceActor,
  input: MemberInput & { registrationDate?: string },
): Promise<PublicMember> {
  requirePermission(actor, "members.create");
  const values = resolveValues(EMPTY_BASE, input);
  assertValidValues(db, values);
  const registrationDate = input.registrationDate ?? todayKey();
  if (!isValidDateKey(registrationDate)) throw errValidation("errors.invalidDate");

  const id = crypto.randomUUID();
  let memberCode = "";
  await db.transaction(async () => {
    const codeValue = bumpCounter(db, "member_code");
    memberCode = formatMemberCode(codeValue);
    db.run(
      "INSERT INTO members (id, member_code, full_name, phone, email, gender, date_of_birth, address, notes, height_cm, weight_kg, emergency_contact_name, emergency_contact_phone, department, registration_date, status, created_by, archived_at, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?)",
      [
        id,
        memberCode,
        values.fullName,
        values.phone,
        values.email,
        values.gender,
        values.dateOfBirth,
        values.address,
        values.notes,
        values.heightCm,
        values.weightKg,
        values.emergencyContactName,
        values.emergencyContactPhone,
        values.department,
        registrationDate,
        actor.userId,
        nowStamp(),
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "MEMBER_CREATED", "member", id, {
      memberCode,
      name: values.fullName,
    });
  });

  const row = getMemberRowById(db, id);
  if (!row) throw new Error("member vanished after insert");
  return toPublicMember(row);
}

export async function updateMember(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  patch: MemberInput,
): Promise<PublicMember> {
  requirePermission(actor, "members.edit");
  const row = getMemberRowById(db, memberId);
  if (!row) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, row.department);
  if (row.status === "archived") throw errValidation("errors.memberArchived");

  const values = resolveValues(
    {
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      gender: row.gender,
      dateOfBirth: row.date_of_birth,
      address: row.address,
      notes: row.notes,
      heightCm: row.height_cm == null ? null : Number(row.height_cm),
      weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
      emergencyContactName: row.emergency_contact_name,
      emergencyContactPhone: row.emergency_contact_phone,
      department: (row.department ?? "general") as DepartmentScope,
    },
    patch,
  );
  assertValidValues(db, values, memberId);

  await db.transaction(async () => {
    db.run(
      "UPDATE members SET full_name = ?, phone = ?, email = ?, gender = ?, date_of_birth = ?, address = ?, notes = ?, height_cm = ?, weight_kg = ?, emergency_contact_name = ?, emergency_contact_phone = ?, department = ?, updated_at = ? WHERE id = ?",
      [
        values.fullName,
        values.phone,
        values.email,
        values.gender,
        values.dateOfBirth,
        values.address,
        values.notes,
        values.heightCm,
        values.weightKg,
        values.emergencyContactName,
        values.emergencyContactPhone,
        values.department,
        nowStamp(),
        memberId,
      ],
    );
    recordAudit(db, actor, "MEMBER_UPDATED", "member", memberId, { name: values.fullName });
  });

  const fresh = getMemberRowById(db, memberId);
  if (!fresh) throw errNotFound("errors.memberNotFound");
  return toPublicMember(fresh);
}

export async function setMemberStatus(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  status: MemberStatus,
): Promise<PublicMember> {
  requirePermission(actor, "members.change_status");
  const row = getMemberRowById(db, memberId);
  if (!row) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, row.department);
  if (row.status === status) return toPublicMember(row);

  await db.transaction(async () => {
    db.run(
      "UPDATE members SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
      [status, status === "archived" ? nowStamp() : row.archived_at, nowStamp(), memberId],
    );
    recordAudit(
      db,
      actor,
      status === "archived" ? "MEMBER_ARCHIVED" : "MEMBER_STATUS_CHANGED",
      "member",
      memberId,
      { from: row.status, to: status },
    );
  });

  const fresh = getMemberRowById(db, memberId);
  if (!fresh) throw errNotFound("errors.memberNotFound");
  return toPublicMember(fresh);
}

export function listMembers(
  db: Db,
  actor: ServiceActor & { department?: DepartmentScope },
  query: MemberListQuery = {},
): { items: PublicMember[]; total: number } {
  requirePermission(actor, "members.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));
  const today = todayKey();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const scope = departmentScopeCondition(actor);
  if (scope.sql) conditions.push(scope.sql.replace(/^\s*AND\s*/, ""));
  if (scope.params.length) params.push(...scope.params);

  if (query.smart === "trash") {
    conditions.push("m.deleted_at IS NOT NULL");
  } else {
    conditions.push("m.deleted_at IS NULL");
  }

  const statusFilter = query.status ?? "active_only";
  if (query.smart !== "trash") {
    if (statusFilter === "active_only") {
      conditions.push("m.status != 'archived'");
    } else if (statusFilter !== "all") {
      conditions.push("m.status = ?");
      params.push(statusFilter);
    }
  }

  switch (query.smart) {
    case undefined:
    case "all":
    case "trash":
      break;
    case "active": {
      conditions.push(
        "EXISTS (SELECT 1 FROM member_subscriptions s WHERE s.member_id = m.id AND s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?)",
      );
      params.push(today, today);
      break;
    }
    case "expired": {
      conditions.push(
        "EXISTS (SELECT 1 FROM member_subscriptions s WHERE s.member_id = m.id AND s.status = 'active' AND s.end_date < ?) AND NOT EXISTS (SELECT 1 FROM member_subscriptions s2 WHERE s2.member_id = m.id AND s2.status = 'active' AND s2.end_date >= ?)",
      );
      params.push(today, today);
      break;
    }
    case "frozen":
      conditions.push(
        "EXISTS (SELECT 1 FROM member_subscriptions s WHERE s.member_id = m.id AND s.status = 'suspended')",
      );
      break;
    case "renewed":
      conditions.push("(SELECT COUNT(*) FROM member_subscriptions s WHERE s.member_id = m.id) >= 2");
      break;
    case "birthday":
      conditions.push(
        "m.date_of_birth IS NOT NULL AND substr(m.date_of_birth, 6) = substr(?, 6)",
      );
      params.push(today);
      break;
    case "inactive": {
      const days = Math.max(1, query.inactiveDays ?? 7);
      const threshold = `${addDaysKey(today, -days)} 23:59:59`;
      conditions.push(
        "COALESCE((SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL), '') <= ?",
      );
      params.push(threshold);
      conditions.push(
        "EXISTS (SELECT 1 FROM member_subscriptions s3 WHERE s3.member_id = m.id AND s3.status = 'active' AND s3.end_date >= ?)",
      );
      params.push(today);
      break;
    }
    case "sessions_low": {
      conditions.push(
        "EXISTS (SELECT 1 FROM member_subscriptions s JOIN membership_plans p ON p.id = s.plan_id\nWHERE s.member_id = m.id AND s.status = 'active' AND p.kind = 'sessions'\nAND (s.sessions_total - s.sessions_used) BETWEEN 0 AND 3)",
      );
      break;
    }
    case "outstanding": {
      conditions.push(
        "EXISTS (WITH paid AS (\nSELECT subscription_id, SUM(paid_amount_minor) AS paid_minor, SUM(discount_amount_minor) AS discount_minor FROM payments\nWHERE subscription_id IS NOT NULL AND status IN ('partial', 'paid') GROUP BY subscription_id\n)\nSELECT 1 FROM member_subscriptions s LEFT JOIN paid p ON p.subscription_id = s.id\nWHERE s.member_id = m.id AND s.status = 'active'\nGROUP BY s.member_id HAVING SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(p.paid_minor, 0) - COALESCE(p.discount_minor, 0), 0)) > 0)",
      );
      break;
    }
  }

  const search = query.search?.trim();
  if (search) {
    conditions.push("(m.full_name LIKE ? OR m.phone LIKE ? OR m.member_code LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM members m ${where}`, params);
  const rows = db.all<MemberRow>(
    `SELECT m.* FROM members m ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(toPublicMember), total };
}

export function searchMembersForPicker(
  db: Db,
  actor: ServiceActor,
  term: string,
  limit = 8,
): PublicMember[] {
  requirePermission(actor, "members.view");
  const like = `%${term.trim()}%`;
  return db
    .all<MemberRow>(
      "SELECT * FROM members WHERE status != 'archived' AND deleted_at IS NULL AND (full_name LIKE ? OR phone LIKE ? OR member_code LIKE ?)\nORDER BY full_name LIMIT ?",
      [like, like, like, limit],
    )
    .map(toPublicMember);
}

// ---------------------------------------------------------------------------
// Trash / recovery / purge
// ---------------------------------------------------------------------------

/** Soft-delete: keeps every historical relationship intact for recovery. */
export async function trashMember(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  reason?: string | null,
): Promise<PublicMember> {
  requirePermission(actor, "members.delete");
  const row = getMemberRowById(db, memberId);
  if (!row) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, row.department);
  if (row.deleted_at) throw errConflict("errors.memberAlreadyTrashed");

  await db.transaction(async () => {
    db.run(
      "UPDATE members SET deleted_at = ?, deleted_by = ?, deletion_reason = ?, updated_at = ? WHERE id = ?",
      [nowStamp(), actor.userId, reason?.trim() || null, nowStamp(), memberId],
    );
    recordAudit(db, actor, "MEMBER_TRASHED", "member", memberId, {
      memberCode: row.member_code,
      reason: reason?.trim() || null,
    });
  });

  return toPublicMember(getMemberRowById(db, memberId)!);
}

export async function restoreMember(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): Promise<PublicMember> {
  requirePermission(actor, "members.restore");
  const row = getMemberRowById(db, memberId);
  if (!row) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, row.department);
  if (!row.deleted_at) throw errValidation("errors.memberNotTrashed");

  await db.transaction(async () => {
    db.run(
      "UPDATE members SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, updated_at = ? WHERE id = ?",
      [nowStamp(), memberId],
    );
    recordAudit(db, actor, "MEMBER_RESTORED", "member", memberId, {
      memberCode: row.member_code,
    });
  });

  return toPublicMember(getMemberRowById(db, memberId)!);
}

/**
 * Hard delete for trashed members (members.purge). Intentionally cascades ALL
 * related history — payments, refunds, ledger rows, attendance, subscriptions,
 * freezes, cards, store sales/items/debts/repayments, CRM messages, bookings,
 * training plans, assessments, test results — in FK-safe order inside one
 * transaction so nothing references the purged member afterward. This is an
 * approved product decision (ADR-001 in .ai/decisions.md) that supersedes the
 * original refuse-on-history guard; the audit trail records MEMBER_PURGED with
 * the cascade count.
 */
export async function purgeMember(db: Db, actor: ServiceActor, memberId: string): Promise<void> {
  requirePermission(actor, "members.purge");
  const row = getMemberRowById(db, memberId);
  if (!row) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, row.department);
  if (!row.deleted_at) throw errValidation("errors.memberNotTrashed");

  const refs =
    db.first<{ cnt: number }>(
      "SELECT\n  (SELECT COUNT(*) FROM payments WHERE member_id = ?)\n+ (SELECT COUNT(*) FROM attendance WHERE member_id = ?)\n+ (SELECT COUNT(*) FROM member_subscriptions WHERE member_id = ?)\n+ (SELECT COUNT(*) FROM cards WHERE member_id = ?)\n+ (SELECT COUNT(*) FROM store_sales WHERE member_id = ?)\n+ (SELECT COUNT(*) FROM store_debts WHERE member_id = ?) AS cnt",
      [memberId, memberId, memberId, memberId, memberId, memberId],
    )?.cnt ?? 0;

  await db.transaction(async () => {
    db.run("DELETE FROM store_debt_payments WHERE debt_id IN (SELECT id FROM store_debts WHERE member_id = ?)", [memberId]);
    db.run("DELETE FROM payment_refunds WHERE payment_id IN (SELECT id FROM payments WHERE member_id = ?)", [memberId]);
    db.run("DELETE FROM financial_ledger WHERE (ref_table = 'payments' AND ref_id IN (SELECT id FROM payments WHERE member_id = ?)) OR (ref_table = 'store_sales' AND ref_id IN (SELECT id FROM store_sales WHERE member_id = ?))", [memberId, memberId]);
    db.run("DELETE FROM crm_messages WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM subscription_freezes WHERE subscription_id IN (SELECT id FROM member_subscriptions WHERE member_id = ?)", [memberId]);
    db.run("DELETE FROM class_bookings WHERE member_id = ? OR consumed_subscription_id IN (SELECT id FROM member_subscriptions WHERE member_id = ?)", [memberId, memberId]);
    db.run("DELETE FROM attendance WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM payments WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM store_debts WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM store_sale_items WHERE sale_id IN (SELECT id FROM store_sales WHERE member_id = ?)", [memberId]);
    db.run("DELETE FROM store_sales WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM member_subscriptions WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM cards WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM training_plans WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM body_assessments WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM fitness_test_results WHERE member_id = ?", [memberId]);
    db.run("DELETE FROM members WHERE id = ?", [memberId]);
    let filesRemoved = 0;
    if (row.photo_file_id) {
      db.run("DELETE FROM files WHERE id = ?", [String(row.photo_file_id)]);
      filesRemoved = 1;
    }
    recordAudit(db, actor, "MEMBER_PURGED", "member", null, {
      memberCode: row.member_code,
      name: row.full_name,
      cascadeCount: Number(refs),
      filesRemoved,
    });
  });
}

export interface TrashedMemberInfo extends PublicMember {
  deletedBy: string | null;
  deletionReason: string | null;
}

export function listTrashedMembers(
  db: Db,
  actor: ServiceActor & { department?: DepartmentScope },
): TrashedMemberInfo[] {
  requirePermission(actor, "members.restore");
  const scope = departmentScopeCondition(actor);
  const rows = db.all<Row>(
    `SELECT m.*, u.username AS deleted_by_name FROM members m LEFT JOIN users u ON u.id = m.deleted_by\nWHERE m.deleted_at IS NOT NULL${scope.sql} ORDER BY m.deleted_at DESC`,
    scope.params,
  );
  return rows.map((row) => ({
    ...toPublicMember(row as unknown as MemberRow),
    deletedBy: row.deleted_by_name == null ? null : String(row.deleted_by_name),
    deletionReason: row.deletion_reason == null ? null : String(row.deletion_reason),
  }));
}


