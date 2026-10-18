import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, roleHasPermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { consumeSession } from "./attendance.service";
import { assertDepartmentAccess, memberDepartmentById } from "./department";
import { createExpense } from "./expenses.service";
import { getLocalBranchId } from "@/core/branch";

type Num = string | number;
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// ------------------------------- classes ---------------------------------

export type CombatDiscipline =
  | "mma"
  | "boxing"
  | "kickboxing"
  | "muay_thai"
  | "karate"
  | "taekwondo"
  | "wrestling"
  | "judo"
  | "bjj"
  | "kung_fu"
  | "self_defense"
  | "combat_fitness"
  | "general";

export type TargetCategory = "kids" | "teens" | "adults" | "ladies" | "all";
export type CombatLevel = "beginner" | "intermediate" | "advanced" | "all_levels";

export const DOW_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export interface ClassScheduleSlot {
  dayOfWeek: number; // 0=Sun..6=Sat
  dayNameAr?: string;
  startTime: string; // e.g. "17:00"
  endTime?: string;   // e.g. "18:30"
}

export function formatScheduleText(slots: ClassScheduleSlot[]): string {
  if (!slots || slots.length === 0) return "";
  return slots
    .map((s) => {
      const day = DOW_NAMES_AR[s.dayOfWeek] || `يوم ${s.dayOfWeek}`;
      const time = s.endTime ? `${s.startTime} - ${s.endTime}` : s.startTime;
      return `${day} (${time})`;
    })
    .join("، ");
}

export function parseScheduleSlots(raw: unknown): ClassScheduleSlot[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        dayOfWeek: Number(item.dayOfWeek ?? 0),
        dayNameAr: DOW_NAMES_AR[Number(item.dayOfWeek ?? 0)],
        startTime: String(item.startTime ?? ""),
        endTime: item.endTime ? String(item.endTime) : undefined,
      }));
    }
  } catch {
    /* fallback empty */
  }
  return [];
}

export interface ClassInput {
  name: string;
  discipline?: CombatDiscipline;
  category?: TargetCategory;
  level?: CombatLevel;
  description?: string | null;
  trainerId?: string | null;
  location?: string | null;
  capacity: number;
  consumesSession?: boolean;
  planId?: string | null;
  defaultTrainerFeeMinor?: number;
  scheduleSlots?: ClassScheduleSlot[];
}

export interface GymClass {
  id: string;
  name: string;
  discipline: CombatDiscipline;
  category: TargetCategory;
  level: CombatLevel;
  description: string | null;
  trainerId: string | null;
  trainerName: string | null;
  location: string | null;
  capacity: number;
  consumesSession: boolean;
  isActive: boolean;
  planId: string | null;
  planName: string | null;
  planPrice: number | null;
  defaultTrainerFeeMinor: number;
  scheduleSlots: ClassScheduleSlot[];
  scheduleText: string;
}

const CLASS_SELECT =
  "SELECT c.*, t.full_name AS trainer_name, p.name AS plan_name, p.price AS plan_price FROM classes c LEFT JOIN trainers t ON t.id = c.trainer_id LEFT JOIN membership_plans p ON p.id = c.plan_id";

function mapClass(r: Row): GymClass {
  const slots = parseScheduleSlots(r.schedule_json);
  return {
    id: str(r.id),
    name: str(r.name),
    discipline: (r.discipline ? str(r.discipline) : "general") as CombatDiscipline,
    category: (r.category ? str(r.category) : "all") as TargetCategory,
    level: (r.level ? str(r.level) : "all_levels") as CombatLevel,
    description: r.description == null ? null : str(r.description),
    trainerId: r.trainer_id == null ? null : str(r.trainer_id),
    trainerName: r.trainer_name == null ? null : str(r.trainer_name),
    location: r.location == null ? null : str(r.location),
    capacity: num(r.capacity),
    consumesSession: num(r.consumes_session) === 1,
    isActive: num(r.is_active, 1) === 1,
    planId: r.plan_id == null ? null : str(r.plan_id),
    planName: r.plan_name == null ? null : str(r.plan_name),
    planPrice: r.plan_price == null ? null : num(r.plan_price),
    defaultTrainerFeeMinor: num(r.default_trainer_fee_minor),
    scheduleSlots: slots,
    scheduleText: formatScheduleText(slots),
  };
}

export function listClasses(
  db: Db,
  actor: ServiceActor,
  query: { search?: string; includeInactive?: boolean; discipline?: string; category?: string } = {},
): GymClass[] {
  requirePermission(actor, "classes.view");
  const conditions: string[] = [];
  const params: Num[] = [];
  if (!query.includeInactive) conditions.push("c.is_active = 1");
  if (query.discipline && query.discipline !== "all") {
    conditions.push("c.discipline = ?");
    params.push(query.discipline);
  }
  if (query.category && query.category !== "all") {
    conditions.push("c.category = ?");
    params.push(query.category);
  }
  const search = query.search?.trim();
  if (search) {
    conditions.push("(c.name LIKE ? OR c.location LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.all<Row>(`${CLASS_SELECT} ${where} ORDER BY c.name`, params).map(mapClass);
}

function getClassRow(db: Db, classId: string): Row {
  const row = db.first<Row>(`${CLASS_SELECT} WHERE c.id = ?`, [classId]);
  if (!row) throw errNotFound("errors.classNotFound");
  return row;
}

export async function createClass(db: Db, actor: ServiceActor, input: ClassInput): Promise<GymClass> {
  requirePermission(actor, "classes.manage");
  const name = input.name.trim();
  if (name.length < 2) throw errValidation("errors.classNameShort");
  const capacity = Math.floor(Number(input.capacity));
  if (capacity <= 0) throw errValidation("errors.classCapacityInvalid");
  const discipline = input.discipline ?? "general";
  const category = input.category ?? "all";
  const level = input.level ?? "all_levels";
  const planId = input.planId ?? null;
  const defaultTrainerFeeMinor = Math.max(0, Math.floor(Number(input.defaultTrainerFeeMinor ?? 0)));
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO classes (id, name, discipline, category, level, description, trainer_id, location, capacity, consumes_session, plan_id, default_trainer_fee_minor, schedule_json, is_active, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      [
        id,
        name,
        discipline,
        category,
        level,
        input.description?.trim() || null,
        input.trainerId ?? null,
        input.location?.trim() || null,
        capacity,
        input.consumesSession ? 1 : 0,
        planId,
        defaultTrainerFeeMinor,
        input.scheduleSlots && input.scheduleSlots.length > 0 ? JSON.stringify(input.scheduleSlots) : null,
        actor.userId,
        stamp(),
        stamp(),
      ],
    );
    recordAudit(db, actor, "CLASS_CREATED", "class", id, { name, discipline, category });
  });
  return mapClass(getClassRow(db, id));
}

export async function updateClass(
  db: Db,
  actor: ServiceActor,
  classId: string,
  patch: Partial<ClassInput> & { isActive?: boolean },
): Promise<GymClass> {
  requirePermission(actor, "classes.manage");
  const current = getClassRow(db, classId);
  if (patch.capacity !== undefined && Math.floor(patch.capacity) <= 0)
    throw errValidation("errors.classCapacityInvalid");
  const discipline = patch.discipline !== undefined ? patch.discipline : (current.discipline ? str(current.discipline) : "general");
  const category = patch.category !== undefined ? patch.category : (current.category ? str(current.category) : "all");
  const level = patch.level !== undefined ? patch.level : (current.level ? str(current.level) : "all_levels");
  const planId = patch.planId !== undefined ? patch.planId : (current.plan_id ? str(current.plan_id) : null);
  const defaultTrainerFeeMinor = patch.defaultTrainerFeeMinor !== undefined
    ? Math.max(0, Math.floor(Number(patch.defaultTrainerFeeMinor)))
    : num(current.default_trainer_fee_minor);

  await db.transaction(async () => {
    db.run(
      "UPDATE classes SET name = ?, discipline = ?, category = ?, level = ?, description = ?, trainer_id = ?, location = ?, capacity = ?, consumes_session = ?, plan_id = ?, default_trainer_fee_minor = ?, schedule_json = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [
        patch.name?.trim() ?? str(current.name),
        discipline,
        category,
        level,
        patch.description !== undefined ? patch.description?.trim() || null : current.description,
        patch.trainerId !== undefined ? patch.trainerId : current.trainer_id,
        patch.location !== undefined ? patch.location?.trim() || null : current.location,
        patch.capacity !== undefined ? Math.floor(patch.capacity) : num(current.capacity),
        patch.consumesSession !== undefined ? (patch.consumesSession ? 1 : 0) : num(current.consumes_session),
        planId,
        defaultTrainerFeeMinor,
        patch.scheduleSlots !== undefined ? (patch.scheduleSlots.length > 0 ? JSON.stringify(patch.scheduleSlots) : null) : (current.schedule_json ? str(current.schedule_json) : null),
        patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : num(current.is_active, 1),
        stamp(),
        classId,
      ],
    );
    recordAudit(db, actor, "CLASS_UPDATED", "class", classId, {});
  });
  return mapClass(getClassRow(db, classId));
}

export async function deleteClass(db: Db, actor: ServiceActor, classId: string): Promise<void> {
  requirePermission(actor, "classes.purge");
  const cls = getClassRow(db, classId);
  const className = str(cls.name);

  await db.transaction(async () => {
    // 1. Delete all bookings for all sessions of this class
    db.run(
      "DELETE FROM class_bookings WHERE session_id IN (SELECT id FROM class_sessions WHERE class_id = ?)",
      [classId],
    );
    // 2. Delete all sessions
    db.run("DELETE FROM class_sessions WHERE class_id = ?", [classId]);
    // 3. Delete recurrences
    db.run("DELETE FROM class_recurrences WHERE class_id = ?", [classId]);
    // 4. Delete the class itself
    db.run("DELETE FROM classes WHERE id = ?", [classId]);

    recordAudit(db, actor, "CLASS_PURGED", "class", classId, { name: className });
  });
}

// ---------------------------- class sessions -----------------------------

export interface ClassSessionInput {
  sessionDate: string;
  startTime: string;
  durationMin?: number;
  capacity?: number;
}

export interface ClassSession {
  id: string;
  classId: string;
  className: string;
  trainerId: string | null;
  trainerName: string | null;
  location: string | null;
  consumesSession: boolean;
  sessionDate: string;
  startTime: string;
  durationMin: number;
  capacity: number;
  bookedCount: number;
  attendedCount: number;
  status: "scheduled" | "done" | "cancelled";
  trainerFeeMinor: number;
  paidToTrainer: boolean;
  expenseId: string | null;
  paidAt: string | null;
}

const SESSION_SELECT =
  "SELECT cs.*, c.name AS class_name, c.consumes_session AS consumes_session, c.location AS location, c.trainer_id AS trainer_id, t.full_name AS trainer_name,\n(SELECT COUNT(*) FROM class_bookings b WHERE b.session_id = cs.id AND b.status IN ('booked','attended')) AS booked_count,\n(SELECT COUNT(*) FROM class_bookings b2 WHERE b2.session_id = cs.id AND b2.status = 'attended') AS attended_count\nFROM class_sessions cs JOIN classes c ON c.id = cs.class_id LEFT JOIN trainers t ON t.id = c.trainer_id";

function mapSession(r: Row): ClassSession {
  return {
    id: str(r.id),
    classId: str(r.class_id),
    className: str(r.class_name),
    trainerId: r.trainer_id == null ? null : str(r.trainer_id),
    trainerName: r.trainer_name == null ? null : str(r.trainer_name),
    location: r.location == null ? null : str(r.location),
    consumesSession: num(r.consumes_session) === 1,
    sessionDate: str(r.session_date),
    startTime: str(r.start_time),
    durationMin: num(r.duration_min, 60),
    capacity: num(r.capacity),
    bookedCount: num(r.booked_count),
    attendedCount: num(r.attended_count),
    status: str(r.status) as ClassSession["status"],
    trainerFeeMinor: num(r.trainer_fee_minor),
    paidToTrainer: num(r.paid_to_trainer) === 1,
    expenseId: r.expense_id == null ? null : str(r.expense_id),
    paidAt: r.paid_at == null ? null : str(r.paid_at),
  };
}

export async function createClassSession(
  db: Db,
  actor: ServiceActor,
  classId: string,
  input: ClassSessionInput,
): Promise<ClassSession> {
  requirePermission(actor, "classes.manage");
  const cls = getClassRow(db, classId);
  if (num(cls.is_active, 1) !== 1) throw errValidation("errors.classInactive");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate)) throw errValidation("errors.invalidDate");
  if (!/^\d{2}:\d{2}$/.test(input.startTime)) throw errValidation("errors.invalidTime");
  const duration = Math.max(5, Math.floor(Number(input.durationMin ?? 60)));
  const capacity = Math.max(1, Math.floor(Number(input.capacity ?? num(cls.capacity))));
  const dup = db.first(
    "SELECT id FROM class_sessions WHERE class_id = ? AND session_date = ? AND start_time = ?",
    [classId, input.sessionDate, input.startTime],
  );
  if (dup) throw errConflict("errors.classSessionDuplicate");
  const defaultFee = num(cls.default_trainer_fee_minor);
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO class_sessions (id, class_id, session_date, start_time, duration_min, capacity, status, trainer_fee_minor, paid_to_trainer, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, 0, ?, ?)",
      [id, classId, input.sessionDate, input.startTime, duration, capacity, defaultFee, actor.userId, stamp()],
    );
    recordAudit(db, actor, "CLASS_SESSION_CREATED", "class_session", id, {
      class: str(cls.name),
      date: input.sessionDate,
    });
  });
  return mapSession(getSessionRow(db, id));
}

function getSessionRow(db: Db, sessionId: string): Row {
  const row = db.first<Row>(`${SESSION_SELECT} WHERE cs.id = ?`, [sessionId]);
  if (!row) throw errNotFound("errors.classSessionNotFound");
  return row;
}

export function listSessions(
  db: Db,
  actor: ServiceActor,
  query: { fromDate?: string; toDate?: string; classId?: string; status?: "scheduled" | "done" | "cancelled" | "all"; limit?: number } = {},
): ClassSession[] {
  requirePermission(actor, "classes.view");
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const conditions: string[] = [];
  const params: Num[] = [];
  if (query.fromDate) {
    conditions.push("cs.session_date >= ?");
    params.push(query.fromDate);
  }
  if (query.toDate) {
    conditions.push("cs.session_date <= ?");
    params.push(query.toDate);
  }
  if (query.classId) {
    conditions.push("cs.class_id = ?");
    params.push(query.classId);
  }
  if (query.status && query.status !== "all") {
    conditions.push("cs.status = ?");
    params.push(query.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<Row>(`${SESSION_SELECT} ${where} ORDER BY cs.session_date ASC, cs.start_time ASC LIMIT ?`, [
      ...params,
      limit,
    ])
    .map(mapSession);
}

export async function cancelClassSession(db: Db, actor: ServiceActor, sessionId: string, reason: string): Promise<void> {
  requirePermission(actor, "classes.manage");
  const row = getSessionRow(db, sessionId);
  if (str(row.status) === "cancelled") throw errConflict("errors.classSessionCancelled");
  await db.transaction(async () => {
    db.run("UPDATE class_sessions SET status = 'cancelled', notes = ? WHERE id = ?", [
      reason.trim() || null,
      sessionId,
    ]);
    // free any pending bookings
    db.run("UPDATE class_bookings SET status = 'cancelled' WHERE session_id = ? AND status = 'booked'", [sessionId]);
    recordAudit(db, actor, "CLASS_SESSION_CANCELLED", "class_session", sessionId, { reason });
  });
}

export async function uncancelClassSession(db: Db, actor: ServiceActor, sessionId: string): Promise<void> {
  requirePermission(actor, "classes.manage");
  const row = getSessionRow(db, sessionId);
  if (str(row.status) !== "cancelled") throw errConflict("errors.classSessionCancelled");
  await db.transaction(async () => {
    db.run("UPDATE class_sessions SET status = 'scheduled', notes = NULL WHERE id = ?", [sessionId]);
    db.run("UPDATE class_bookings SET status = 'booked' WHERE session_id = ? AND status = 'cancelled'", [sessionId]);
    recordAudit(db, actor, "CLASS_SESSION_REACTIVATED", "class_session", sessionId, {});
  });
}

export async function completeClassSession(db: Db, actor: ServiceActor, sessionId: string): Promise<ClassSession> {
  requirePermission(actor, "classes.manage");
  getSessionRow(db, sessionId);
  await db.transaction(async () => {
    db.run("UPDATE class_sessions SET status = 'done' WHERE id = ?", [sessionId]);
    recordAudit(db, actor, "CLASS_SESSION_DONE", "class_session", sessionId, {});
  });
  return mapSession(getSessionRow(db, sessionId));
}

export async function deleteClassSession(db: Db, actor: ServiceActor, sessionId: string): Promise<void> {
  requirePermission(actor, "classes.manage");
  const session = getSessionRow(db, sessionId);
  await db.transaction(async () => {
    // Delete all bookings for this session
    db.run("DELETE FROM class_bookings WHERE session_id = ?", [sessionId]);
    // Delete the session
    db.run("DELETE FROM class_sessions WHERE id = ?", [sessionId]);
    recordAudit(db, actor, "CLASS_SESSION_PURGED", "class_session", sessionId, {
      date: str(session.session_date),
      time: str(session.start_time),
    });
  });
}

// ------------------------------ bookings ---------------------------------

export interface BookingRow {
  id: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  memberPhone?: string | null;
  status: "booked" | "attended" | "cancelled" | "no_show";
  consumedSubscriptionId: string | null;
  bookedAt: string;
  sessionsRemaining?: number | null;
  subscriptionPlanName?: string | null;
  className?: string | null;
  sessionDate?: string | null;
  sessionStartTime?: string | null;
}

export function listBookings(db: Db, actor: ServiceActor, sessionId: string): BookingRow[] {
  requirePermission(actor, "classes.view");
  const session = getSessionRow(db, sessionId);
  const cls = getClassRow(db, str(session.class_id));
  const planId = cls.plan_id ? str(cls.plan_id) : null;

  return db
    .all<Row>(
      `SELECT b.*, m.full_name AS member_name, m.member_code AS member_code, m.phone AS member_phone,
      sub.id AS active_sub_id,
      (sub.sessions_total - sub.sessions_used) AS sessions_rem,
      p.name AS sub_plan_name
      FROM class_bookings b
      JOIN members m ON m.id = b.member_id
      LEFT JOIN (
        SELECT s.id, s.member_id, s.sessions_total, s.sessions_used, s.plan_id
        FROM member_subscriptions s
        JOIN membership_plans mp ON mp.id = s.plan_id
        WHERE s.status = 'active' AND mp.kind = 'sessions'
        ORDER BY CASE WHEN ? IS NOT NULL AND s.plan_id = ? THEN 0 ELSE 1 END, (s.sessions_total - s.sessions_used) ASC
      ) sub ON sub.member_id = b.member_id
      LEFT JOIN membership_plans p ON p.id = sub.plan_id
      WHERE b.session_id = ?
      GROUP BY b.id
      ORDER BY b.booked_at`,
      [planId, planId, sessionId],
    )
    .map((r) => ({
      id: str(r.id),
      sessionId: str(r.session_id),
      memberId: str(r.member_id),
      memberName: str(r.member_name),
      memberCode: str(r.member_code),
      memberPhone: r.member_phone == null ? null : str(r.member_phone),
      status: str(r.status) as BookingRow["status"],
      consumedSubscriptionId: r.consumed_subscription_id == null ? null : str(r.consumed_subscription_id),
      bookedAt: str(r.booked_at),
      sessionsRemaining: r.sessions_rem == null ? null : num(r.sessions_rem),
      subscriptionPlanName: r.sub_plan_name == null ? null : str(r.sub_plan_name),
    }));
}

export function listMemberBookings(db: Db, actor: ServiceActor, memberId: string, limit = 30): BookingRow[] {
  requirePermission(actor, "classes.view");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  return db
    .all<Row>(
      `SELECT b.*, m.full_name AS member_name, m.member_code AS member_code,
              c.name AS class_name, cs.session_date AS session_date, cs.start_time AS session_start_time
       FROM class_bookings b
       JOIN members m ON m.id = b.member_id
       LEFT JOIN class_sessions cs ON cs.id = b.session_id
       LEFT JOIN classes c ON c.id = cs.class_id
       WHERE b.member_id = ?
       ORDER BY b.booked_at DESC
       LIMIT ?`,
      [memberId, Math.min(100, Math.max(1, limit))],
    )
    .map((r) => ({
      id: str(r.id),
      sessionId: str(r.session_id),
      memberId: str(r.member_id),
      memberName: str(r.member_name),
      memberCode: str(r.member_code),
      status: str(r.status) as BookingRow["status"],
      consumedSubscriptionId: r.consumed_subscription_id == null ? null : str(r.consumed_subscription_id),
      bookedAt: str(r.booked_at),
      className: r.class_name == null ? null : str(r.class_name),
      sessionDate: r.session_date == null ? null : str(r.session_date),
      sessionStartTime: r.session_start_time == null ? null : str(r.session_start_time),
    }));
}

/**
 * Book a member into a session. Capacity is enforced unless caller holds
 * classes.manage. Session consumption happens at attendance time, not booking.
 */
export async function bookMember(
  db: Db,
  actor: ServiceActor,
  input: { sessionId: string; memberId: string; overrideCapacity?: boolean },
): Promise<BookingRow> {
  requirePermission(actor, "classes.view");
  const session = getSessionRow(db, input.sessionId);
  if (str(session.status) !== "scheduled") throw errConflict("errors.classSessionNotBookable");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(input.memberId)));
  if (str(session.session_date) < todayKey()) throw errValidation("errors.classSessionPast");

  const existing = db.first(
    "SELECT id, status FROM class_bookings WHERE session_id = ? AND member_id = ?",
    [input.sessionId, input.memberId],
  );
  if (existing && str(existing.status) !== "cancelled") throw errConflict("errors.bookingDuplicate");

  // Capacity is checked INSIDE the transaction (under BEGIN IMMEDIATE) so the
  // count read and the insert are atomic: two concurrent bookings for the last
  // seat can't both read the same free count and oversubscribe the class.
  const capacity = num(session.capacity);
  const wantsOverride = input.overrideCapacity === true && (actor.roleId === "owner" || roleHasPermission(actor.roleId, "classes.manage"));

  await db.transaction(async () => {
    const bookedCount = Number(
      db.scalar(
        "SELECT COUNT(*) FROM class_bookings WHERE session_id = ? AND status IN ('booked','attended')",
        [input.sessionId],
      ) ?? 0,
    );
    if (bookedCount >= capacity && !wantsOverride) {
      throw errConflict("errors.classFull", { capacity });
    }
    if (existing) {
      db.run("UPDATE class_bookings SET status = 'booked', booked_at = ?, booked_by = ? WHERE id = ?", [
        stamp(),
        actor.userId,
        String(existing.id),
      ]);
    } else {
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO class_bookings (id, session_id, member_id, status, booked_by, booked_at)\nVALUES (?, ?, ?, 'booked', ?, ?)",
        [id, input.sessionId, input.memberId, actor.userId, stamp()],
      );
    }
    recordAudit(db, actor, "BOOKING_CREATED", "class_booking", input.sessionId, { memberId: input.memberId });
  });

  return listBookings(db, actor, input.sessionId).find((b) =>
    existing ? b.id === String(existing.id) : (b.memberId === input.memberId && b.status === "booked"),
  )!;
}

export async function cancelBooking(db: Db, actor: ServiceActor, bookingId: string): Promise<void> {
  requirePermission(actor, "classes.view");
  const row = db.first<Row>("SELECT * FROM class_bookings WHERE id = ?", [bookingId]);
  if (!row) throw errNotFound("errors.bookingNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));
  if (str(row.status) === "attended") throw errConflict("errors.bookingAttendedCancel");
  await db.transaction(async () => {
    db.run("UPDATE class_bookings SET status = 'cancelled' WHERE id = ?", [bookingId]);
    recordAudit(db, actor, "BOOKING_CANCELLED", "class_booking", bookingId, {});
  });
}

/**
 * Mark attendance. When the class consumes sessions, exactly one session is
 * consumed transactionally the first time the booking is marked attended.
 */
export async function setBookingStatus(
  db: Db,
  actor: ServiceActor,
  bookingId: string,
  status: "booked" | "attended" | "no_show",
): Promise<BookingRow> {
  requirePermission(actor, "classes.checkin");
  const row = db.first<Row>("SELECT * FROM class_bookings WHERE id = ?", [bookingId]);
  if (!row) throw errNotFound("errors.bookingNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));

  let consumedSubId: string | null = row.consumed_subscription_id == null ? null : String(row.consumed_subscription_id);

  await db.transaction(async () => {
    if (status === "attended") {
      if (str(row.status) === "attended") return; // idempotent
      const session = getSessionRow(db, str(row.session_id));
      const cls = getClassRow(db, str(session.class_id));
      if (num(cls.consumes_session) === 1 && !consumedSubId) {
        // find the member's active session-based subscription with remaining sessions (prioritize class's plan if set)
        const classPlanId = cls.plan_id ? str(cls.plan_id) : null;
        const sub = db.first<Row>(
          `SELECT s.id FROM member_subscriptions s JOIN membership_plans p ON p.id = s.plan_id
WHERE s.member_id = ? AND s.status = 'active' AND p.kind = 'sessions'
AND s.sessions_total IS NOT NULL AND s.sessions_used < s.sessions_total
ORDER BY CASE WHEN ? IS NOT NULL AND s.plan_id = ? THEN 0 ELSE 1 END, (s.sessions_total - s.sessions_used) ASC LIMIT 1`,
          [str(row.member_id), classPlanId, classPlanId],
        );
        if (!sub) throw errValidation("errors.noSessionsForClass");
        consumeSession(db, str(sub.id)); // atomic guard inside
        consumedSubId = str(sub.id);
        db.run("UPDATE class_bookings SET consumed_subscription_id = ? WHERE id = ?", [
          consumedSubId,
          bookingId,
        ]);
      }
    }
    db.run("UPDATE class_bookings SET status = ? WHERE id = ?", [status, bookingId]);
    recordAudit(db, actor, status === "attended" ? "BOOKING_ATTENDED" : "BOOKING_CANCELLED", "class_booking", bookingId, { status });
  });

  const all = listBookings(db, actor, str(row.session_id));
  return all.find((b) => b.id === bookingId)!;
}

// --------------------------- class recurrences ---------------------------
// TASK-035: a recurrence template stores a weekly pattern (days_of_week are
// JS/Date weekdays, 0=Sunday..6=Saturday) and materializes real class_sessions
// rows for it. Sessions stay plain rows, so booking/attendance/consumption work
// exactly as before; generation reuses the same (class_id,date,start_time)
// duplicate guard as createClassSession and skips conflicts.

export interface ClassRecurrenceInput {
  classId: string;
  daysOfWeek: number[];
  startDate: string;
  startTime: string;
  durationMin?: number;
  capacity?: number | null;
  weeks?: number;
}

export interface ClassRecurrence {
  id: string;
  classId: string;
  className: string;
  trainerName: string | null;
  daysOfWeek: number[];
  startDate: string;
  startTime: string;
  durationMin: number;
  capacity: number | null;
  isActive: boolean;
  nextScheduledDate: string | null;
}

export interface RecurrenceResult {
  recurrence: ClassRecurrence;
  created: number;
  skipped: number;
}

const RECURRENCE_SELECT =
  "SELECT cr.*, c.name AS class_name, t.full_name AS trainer_name FROM class_recurrences cr\nJOIN classes c ON c.id = cr.class_id LEFT JOIN trainers t ON t.id = c.trainer_id";

function parseDaysOfWeek(value: unknown): number[] {
  return String(value ?? "")
    .split(",")
    .filter((s) => s !== "")
    .map((s) => Number(s));
}

function mapRecurrence(r: Row): ClassRecurrence {
  return {
    id: str(r.id),
    classId: str(r.class_id),
    className: str(r.class_name),
    trainerName: r.trainer_name == null ? null : str(r.trainer_name),
    daysOfWeek: parseDaysOfWeek(r.days_of_week),
    startDate: str(r.start_date),
    startTime: str(r.start_time),
    durationMin: num(r.duration_min, 60),
    capacity: r.capacity == null ? null : num(r.capacity),
    isActive: num(r.is_active, 1) === 1,
    nextScheduledDate: null,
  };
}

function getRecurrenceRow(db: Db, recurrenceId: string): Row {
  const row = db.first<Row>(`${RECURRENCE_SELECT} WHERE cr.id = ?`, [recurrenceId]);
  if (!row) throw errNotFound("errors.classRecurrenceNotFound");
  return row;
}

function nextScheduledDate(db: Db, classId: string): string | null {
  const value = db.scalar(
    "SELECT MIN(session_date) FROM class_sessions WHERE class_id = ? AND status = 'scheduled' AND session_date >= ?",
    [classId, todayKey()],
  );
  return value == null ? null : str(value);
}

/** Day after the latest session ever created for (class_id, start_time), or the fallback date. */
function dayAfterLastSession(db: Db, classId: string, startTime: string, fallback: string): string {
  const value = db.scalar(
    "SELECT MAX(session_date) FROM class_sessions WHERE class_id = ? AND start_time = ?",
    [classId, startTime],
  );
  if (value == null) return fallback;
  const d = new Date(`${String(value)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Dates to materialize: starting at startDate (inclusive), stepping day by day
 * for (weeks * 7) days, keeping only weekday numbers in daysOfWeek. Returns the
 * YYYY-MM-DD keys in ascending order.
 */
function recurrenceDateKeys(startDate: string, daysOfWeek: number[], weeks: number): string[] {
  const wanted = new Set(daysOfWeek);
  const start = new Date(`${startDate}T00:00:00Z`);
  const keys: string[] = [];
  for (let offset = 0; offset < weeks * 7; offset++) {
    const d = new Date(start.getTime() + offset * 86_400_000);
    if (wanted.has(d.getUTCDay())) keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function assertRecurrenceInput(input: ClassRecurrenceInput): {
  daysOfWeek: number[];
  startDate: string;
  startTime: string;
  durationMin: number;
  capacity: number | null;
  weeks: number;
} {
  const daysOfWeek = Array.from(new Set((input.daysOfWeek ?? []).map((d) => Math.floor(Number(d)))))
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  if (daysOfWeek.length === 0) throw errValidation("errors.classRecurrenceNoDays");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw errValidation("errors.invalidDate");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) throw errValidation("errors.invalidTime");
  const durationMin = Math.max(5, Math.floor(Number(input.durationMin ?? 60)));
  let capacity: number | null = null;
  if (input.capacity != null) {
    capacity = Math.floor(Number(input.capacity));
    if (capacity <= 0) throw errValidation("errors.classCapacityInvalid");
  }
  const weeks = Math.min(12, Math.max(1, Math.floor(Number(input.weeks ?? 4))));
  return { daysOfWeek, startDate: input.startDate, startTime: input.startTime, durationMin, capacity, weeks };
}

/**
 * Insert one session per generated date unless a session for the same
 * (class_id, session_date, start_time) already exists. Returns how many were
 * created vs skipped. Must run inside a write transaction.
 */
function materializeSessions(db: Db, actor: ServiceActor, classId: string, daysOfWeek: number[], startDate: string, startTime: string, durationMin: number, capacity: number | null, classCapacity: number, weeks: number): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  const dates = recurrenceDateKeys(startDate, daysOfWeek, weeks);
  const sessionCapacity = capacity ?? classCapacity;
  const clsRow = db.first<{ default_trainer_fee_minor: number }>(
    "SELECT default_trainer_fee_minor FROM classes WHERE id = ?",
    [classId],
  );
  const defaultFee = Number(clsRow?.default_trainer_fee_minor ?? 0);
  for (const date of dates) {
    const dup = db.first("SELECT id FROM class_sessions WHERE class_id = ? AND session_date = ? AND start_time = ?", [
      classId,
      date,
      startTime,
    ]);
    if (dup) {
      skipped++;
      continue;
    }
    const id = crypto.randomUUID();
    db.run(
      "INSERT INTO class_sessions (id, class_id, session_date, start_time, duration_min, capacity, status, trainer_fee_minor, paid_to_trainer, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, 0, ?, ?)",
      [id, classId, date, startTime, durationMin, sessionCapacity, defaultFee, actor.userId, stamp()],
    );
    created++;
  }
  return { created, skipped };
}

export async function createClassRecurrence(
  db: Db,
  actor: ServiceActor,
  input: ClassRecurrenceInput,
): Promise<RecurrenceResult> {
  requirePermission(actor, "classes.manage");
  const cls = getClassRow(db, input.classId);
  if (num(cls.is_active, 1) !== 1) throw errValidation("errors.classInactive");
  const data = assertRecurrenceInput(input);

  const id = crypto.randomUUID();
  let created = 0;
  let skipped = 0;
  await db.transaction(async () => {
    db.run(
      "INSERT INTO class_recurrences (id, class_id, days_of_week, start_date, start_time, duration_min, capacity, is_active, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      [
        id,
        input.classId,
        data.daysOfWeek.join(","),
        data.startDate,
        data.startTime,
        data.durationMin,
        data.capacity,
        actor.userId,
        stamp(),
        stamp(),
      ],
    );
    const res = materializeSessions(db, actor, input.classId, data.daysOfWeek, data.startDate, data.startTime, data.durationMin, data.capacity, num(cls.capacity), data.weeks);
    created = res.created;
    skipped = res.skipped;
    recordAudit(db, actor, "CLASS_RECURRENCE_CREATED", "class_recurrence", id, {
      class: str(cls.name),
      created,
      skipped,
    });
  });
  const row = db.first<Row>(`${RECURRENCE_SELECT} WHERE cr.id = ?`, [id])!;
  const rec = mapRecurrence(row);
  rec.nextScheduledDate = nextScheduledDate(db, input.classId);
  return { recurrence: rec, created, skipped };
}

export function listClassRecurrences(
  db: Db,
  actor: ServiceActor,
  query: { activeOnly?: boolean } = {},
): ClassRecurrence[] {
  requirePermission(actor, "classes.view");
  const where = query.activeOnly ? "WHERE cr.is_active = 1" : "";
  const rows = db.all<Row>(`${RECURRENCE_SELECT} ${where} ORDER BY cr.start_time, cr.start_date`);
  return rows.map((r) => {
    const rec = mapRecurrence(r);
    rec.nextScheduledDate = nextScheduledDate(db, rec.classId);
    return rec;
  });
}

export async function generateRecurrenceWeeks(
  db: Db,
  actor: ServiceActor,
  recurrenceId: string,
  weeks = 2,
): Promise<{ created: number; skipped: number }> {
  requirePermission(actor, "classes.manage");
  const rec = getRecurrenceRow(db, recurrenceId);
  if (num(rec.is_active, 1) !== 1) throw errValidation("errors.classRecurrenceInactive");
  const cls = getClassRow(db, str(rec.class_id));
  const count = Math.min(12, Math.max(1, Math.floor(Number(weeks))));
  let created = 0;
  let skipped = 0;
  await db.transaction(async () => {
    // Continue after the last generated session so "extend" truly advances.
    const effectiveStart = dayAfterLastSession(db, str(rec.class_id), str(rec.start_time), str(rec.start_date));
    const res = materializeSessions(
      db,
      actor,
      str(rec.class_id),
      parseDaysOfWeek(rec.days_of_week),
      effectiveStart,
      str(rec.start_time),
      num(rec.duration_min, 60),
      rec.capacity == null ? null : num(rec.capacity),
      num(cls.capacity),
      count,
    );
    created = res.created;
    skipped = res.skipped;
    db.run("UPDATE class_recurrences SET updated_at = ? WHERE id = ?", [stamp(), recurrenceId]);
    recordAudit(db, actor, "CLASS_RECURRENCE_EXTENDED", "class_recurrence", recurrenceId, { created, skipped });
  });
  return { created, skipped };
}

export async function deactivateClassRecurrence(db: Db, actor: ServiceActor, recurrenceId: string): Promise<void> {
  requirePermission(actor, "classes.manage");
  const rec = getRecurrenceRow(db, recurrenceId);
  if (num(rec.is_active, 1) !== 1) throw errConflict("errors.classRecurrenceInactive");
  await db.transaction(async () => {
    db.run("UPDATE class_recurrences SET is_active = 0, updated_at = ? WHERE id = ?", [stamp(), recurrenceId]);
    recordAudit(db, actor, "CLASS_RECURRENCE_STOPPED", "class_recurrence", recurrenceId, {
      class: str(rec.class_name),
    });
  });
}

export async function deleteClassRecurrence(db: Db, actor: ServiceActor, recurrenceId: string): Promise<void> {
  requirePermission(actor, "classes.manage");
  const rec = getRecurrenceRow(db, recurrenceId);
  await db.transaction(async () => {
    db.run("DELETE FROM class_recurrences WHERE id = ?", [recurrenceId]);
    recordAudit(db, actor, "CLASS_RECURRENCE_PURGED", "class_recurrence", recurrenceId, {
      class: str(rec.class_name),
    });
  });
}

// --------------------------- All-in-One Class & Package ---------------------------

export interface CreateClassWithPackageInput {
  name: string;
  discipline?: CombatDiscipline;
  category?: TargetCategory;
  level?: CombatLevel;
  description?: string | null;
  trainerId?: string | null;
  location?: string | null;
  capacity: number;
  consumesSession?: boolean;
  defaultTrainerFeeMinor?: number;
  scheduleSlots?: ClassScheduleSlot[];
  // Recurrence schedule (optional)
  schedule?: {
    daysOfWeek: number[]; // 0=Sun..6=Sat
    startDate: string;
    startTime: string;
    durationMin?: number;
    capacity?: number | null;
    weeks?: number;
  };
  // Package / Membership Plan (optional)
  package?: {
    createPlan: boolean;
    existingPlanId?: string;
    planName?: string;
    price: number;
    sessionCount?: number;
    sessionsCount?: number;
    durationDays?: number;
  };
}

export async function createClassWithPackage(
  db: Db,
  actor: ServiceActor,
  input: CreateClassWithPackageInput,
): Promise<{ class: GymClass; recurrence?: ClassRecurrence; planId?: string }> {
  requirePermission(actor, "classes.manage");

  let planId: string | null = null;

  // 1. Create or link membership plan if package specified
  if (input.package?.createPlan && input.package.planName) {
    const sCount = Math.max(1, Math.floor(input.package.sessionsCount ?? input.package.sessionCount ?? 8));
    const planIdGen = crypto.randomUUID();
    const ts = stamp();
    db.run(
      `INSERT INTO membership_plans (id, name, duration_days, price, description, kind, category, sessions_count, invitations_count, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'sessions', 'academy', ?, 0, 1, ?, ?)`,
      [
        planIdGen,
        input.package.planName.trim(),
        Math.max(1, Math.floor(input.package.durationDays ?? 30)),
        Math.max(0, Math.floor(input.package.price)),
        `باقة خاصة بحصة ${input.name.trim()}`,
        sCount,
        ts,
        ts,
      ],
    );
    planId = planIdGen;
  } else if (input.package?.existingPlanId) {
    planId = input.package.existingPlanId;
  }

  // 2. Create the class
  const newClass = await createClass(db, actor, {
    name: input.name,
    discipline: input.discipline,
    category: input.category,
    level: input.level,
    description: input.description,
    trainerId: input.trainerId,
    location: input.location,
    capacity: input.capacity,
    consumesSession: input.consumesSession ?? (planId !== null),
    planId,
    defaultTrainerFeeMinor: input.defaultTrainerFeeMinor,
    scheduleSlots: input.scheduleSlots,
  });

  // 3. Create recurrence schedule if specified
  let recurrence: ClassRecurrence | undefined;
  if (input.schedule && input.schedule.daysOfWeek.length > 0) {
    const recResult = await createClassRecurrence(db, actor, {
      classId: newClass.id,
      daysOfWeek: input.schedule.daysOfWeek,
      startDate: input.schedule.startDate,
      startTime: input.schedule.startTime,
      durationMin: input.schedule.durationMin ?? 60,
      capacity: input.schedule.capacity ?? input.capacity,
      weeks: input.schedule.weeks ?? 4,
    });
    recurrence = recResult.recurrence;
  }

  return {
    class: newClass,
    recurrence,
    planId: planId ?? undefined,
  };
}

export function syncAcademyClassForPlan(
  db: Db,
  actor: ServiceActor,
  planId: string,
  planName: string,
  trainerId?: string | null,
  capacity?: number,
  scheduleSlots?: ClassScheduleSlot[],
): void {
  const existing = db.first<Row>(
    "SELECT id, schedule_json FROM classes WHERE plan_id = ?",
    [planId],
  );

  const finalCapacity = capacity && capacity > 0 ? Math.floor(capacity) : 15;
  const slots = scheduleSlots ?? [];
  const scheduleJson = slots.length > 0 ? JSON.stringify(slots) : null;
  const ts = nowStamp();

  let classId = existing ? str(existing.id) : null;

  if (existing && classId) {
    db.run(
      "UPDATE classes SET name = ?, trainer_id = ?, capacity = ?, schedule_json = ?, updated_at = ? WHERE id = ?",
      [planName, trainerId ?? null, finalCapacity, scheduleJson, ts, classId],
    );
  } else {
    classId = crypto.randomUUID();
    db.run(
      `INSERT INTO classes (id, name, discipline, category, level, description, trainer_id, location, capacity, consumes_session, plan_id, default_trainer_fee_minor, schedule_json, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, 'general', 'all', 'all_levels', NULL, ?, NULL, ?, 1, ?, 0, ?, 1, ?, ?, ?)`,
      [classId, planName, trainerId ?? null, finalCapacity, planId, scheduleJson, actor.userId, ts, ts],
    );
  }

  // Materialize sessions for upcoming 4 weeks if slots are present
  if (classId && slots.length > 0) {
    const today = todayKey();
    for (const slot of slots) {
      const days = [slot.dayOfWeek];
      const startTime = slot.startTime || "18:00";
      let durationMin = 60;
      if (slot.endTime && slot.startTime) {
        const [sh, sm] = slot.startTime.split(":").map(Number);
        const [eh, em] = slot.endTime.split(":").map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff > 0) durationMin = diff;
      }
      materializeSessions(db, actor, classId, days, today, startTime, durationMin, finalCapacity, finalCapacity, 4);
    }
  }
}

// --------------------------- Batch Attendance Roster ---------------------------

export interface AttendanceRosterItem {
  bookingId: string;
  memberId: string;
  status: "attended" | "no_show" | "booked";
}

export async function saveSessionAttendanceRoster(
  db: Db,
  actor: ServiceActor,
  sessionId: string,
  roster: AttendanceRosterItem[],
): Promise<{ savedCount: number; attendedCount: number }> {
  requirePermission(actor, "classes.checkin");

  const session = getSessionRow(db, sessionId);
  const cls = getClassRow(db, str(session.class_id));
  const classPlanId = cls.plan_id ? str(cls.plan_id) : null;

  let attendedCount = 0;

  await db.transaction(async () => {
    for (const item of roster) {
      const row = db.first<Row>("SELECT * FROM class_bookings WHERE id = ? AND session_id = ?", [
        item.bookingId,
        sessionId,
      ]);
      if (!row) continue;
      assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));

      let consumedSubId: string | null =
        row.consumed_subscription_id == null ? null : String(row.consumed_subscription_id);

      if (item.status === "attended") {
        attendedCount++;
        // If not already consumed and class consumes sessions, consume 1 session
        if (num(cls.consumes_session) === 1 && !consumedSubId) {
          const sub = db.first<Row>(
            `SELECT s.id FROM member_subscriptions s JOIN membership_plans p ON p.id = s.plan_id
WHERE s.member_id = ? AND s.status = 'active' AND p.kind = 'sessions'
AND s.sessions_total IS NOT NULL AND s.sessions_used < s.sessions_total
ORDER BY CASE WHEN ? IS NOT NULL AND s.plan_id = ? THEN 0 ELSE 1 END, (s.sessions_total - s.sessions_used) ASC LIMIT 1`,
            [str(row.member_id), classPlanId, classPlanId],
          );
          if (sub) {
            consumeSession(db, str(sub.id));
            consumedSubId = str(sub.id);
            db.run("UPDATE class_bookings SET consumed_subscription_id = ? WHERE id = ?", [
              consumedSubId,
              item.bookingId,
            ]);
          }
        }
      }

      db.run("UPDATE class_bookings SET status = ? WHERE id = ?", [item.status, item.bookingId]);
    }

    recordAudit(db, actor, "CLASS_ROSTER_SAVED", "class_session", sessionId, {
      total: roster.length,
      attended: attendedCount,
    });
  });

  return { savedCount: roster.length, attendedCount };
}

// --------------------------- Coach Payout for Session ---------------------------

export interface PayTrainerInput {
  sessionId: string;
  trainerFeeMinor?: number;
  amountMinor?: number;
  methodCode?: string; // default 'cash'
  notes?: string;
}

export async function payTrainerForSession(
  db: Db,
  actor: ServiceActor,
  input: PayTrainerInput,
): Promise<{ session: ClassSession; expenseId: string }> {
  requirePermission(actor, "expenses.create");
  const session = getSessionRow(db, input.sessionId);
  if (num(session.paid_to_trainer) === 1) {
    throw errConflict("errors.trainerSessionAlreadyPaid");
  }

  const cls = getClassRow(db, str(session.class_id));
  if (!cls.trainer_id) {
    throw errValidation("errors.noTrainerForClass");
  }

  const feeMinor = Math.max(0, Math.floor(Number(input.trainerFeeMinor ?? input.amountMinor ?? 0)));
  if (feeMinor <= 0) {
    throw errValidation("errors.invalidAmount");
  }

  // Ensure default salary/trainer expense category exists
  let cat = db.first<{ id: string }>("SELECT id FROM expense_categories WHERE id = 'cat-salaries' OR name_ar LIKE '%رواتب%' LIMIT 1");
  if (!cat) {
    cat = db.first<{ id: string }>("SELECT id FROM expense_categories LIMIT 1");
  }
  const categoryId = cat ? cat.id : "cat-salaries";

  const trainerName = str(session.trainer_name) || "المدرب";
  const className = str(cls.name);
  const description = input.notes?.trim() || `أتعاب تدريب حصة: ${className} بتاريخ ${str(session.session_date)} (${trainerName})`;

  const expense = await createExpense(db, actor, {
    categoryId,
    amountMinor: feeMinor,
    methodCode: input.methodCode || "cash",
    description,
    expenseDate: str(session.session_date) <= todayKey() ? str(session.session_date) : todayKey(),
  });

  await db.transaction(async () => {
    db.run(
      "UPDATE class_sessions SET trainer_fee_minor = ?, paid_to_trainer = 1, expense_id = ?, paid_at = ? WHERE id = ?",
      [feeMinor, expense.id, nowStamp(), input.sessionId],
    );
    recordAudit(db, actor, "TRAINER_SESSION_PAID", "class_session", input.sessionId, {
      trainerFeeMinor: feeMinor,
      expenseId: expense.id,
    });
  });

  return {
    session: mapSession(getSessionRow(db, input.sessionId)),
    expenseId: expense.id,
  };
}

// --------------------------- Class Profitability Report ---------------------------

export interface ClassProfitItem {
  sessionId: string;
  sessionDate: string;
  startTime: string;
  classId: string;
  className: string;
  trainerName: string | null;
  attendedCount: number;
  sessionUnitPriceMinor: number;
  grossRevenueMinor: number;
  trainerFeeMinor: number;
  netProfitMinor: number;
  paidToTrainer: boolean;
  expenseId: string | null;
}

export function getClassProfitsReport(
  db: Db,
  actor: ServiceActor,
  query: { fromDate?: string; toDate?: string; classId?: string } = {},
): ClassProfitItem[] {
  requirePermission(actor, "classes.view");

  const conditions: string[] = [];
  const params: Num[] = [];

  if (query.classId) {
    conditions.push("cs.class_id = ?");
    params.push(query.classId);
  }
  if (query.fromDate) {
    conditions.push("cs.session_date >= ?");
    params.push(query.fromDate);
  }
  if (query.toDate) {
    conditions.push("cs.session_date <= ?");
    params.push(query.toDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.all<Row>(
    `SELECT cs.id AS session_id, cs.session_date, cs.start_time, cs.trainer_fee_minor, cs.paid_to_trainer, cs.expense_id,
     c.id AS class_id, c.name AS class_name, t.full_name AS trainer_name,
     p.price AS plan_price, p.sessions_count AS plan_session_count,
     (SELECT COUNT(*) FROM class_bookings b WHERE b.session_id = cs.id AND b.status = 'attended') AS attended_count
     FROM class_sessions cs
     JOIN classes c ON c.id = cs.class_id
     LEFT JOIN trainers t ON t.id = c.trainer_id
     LEFT JOIN membership_plans p ON p.id = c.plan_id
     ${where}
     ORDER BY cs.session_date DESC, cs.start_time DESC`,
    params,
  );

  return rows.map((r) => {
    const attended = num(r.attended_count);
    // r.plan_price is stored in major units (EGP) in membership_plans; convert to minor (piastres)
    const planPriceMinor = Math.round(num(r.plan_price) * 100);
    const sessionCount = num(r.plan_session_count, 1) || 1;
    // session unit price in minor units
    const sessionUnitPriceMinor = planPriceMinor > 0 ? Math.round(planPriceMinor / sessionCount) : 0;
    const grossRevenueMinor = attended * sessionUnitPriceMinor;
    const trainerFeeMinor = num(r.trainer_fee_minor);
    const netProfitMinor = grossRevenueMinor - trainerFeeMinor;

    return {
      sessionId: str(r.session_id),
      sessionDate: str(r.session_date),
      startTime: str(r.start_time),
      classId: str(r.class_id),
      className: str(r.class_name),
      trainerName: r.trainer_name == null ? null : str(r.trainer_name),
      attendedCount: attended,
      sessionUnitPriceMinor,
      grossRevenueMinor,
      trainerFeeMinor,
      netProfitMinor,
      paidToTrainer: num(r.paid_to_trainer) === 1,
      expenseId: r.expense_id == null ? null : str(r.expense_id),
    };
  });
}

// --------------------------- Comprehensive Trainer Profile ---------------------------

export interface TrainerProfile {
  trainer: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    specialization: string | null;
    rankTitle: string | null;
    joinedDate: string;
    isActive: boolean;
    notes: string | null;
    defaultSessionFeeMinor: number;
  };
  classes: GymClass[];
  recentSessions: ClassSession[];
  traineesCount: number;
  completedSessionsCount: number;
  totalEarningsMinor: number;
  pendingEarningsMinor: number;
}

export function getTrainerProfile(db: Db, actor: ServiceActor, trainerId: string): TrainerProfile {
  requirePermission(actor, "trainers.view");

  const trainerRow = db.first<Row>(
    "SELECT * FROM trainers WHERE id = ?",
    [trainerId],
  );
  if (!trainerRow) throw errNotFound("errors.trainerNotFound");

  // Classes taught by this trainer
  const classes = listClasses(db, actor, { includeInactive: true }).filter(
    (c) => c.trainerId === trainerId,
  );

  // Recent sessions
  const sessions = listSessions(db, actor, { limit: 50 }).filter((s) => s.trainerId === trainerId);

  // Unique trainees enrolled / booked in classes taught by this trainer
  const traineesCount = Number(
    db.scalar(
      `SELECT COUNT(DISTINCT b.member_id)
       FROM class_bookings b
       JOIN class_sessions cs ON cs.id = b.session_id
       JOIN classes c ON c.id = cs.class_id
       WHERE c.trainer_id = ?`,
      [trainerId],
    ) ?? 0,
  );

  // Completed sessions count
  const completedSessionsCount = Number(
    db.scalar(
      `SELECT COUNT(*)
       FROM class_sessions cs
       JOIN classes c ON c.id = cs.class_id
       WHERE c.trainer_id = ? AND (cs.status = 'done' OR cs.session_date <= ?)`,
      [trainerId, todayKey()],
    ) ?? 0,
  );

  // Earnings paid & pending
  const earnings = db.first<Row>(
    `SELECT
       SUM(CASE WHEN cs.paid_to_trainer = 1 THEN cs.trainer_fee_minor ELSE 0 END) AS total_paid,
       SUM(CASE WHEN cs.paid_to_trainer = 0 THEN cs.trainer_fee_minor ELSE 0 END) AS total_pending
     FROM class_sessions cs
     JOIN classes c ON c.id = cs.class_id
     WHERE c.trainer_id = ? AND cs.status != 'cancelled'`,
    [trainerId],
  );

  return {
    trainer: {
      id: str(trainerRow.id),
      fullName: str(trainerRow.full_name),
      phone: trainerRow.phone == null ? null : str(trainerRow.phone),
      email: trainerRow.email == null ? null : str(trainerRow.email),
      specialization: trainerRow.specialization == null ? null : str(trainerRow.specialization),
      rankTitle: trainerRow.rank_title == null ? null : str(trainerRow.rank_title),
      joinedDate: str(trainerRow.joined_date),
      isActive: num(trainerRow.is_active, 1) === 1,
      notes: trainerRow.notes == null ? null : str(trainerRow.notes),
      defaultSessionFeeMinor: num(trainerRow.default_session_fee_minor),
    },
    classes,
    recentSessions: sessions.slice(0, 20),
    traineesCount,
    completedSessionsCount,
    totalEarningsMinor: num(earnings?.total_paid),
    pendingEarningsMinor: num(earnings?.total_pending),
  };
}

function stamp(): string {
  return nowStamp();
}

// ---------------------- Direct Group Roster & Attendance ----------------------

export interface EnrolledClassMember {
  memberId: string;
  memberName: string;
  memberCode: string;
  phone: string | null;
  photoFileId: string | null;
  subscriptionId: string;
  planId: string;
  planName: string;
  startDate: string;
  endDate: string;
  sessionsTotal: number | null;
  sessionsUsed: number;
  sessionsRemaining: number | null;
  status: "active" | "warning" | "exhausted" | "expired";
  lastCheckinAt: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactName?: string | null;
}

export function listClassEnrolledMembers(
  db: Db,
  actor: ServiceActor,
  classId: string,
): EnrolledClassMember[] {
  requirePermission(actor, "classes.view");
  const cls = db.first<Row>("SELECT plan_id FROM classes WHERE id = ?", [classId]);
  if (!cls || !cls.plan_id) return [];

  const today = todayKey();
  const rows = db.all<Row>(
    `SELECT
      m.id AS member_id,
      m.full_name AS member_name,
      m.member_code AS member_code,
      m.phone AS phone,
      m.emergency_contact_phone AS emergency_contact_phone,
      m.emergency_contact_name AS emergency_contact_name,
      m.photo_file_id AS photo_file_id,
      s.id AS subscription_id,
      s.plan_id AS plan_id,
      p.name AS plan_name,
      s.start_date AS start_date,
      s.end_date AS end_date,
      s.sessions_total AS sessions_total,
      s.sessions_used AS sessions_used,
      s.status AS sub_status,
      (SELECT MAX(a.checkin_at) FROM attendance a WHERE a.member_id = m.id AND a.deleted_at IS NULL) AS last_checkin_at
     FROM member_subscriptions s
     JOIN members m ON m.id = s.member_id
     JOIN membership_plans p ON p.id = s.plan_id
     WHERE s.plan_id = ?
       AND s.status = 'active'
       AND m.deleted_at IS NULL
       AND s.start_date <= ? AND s.end_date >= ?
     ORDER BY m.full_name ASC`,
    [cls.plan_id, today, today],
  );

  return rows.map((r) => {
    const total = r.sessions_total == null ? null : Number(r.sessions_total);
    const used = Number(r.sessions_used ?? 0);
    const remaining = total == null ? null : Math.max(0, total - used);
    let status: EnrolledClassMember["status"] = "active";
    if (String(r.end_date) < today) {
      status = "expired";
    } else if (remaining !== null && remaining <= 0) {
      status = "exhausted";
    } else if (remaining !== null && remaining <= 1) {
      status = "warning";
    }

    return {
      memberId: String(r.member_id),
      memberName: String(r.member_name),
      memberCode: String(r.member_code),
      phone: r.phone ? String(r.phone) : null,
      emergencyContactPhone: r.emergency_contact_phone ? String(r.emergency_contact_phone) : null,
      emergencyContactName: r.emergency_contact_name ? String(r.emergency_contact_name) : null,
      photoFileId: r.photo_file_id ? String(r.photo_file_id) : null,
      subscriptionId: String(r.subscription_id),
      planId: String(r.plan_id),
      planName: String(r.plan_name),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      sessionsTotal: total,
      sessionsUsed: used,
      sessionsRemaining: remaining,
      status,
      lastCheckinAt: r.last_checkin_at ? String(r.last_checkin_at) : null,
    };
  });
}

export async function recordDirectClassAttendance(
  db: Db,
  actor: ServiceActor,
  input: { classId?: string; memberId: string; subscriptionId?: string; notes?: string },
): Promise<{
  success: boolean;
  attendanceId: string;
  memberId: string;
  memberName: string;
  sessionsUsed: number;
  sessionsRemaining: number | null;
  warning?: string;
}> {
  requirePermission(actor, "classes.checkin");
  let cls: Row | null = null;
  if (input.classId) {
    cls = db.first<Row>("SELECT id, name, plan_id, consumes_session FROM classes WHERE id = ?", [input.classId]);
  }

  const member = db.first<Row>("SELECT id, full_name, member_code FROM members WHERE id = ? AND deleted_at IS NULL", [input.memberId]);
  if (!member) throw errNotFound("errors.memberNotFound");

  const today = todayKey();
  let sub: Row | null = null;
  if (input.subscriptionId) {
    sub = db.first<Row>("SELECT * FROM member_subscriptions WHERE id = ? AND member_id = ? AND status = 'active'", [input.subscriptionId, input.memberId]);
    if (sub && !cls) {
      cls = db.first<Row>("SELECT id, name, plan_id, consumes_session FROM classes WHERE plan_id = ? LIMIT 1", [sub.plan_id]);
    }
  } else if (cls?.plan_id) {
    sub = db.first<Row>(
      "SELECT * FROM member_subscriptions WHERE member_id = ? AND plan_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ? ORDER BY end_date ASC LIMIT 1",
      [input.memberId, cls.plan_id, today, today],
    );
  }
  if (!sub) {
    throw errValidation("errors.noActiveSubscription");
  }

  const sessionsTotal = sub.sessions_total == null ? null : Number(sub.sessions_total);
  const currentUsed = Number(sub.sessions_used ?? 0);
  if (sessionsTotal !== null && currentUsed >= sessionsTotal) {
    throw errValidation("errors.planSessionsExhausted");
  }

  const newUsed = currentUsed + 1;
  const newRemaining = sessionsTotal !== null ? Math.max(0, sessionsTotal - newUsed) : null;
  const stampStr = nowStamp();
  const className = cls?.name ? String(cls.name) : "أكاديمية / حصة جماعية";
  const attId = crypto.randomUUID();

  await db.transaction(async () => {
    db.run("UPDATE member_subscriptions SET sessions_used = ?, updated_at = ? WHERE id = ?", [
      newUsed,
      stampStr,
      sub.id,
    ]);

    db.run(
      `INSERT INTO attendance (id, member_id, card_id, subscription_id, checkin_at, created_by, notes, branch_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        attId,
        input.memberId,
        sub.id,
        stampStr,
        actor.userId,
        input.notes ? input.notes : `حضور حصة: ${className}`,
        getLocalBranchId(db),
      ],
    );

    recordAudit(db, actor, "CLASS_ROSTER_SAVED", "class", cls?.id ? String(cls.id) : (sub?.plan_id ? String(sub.plan_id) : "unknown"), {
      memberId: input.memberId,
      subscriptionId: sub.id,
      sessionsRemaining: newRemaining,
    });
  });

  let warning: string | undefined;
  if (newRemaining !== null) {
    if (newRemaining === 0) {
      warning = "انتهت جميع حصص الاشتراك. يرجى تجديد الاشتراك.";
    } else if (newRemaining === 1) {
      warning = "متبقي حصة واحدة فقط في الاشتراك.";
    }
  }

  return {
    success: true,
    attendanceId: attId,
    memberId: String(member.id),
    memberName: String(member.full_name),
    sessionsUsed: newUsed,
    sessionsRemaining: newRemaining,
    warning,
  };
}

export async function recordBatchClassAttendance(
  db: Db,
  actor: ServiceActor,
  input: { classId: string; memberIds: string[] },
): Promise<{ attendedCount: number; errors: Array<{ memberId: string; error: string }> }> {
  requirePermission(actor, "classes.checkin");
  let attendedCount = 0;
  const errors: Array<{ memberId: string; error: string }> = [];

  for (const memberId of input.memberIds) {
    try {
      await recordDirectClassAttendance(db, actor, { classId: input.classId, memberId });
      attendedCount++;
    } catch (err: any) {
      errors.push({ memberId, error: err.messageKey || err.message || "error" });
    }
  }

  return { attendedCount, errors };
}

