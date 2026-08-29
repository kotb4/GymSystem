import { errConflict, errNotFound, errValidation } from "@/core/errors";
import {
  requirePermission,
  type DepartmentScope,
  type ServiceActor,
} from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp, todayKey, isValidDateKey } from "@/core/dates";
import { PHONE_RE, EMAIL_RE, createMember, getMemberRowById } from "./members.service";
import { getPlanRow } from "./plans.service";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, departmentScopeCondition } from "./department";

const SOURCES = [
  "facebook",
  "instagram",
  "whatsapp",
  "referral",
  "walk_in",
  "existing_member",
  "other",
] as const;
export type LeadSource = (typeof SOURCES)[number];

const STATUSES = ["new", "contacted", "interested", "trial", "joined", "lost"] as const;
export type LeadStatus = (typeof STATUSES)[number];

const DEPARTMENTS: readonly DepartmentScope[] = ["general", "men", "women"];

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

interface LeadRow extends Row {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  interested_plan_id: string | null;
  department: string;
  assigned_employee_id: string | null;
  assigned_user_id: string | null;
  status: string;
  notes: string | null;
  lost_reason: string | null;
  converted_member_id: string | null;
  contacted_at: string | null;
  interested_at: string | null;
  trial_at: string | null;
  joined_at: string | null;
  lost_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  plan_name: string | null;
  employee_name: string | null;
}

export interface Lead {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  interestedPlanId: string | null;
  interestedPlanName: string | null;
  department: DepartmentScope;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  status: LeadStatus;
  notes: string | null;
  lostReason: string | null;
  convertedMemberId: string | null;
  contactedAt: string | null;
  interestedAt: string | null;
  trialAt: string | null;
  joinedAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const LEAD_SELECT =
  "SELECT l.*, p.name AS plan_name, e.full_name AS employee_name\nFROM leads l\nLEFT JOIN membership_plans p ON p.id = l.interested_plan_id\nLEFT JOIN employees e ON e.id = l.assigned_employee_id";

function mapLead(r: Row): Lead {
  return {
    id: str(r.id),
    fullName: str(r.full_name),
    phone: r.phone == null ? null : str(r.phone),
    email: r.email == null ? null : str(r.email),
    source: str(r.source) as LeadSource,
    interestedPlanId: r.interested_plan_id == null ? null : str(r.interested_plan_id),
    interestedPlanName: r.plan_name == null ? null : str(r.plan_name),
    department: (str(r.department) || "general") as DepartmentScope,
    assignedEmployeeId: r.assigned_employee_id == null ? null : str(r.assigned_employee_id),
    assignedEmployeeName: r.employee_name == null ? null : str(r.employee_name),
    status: str(r.status) as LeadStatus,
    notes: r.notes == null ? null : str(r.notes),
    lostReason: r.lost_reason == null ? null : str(r.lost_reason),
    convertedMemberId: r.converted_member_id == null ? null : str(r.converted_member_id),
    contactedAt: r.contacted_at == null ? null : str(r.contacted_at),
    interestedAt: r.interested_at == null ? null : str(r.interested_at),
    trialAt: r.trial_at == null ? null : str(r.trial_at),
    joinedAt: r.joined_at == null ? null : str(r.joined_at),
    lostAt: r.lost_at == null ? null : str(r.lost_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function getLeadRow(db: Db, leadId: string, actor: ServiceActor): LeadRow {
  const row = db.first<LeadRow>(`${LEAD_SELECT} WHERE l.id = ?`, [leadId]);
  if (!row) throw errNotFound("errors.leadNotFound");
  assertDepartmentAccess(actor, row.department);
  return row;
}

// --------------------------- activity helper ------------------------------

function recordActivity(
  db: Db,
  actor: ServiceActor,
  leadId: string,
  action: string,
  note?: string,
): void {
  db.run(
    "INSERT INTO lead_activity (id, lead_id, action, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), leadId, action, note ?? null, actor.userId, stamp()],
  );
}

// ----------------------------- create / update -----------------------------

export interface LeadInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  source: LeadSource;
  interestedPlanId?: string | null;
  department?: DepartmentScope;
  assignedEmployeeId?: string | null;
  notes?: string | null;
}

function assertValidNewLead(db: Db, input: LeadInput): { phone: string | null; email: string | null } {
  const name = input.fullName.trim();
  if (name === "") throw errValidation("errors.leadNameRequired");
  if (!SOURCES.includes(input.source)) throw errValidation("errors.leadSourceInvalid");
  if (input.department && !DEPARTMENTS.includes(input.department)) {
    throw errValidation("errors.leadSourceInvalid");
  }

  const phone = input.phone?.trim() || null;
  if (phone && !PHONE_RE.test(phone)) throw errValidation("errors.leadPhoneInvalid");

  const email = input.email?.trim() || null;
  if (email && !EMAIL_RE.test(email)) throw errValidation("errors.leadEmailInvalid");

  if (input.interestedPlanId) {
    const plan = getPlanRow(db, input.interestedPlanId);
    if (!plan || num(plan.is_active, 1) !== 1) throw errValidation("errors.leadInterestedPlanInvalid");
  }

  if (input.assignedEmployeeId) {
    assertValidAssignee(db, input.assignedEmployeeId, input.department ?? "general");
  }

  return { phone, email };
}

function assertValidAssignee(db: Db, employeeId: string, leadDepartment: DepartmentScope): void {
  const emp = db.first<Row>("SELECT * FROM employees WHERE id = ?", [employeeId]);
  if (!emp) throw errNotFound("errors.employeeNotFound");
  if (num(emp.is_active, 1) !== 1) throw errValidation("errors.leadSourceInvalid");
  const empDept = (str(emp.department) || "general") as DepartmentScope;
  if (empDept !== "general" && empDept !== leadDepartment) {
    throw errValidation("errors.leadSourceInvalid");
  }
}

export async function createLead(db: Db, actor: ServiceActor, input: LeadInput): Promise<Lead> {
  requirePermission(actor, "leads.manage");
  const { phone, email } = assertValidNewLead(db, input);
  const department: DepartmentScope = input.department ?? "general";
  assertDepartmentAccess(actor, department);

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO leads (id, full_name, phone, email, source, interested_plan_id, department, assigned_employee_id, assigned_user_id, status, notes, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)",
      [
        id,
        input.fullName.trim(),
        phone,
        email,
        input.source,
        input.interestedPlanId ?? null,
        department,
        input.assignedEmployeeId ?? null,
        actor.userId,
        input.notes?.trim() || null,
        actor.userId,
        stamp(),
        stamp(),
      ],
    );
    recordActivity(db, actor, id, "lead.created", input.fullName.trim());
    recordAudit(db, actor, "LEAD_CREATED", "lead", id, { name: input.fullName.trim() });
  });
  return mapLead(getLeadRow(db, id, actor));
}

function statusTimestampColumn(status: LeadStatus): string {
  switch (status) {
    case "contacted":
      return "contacted_at";
    case "interested":
      return "interested_at";
    case "trial":
      return "trial_at";
    case "joined":
      return "joined_at";
    case "lost":
      return "lost_at";
    default:
      return "";
  }
}

export async function updateLead(
  db: Db,
  actor: ServiceActor,
  leadId: string,
  patch: {
    fullName?: string;
    phone?: string | null;
    email?: string | null;
    source?: LeadSource;
    interestedPlanId?: string | null;
    department?: DepartmentScope;
    assignedEmployeeId?: string | null;
    notes?: string | null;
    status?: LeadStatus;
    lostReason?: string | null;
  },
): Promise<Lead> {
  requirePermission(actor, "leads.manage");
  const row = getLeadRow(db, leadId, actor);
  if (row.converted_member_id) throw errValidation("errors.leadAlreadyConverted");

  const fullName = (patch.fullName ?? row.full_name).trim();
  if (fullName === "") throw errValidation("errors.leadNameRequired");

  const source = patch.source ?? (row.source as LeadSource);
  if (!SOURCES.includes(source)) throw errValidation("errors.leadSourceInvalid");

  const phone = patch.phone === undefined ? row.phone : patch.phone?.trim() || null;
  if (phone && !PHONE_RE.test(phone)) throw errValidation("errors.leadPhoneInvalid");

  const email = patch.email === undefined ? row.email : patch.email?.trim() || null;
  if (email && !EMAIL_RE.test(email)) throw errValidation("errors.leadEmailInvalid");

  const department: DepartmentScope =
    patch.department && DEPARTMENTS.includes(patch.department)
      ? patch.department
      : (row.department as DepartmentScope);
  if (department !== (row.department as DepartmentScope)) assertDepartmentAccess(actor, department);

  const interestedPlanId =
    patch.interestedPlanId === undefined ? row.interested_plan_id : patch.interestedPlanId || null;
  if (interestedPlanId) {
    const plan = getPlanRow(db, interestedPlanId);
    if (!plan || num(plan.is_active, 1) !== 1) throw errValidation("errors.leadInterestedPlanInvalid");
  }

  if (patch.assignedEmployeeId !== undefined && patch.assignedEmployeeId) {
    assertValidAssignee(db, patch.assignedEmployeeId, department);
  }
  const assignedEmployeeId =
    patch.assignedEmployeeId === undefined ? row.assigned_employee_id : patch.assignedEmployeeId || null;

  const newStatus: LeadStatus = patch.status ?? (row.status as LeadStatus);
  if (!STATUSES.includes(newStatus)) throw errValidation("errors.leadStatusInvalid");
  const oldStatus = row.status as LeadStatus;

  const notes = patch.notes === undefined ? row.notes : patch.notes?.trim() || null;
  const lostReason = patch.lostReason === undefined ? row.lost_reason : patch.lostReason?.trim() || null;

  const tsColumn = statusTimestampColumn(newStatus);
  const now = nowStamp();

  await db.transaction(() => {
    let setSql =
      "SET full_name = ?, phone = ?, email = ?, source = ?, interested_plan_id = ?, department = ?, assigned_employee_id = ?, notes = ?, lost_reason = ?, status = ?, updated_at = ?";
    const params: Array<string | number | null> = [
      fullName,
      phone,
      email,
      source,
      interestedPlanId,
      department,
      assignedEmployeeId,
      notes,
      lostReason,
      newStatus,
      now,
    ];
    if (tsColumn) {
      setSql += `, ${tsColumn} = ?`;
      params.push(now);
    }
    params.push(row.id);
    db.run(`UPDATE leads ${setSql} WHERE id = ?`, params);
    if (oldStatus !== newStatus) {
      recordActivity(db, actor, row.id, `lead.status_${newStatus}`, `من ${oldStatus} إلى ${newStatus}`);
      recordAudit(db, actor, "LEAD_STATUS_CHANGED", "lead", row.id, {
        from: oldStatus,
        to: newStatus,
      });
    } else {
      recordActivity(db, actor, row.id, "lead.updated", "");
    }
    if (assignedEmployeeId !== row.assigned_employee_id) {
      recordAudit(db, actor, "LEAD_ASSIGNED", "lead", row.id, {
        employeeId: assignedEmployeeId ?? null,
      });
    }
    recordAudit(db, actor, "LEAD_UPDATED", "lead", row.id, { name: fullName });
  });

  return mapLead(getLeadRow(db, row.id, actor));
}

// --------------------------------- list -----------------------------------

export interface LeadListQuery {
  status?: LeadStatus | "all";
  source?: LeadSource | "all";
  department?: DepartmentScope | "all";
  search?: string;
  assignedEmployeeId?: string;
  page?: number;
  pageSize?: number;
}

export interface LeadListResult {
  items: Lead[];
  total: number;
}

export function listLeads(db: Db, actor: ServiceActor, query: LeadListQuery = {}): LeadListResult {
  requirePermission(actor, "leads.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status && query.status !== "all") {
    conditions.push("l.status = ?");
    params.push(query.status);
  }
  if (query.source && query.source !== "all") {
    conditions.push("l.source = ?");
    params.push(query.source);
  }
  if (query.department && query.department !== "all") {
    conditions.push("l.department = ?");
    params.push(query.department);
  }
  if (query.assignedEmployeeId) {
    conditions.push("l.assigned_employee_id = ?");
    params.push(query.assignedEmployeeId);
  }
  const search = query.search?.trim();
  if (search) {
    conditions.push("(l.full_name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const scope = departmentScopeCondition(actor, "l");
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^\s*AND\s+/, ""));
    params.push(...scope.params);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = num(db.scalar(`SELECT COUNT(*) FROM leads l ${where}`, params));
  const items = db
    .all<Row>(`${LEAD_SELECT} ${where} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`, [
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ])
    .map(mapLead);
  return { items, total };
}

export function getLead(db: Db, actor: ServiceActor, leadId: string): Lead {
  requirePermission(actor, "leads.view");
  return mapLead(getLeadRow(db, leadId, actor));
}

export async function deleteLead(db: Db, actor: ServiceActor, leadId: string): Promise<void> {
  requirePermission(actor, "leads.manage");
  const row = getLeadRow(db, leadId, actor);
  await db.transaction(() => {
    db.run("DELETE FROM leads WHERE id = ?", [row.id]);
    recordAudit(db, actor, "LEAD_DELETED", "lead", row.id, { name: row.full_name });
  });
}

// ------------------------------ follow-ups --------------------------------

export interface FollowupRow extends Row {
  id: string;
  lead_id: string;
  due_date: string;
  due_time: string | null;
  note: string | null;
  done: number;
  done_at: string | null;
  done_by: string | null;
  created_by: string | null;
  created_at: string;
  lead_name: string | null;
}

export interface LeadFollowup {
  id: string;
  leadId: string;
  leadName: string;
  dueDate: string;
  dueTime: string | null;
  note: string | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

const FOLLOWUP_SELECT =
  "SELECT f.*, l.full_name AS lead_name\nFROM lead_followups f\nJOIN leads l ON l.id = f.lead_id";

function mapFollowup(r: Row): LeadFollowup {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    leadName: str(r.lead_name),
    dueDate: str(r.due_date),
    dueTime: r.due_time == null ? null : str(r.due_time),
    note: r.note == null ? null : str(r.note),
    done: num(r.done) === 1,
    doneAt: r.done_at == null ? null : str(r.done_at),
    createdAt: str(r.created_at),
  };
}

export function listFollowups(db: Db, actor: ServiceActor, leadId: string): LeadFollowup[] {
  requirePermission(actor, "leads.view");
  getLeadRow(db, leadId, actor);
  return db
    .all<Row>(`${FOLLOWUP_SELECT} WHERE f.lead_id = ? ORDER BY f.done ASC, f.due_date ASC, f.due_time ASC`, [
      leadId,
    ])
    .map(mapFollowup);
}

export interface FollowupInput {
  dueDate: string;
  dueTime?: string | null;
  note?: string | null;
}

export async function addFollowup(
  db: Db,
  actor: ServiceActor,
  leadId: string,
  input: FollowupInput,
): Promise<LeadFollowup> {
  requirePermission(actor, "leads.manage");
  const row = getLeadRow(db, leadId, actor);
  if (!isValidDateKey(input.dueDate)) throw errValidation("errors.invalidDate");
  const dueTime = input.dueTime?.trim() || null;
  const note = input.note?.trim() || null;

  const id = crypto.randomUUID();
  await db.transaction(() => {
    db.run(
      "INSERT INTO lead_followups (id, lead_id, due_date, due_time, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, row.id, input.dueDate, dueTime, note, actor.userId, stamp()],
    );
    recordActivity(db, actor, row.id, "lead.followup_added", note ?? input.dueDate);
    recordAudit(db, actor, "LEAD_FOLLOWUP_ADDED", "lead", row.id, { dueDate: input.dueDate });
  });
  return mapFollowup(db.first<Row>(`${FOLLOWUP_SELECT} WHERE f.id = ?`, [id])!);
}

export async function updateFollowup(
  db: Db,
  actor: ServiceActor,
  followupId: string,
  patch: { dueDate?: string; dueTime?: string | null; note?: string | null },
): Promise<LeadFollowup> {
  requirePermission(actor, "leads.manage");
  const f = db.first<Row>("SELECT * FROM lead_followups WHERE id = ?", [followupId]);
  if (!f) throw errNotFound("errors.leadNotFound");
  getLeadRow(db, str(f.lead_id), actor);

  const dueDate = patch.dueDate ?? str(f.due_date);
  if (!isValidDateKey(dueDate)) throw errValidation("errors.invalidDate");
  const dueTime = patch.dueTime === undefined ? (f.due_time == null ? null : str(f.due_time)) : patch.dueTime?.trim() || null;
  const note = patch.note === undefined ? (f.note == null ? null : str(f.note)) : patch.note?.trim() || null;

  db.run("UPDATE lead_followups SET due_date = ?, due_time = ?, note = ? WHERE id = ?", [
    dueDate,
    dueTime,
    note,
    followupId,
  ]);
  recordAudit(db, actor, "LEAD_FOLLOWUP_UPDATED", "lead", str(f.lead_id), { followupId });
  return mapFollowup(db.first<Row>(`${FOLLOWUP_SELECT} WHERE f.id = ?`, [followupId])!);
}

export async function completeFollowup(
  db: Db,
  actor: ServiceActor,
  followupId: string,
  done = true,
): Promise<LeadFollowup> {
  requirePermission(actor, "leads.manage");
  const f = db.first<Row>("SELECT * FROM lead_followups WHERE id = ?", [followupId]);
  if (!f) throw errNotFound("errors.leadNotFound");
  getLeadRow(db, str(f.lead_id), actor);

  await db.transaction(() => {
    if (done) {
      db.run("UPDATE lead_followups SET done = 1, done_at = ?, done_by = ? WHERE id = ?", [
        stamp(),
        actor.userId,
        followupId,
      ]);
      recordAudit(db, actor, "LEAD_FOLLOWUP_DONE", "lead", str(f.lead_id), { followupId });
    } else {
      db.run("UPDATE lead_followups SET done = 0, done_at = NULL, done_by = NULL WHERE id = ?", [
        followupId,
      ]);
    }
  });
  return mapFollowup(db.first<Row>(`${FOLLOWUP_SELECT} WHERE f.id = ?`, [followupId])!);
}

export function todayFollowups(db: Db, actor: ServiceActor): LeadFollowup[] {
  requirePermission(actor, "leads.view");
  const today = todayKey();
  const scope = departmentScopeCondition(actor, "l");
  const scopeSql = scope.sql ?? "";
  const params = [...scope.params];
  return db
    .all<Row>(
      `${FOLLOWUP_SELECT} WHERE f.done = 0 AND f.due_date <= ? ${scopeSql} ORDER BY f.due_date ASC, f.due_time ASC`,
      [today, ...params],
    )
    .map(mapFollowup);
}

// ------------------------------- activity ---------------------------------

export interface LeadActivityRow extends Row {
  id: string;
  lead_id: string;
  action: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  author_name: string | null;
}

export interface LeadActivity {
  id: string;
  leadId: string;
  action: string;
  note: string | null;
  authorName: string | null;
  createdAt: string;
}

export function listActivity(db: Db, actor: ServiceActor, leadId: string): LeadActivity[] {
  requirePermission(actor, "leads.view");
  getLeadRow(db, leadId, actor);
  return db
    .all<Row>(
      "SELECT a.*, u.full_name AS author_name FROM lead_activity a LEFT JOIN users u ON u.id = a.created_by WHERE a.lead_id = ? ORDER BY a.created_at DESC",
      [leadId],
    )
    .map((r) => ({
      id: str(r.id),
      leadId: str(r.lead_id),
      action: str(r.action),
      note: r.note == null ? null : str(r.note),
      authorName: r.author_name == null ? null : str(r.author_name),
      createdAt: str(r.created_at),
    }));
}

export async function addActivity(
  db: Db,
  actor: ServiceActor,
  leadId: string,
  action: string,
  note?: string,
): Promise<void> {
  requirePermission(actor, "leads.manage");
  getLeadRow(db, leadId, actor);
  recordActivity(db, actor, leadId, action, note);
}

// ------------------------------- conversion --------------------------------

export interface ConvertLeadResult {
  memberId: string;
  memberCode: string;
  memberName: string;
  linkedExisting: boolean;
}

export async function convertLead(
  db: Db,
  actor: ServiceActor,
  input: { leadId: string; existingMemberId?: string },
): Promise<ConvertLeadResult> {
  requirePermission(actor, "leads.manage");
  requirePermission(actor, "members.create");
  const row = getLeadRow(db, input.leadId, actor);
  if (row.converted_member_id) throw errConflict("errors.leadAlreadyConverted");

  if (input.existingMemberId) {
    const existing = getMemberRowById(db, input.existingMemberId);
    if (!existing) throw errNotFound("errors.memberNotFound");
    assertDepartmentAccess(actor, existing.department);
    await db.transaction(() => {
      db.run(
        "UPDATE leads SET converted_member_id = ?, status = 'joined', joined_at = ?, updated_at = ? WHERE id = ?",
        [existing.id, stamp(), stamp(), row.id],
      );
      recordActivity(db, actor, row.id, "lead.converted", existing.member_code);
      recordAudit(db, actor, "LEAD_CONVERTED", "lead", row.id, {
        memberId: existing.id,
        memberCode: existing.member_code,
        linkedExisting: 1,
      });
    });
    return {
      memberId: existing.id,
      memberCode: str(existing.member_code),
      memberName: str(existing.full_name),
      linkedExisting: true,
    };
  }

  const phone = row.phone == null ? null : str(row.phone) || null;
  if (phone) {
    const dup = db.first<Row>(
      "SELECT id, full_name, member_code FROM members WHERE phone = ? AND deleted_at IS NULL",
      [phone],
    );
    if (dup) {
      throw errConflict("errors.leadDuplicatePhone", {
        member: str(dup.full_name),
        code: str(dup.member_code),
      });
    }
  }

  const member = await createMember(db, actor, {
    fullName: row.full_name,
    phone: row.phone == null ? null : str(row.phone) || null,
    email: row.email == null ? null : str(row.email) || null,
    department: (row.department as DepartmentScope) ?? "general",
  });

  await db.transaction(() => {
    db.run(
      "UPDATE leads SET converted_member_id = ?, status = 'joined', joined_at = ?, updated_at = ? WHERE id = ?",
      [member.id, stamp(), stamp(), row.id],
    );
    recordActivity(db, actor, row.id, "lead.converted", member.memberCode);
    recordAudit(db, actor, "LEAD_CONVERTED", "lead", row.id, {
      memberId: member.id,
      memberCode: member.memberCode,
      linkedExisting: 0,
    });
  });

  return {
    memberId: member.id,
    memberCode: member.memberCode,
    memberName: member.fullName,
    linkedExisting: false,
  };
}

// -------------------------------- stats -----------------------------------

interface CountRow extends Row {
  v: string;
  c: number;
}

export interface LeadStats {
  total: number;
  byStatus: Record<LeadStatus, number>;
  bySource: Record<LeadSource, number>;
  newThisMonth: number;
  joined: number;
  lost: number;
  conversionRate: number;
  dueFollowups: number;
  todayFollowupsCount: number;
}

function bucketize(rows: Array<{ v: string; c: number }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.v] = r.c;
    return acc;
  }, {});
}

export function leadStats(db: Db, actor: ServiceActor): LeadStats {
  requirePermission(actor, "leads.view");
  const scope = departmentScopeCondition(actor, "l");
  const scopeWhere = scope.sql ? "WHERE " + scope.sql.replace(/^\s*AND\s+/, "") : "";
  const scopeParams = scope.params;

  const total = num(db.scalar(`SELECT COUNT(*) FROM leads l ${scopeWhere}`, scopeParams));

  const byStatus = bucketize(
    db.all<CountRow>(`SELECT l.status AS v, COUNT(*) AS c FROM leads l ${scopeWhere} GROUP BY l.status`, scopeParams),
  );
  const bySource = bucketize(
    db.all<CountRow>(`SELECT l.source AS v, COUNT(*) AS c FROM leads l ${scopeWhere} GROUP BY l.source`, scopeParams),
  );

  for (const s of STATUSES) if (!(s in byStatus)) byStatus[s] = 0;
  for (const s of SOURCES) if (!(s in bySource)) bySource[s] = 0;

  const monthKey = todayKey().slice(0, 7);
  const newThisMonth = num(
    db.scalar(`SELECT COUNT(*) FROM leads l WHERE substr(l.created_at,1,7) = ? ${scopeWhere}`, [
      monthKey,
      ...scopeParams,
    ]),
  );
  const joined = byStatus["joined"] ?? 0;
  const lost = byStatus["lost"] ?? 0;
  const conversionRate = total > 0 ? Math.round((joined / total) * 1000) / 10 : 0;

  const dueFollowups = num(
    db.scalar(
      `SELECT COUNT(*) FROM lead_followups f JOIN leads l ON l.id = f.lead_id WHERE f.done = 0 AND f.due_date <= ? ${scope.sql ?? ""}`,
      [todayKey(), ...scopeParams],
    ),
  );

  return {
    total,
    byStatus: byStatus as Record<LeadStatus, number>,
    bySource: bySource as Record<LeadSource, number>,
    newThisMonth,
    joined,
    lost,
    conversionRate,
    dueFollowups,
    todayFollowupsCount: dueFollowups,
  };
}
