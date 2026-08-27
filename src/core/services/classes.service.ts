import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, roleHasPermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { consumeSession } from "./attendance.service";
import { assertDepartmentAccess, memberDepartmentById } from "./department";

type Num = string | number;
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// ------------------------------- classes ---------------------------------

export interface ClassInput {
  name: string;
  description?: string | null;
  trainerId?: string | null;
  location?: string | null;
  capacity: number;
  consumesSession?: boolean;
}

export interface GymClass {
  id: string;
  name: string;
  description: string | null;
  trainerId: string | null;
  trainerName: string | null;
  location: string | null;
  capacity: number;
  consumesSession: boolean;
  isActive: boolean;
}

const CLASS_SELECT =
  "SELECT c.*, t.full_name AS trainer_name FROM classes c LEFT JOIN trainers t ON t.id = c.trainer_id";

function mapClass(r: Row): GymClass {
  return {
    id: str(r.id),
    name: str(r.name),
    description: r.description == null ? null : str(r.description),
    trainerId: r.trainer_id == null ? null : str(r.trainer_id),
    trainerName: r.trainer_name == null ? null : str(r.trainer_name),
    location: r.location == null ? null : str(r.location),
    capacity: num(r.capacity),
    consumesSession: num(r.consumes_session) === 1,
    isActive: num(r.is_active, 1) === 1,
  };
}

export function listClasses(
  db: Db,
  actor: ServiceActor,
  query: { search?: string; includeInactive?: boolean } = {},
): GymClass[] {
  requirePermission(actor, "classes.view");
  const conditions: string[] = [];
  const params: Num[] = [];
  if (!query.includeInactive) conditions.push("c.is_active = 1");
  const search = query.search?.trim();
  if (search) {
    conditions.push("(c.name LIKE ? OR c.location LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.all<Row>(`${CLASS_SELECT} ${where} ORDER BY c.name`).map(mapClass);
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
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO classes (id, name, description, trainer_id, location, capacity, consumes_session, is_active, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      [
        id,
        name,
        input.description?.trim() || null,
        input.trainerId ?? null,
        input.location?.trim() || null,
        capacity,
        input.consumesSession ? 1 : 0,
        actor.userId,
        stamp(),
        stamp(),
      ],
    );
    recordAudit(db, actor, "CLASS_CREATED", "class", id, { name });
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
  await db.transaction(async () => {
    db.run(
      "UPDATE classes SET name = ?, description = ?, trainer_id = ?, location = ?, capacity = ?, consumes_session = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [
        patch.name?.trim() ?? str(current.name),
        patch.description !== undefined ? patch.description?.trim() || null : current.description,
        patch.trainerId !== undefined ? patch.trainerId : current.trainer_id,
        patch.location !== undefined ? patch.location?.trim() || null : current.location,
        patch.capacity !== undefined ? Math.floor(patch.capacity) : num(current.capacity),
        patch.consumesSession !== undefined ? (patch.consumesSession ? 1 : 0) : num(current.consumes_session),
        patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : num(current.is_active, 1),
        stamp(),
        classId,
      ],
    );
    recordAudit(db, actor, "CLASS_UPDATED", "class", classId, {});
  });
  return mapClass(getClassRow(db, classId));
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
}

const SESSION_SELECT =
  "SELECT cs.*, c.name AS class_name, c.consumes_session AS consumes_session, c.location AS location, t.full_name AS trainer_name,\n(SELECT COUNT(*) FROM class_bookings b WHERE b.session_id = cs.id AND b.status IN ('booked','attended')) AS booked_count,\n(SELECT COUNT(*) FROM class_bookings b2 WHERE b2.session_id = cs.id AND b2.status = 'attended') AS attended_count\nFROM class_sessions cs JOIN classes c ON c.id = cs.class_id LEFT JOIN trainers t ON t.id = c.trainer_id";

function mapSession(r: Row): ClassSession {
  return {
    id: str(r.id),
    classId: str(r.class_id),
    className: str(r.class_name),
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
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO class_sessions (id, class_id, session_date, start_time, duration_min, capacity, status, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)",
      [id, classId, input.sessionDate, input.startTime, duration, capacity, actor.userId, stamp()],
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

// ------------------------------ bookings ---------------------------------

export interface BookingRow {
  id: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  status: "booked" | "attended" | "cancelled" | "no_show";
  consumedSubscriptionId: string | null;
  bookedAt: string;
}

export function listBookings(db: Db, actor: ServiceActor, sessionId: string): BookingRow[] {
  requirePermission(actor, "classes.view");
  return db
    .all<Row>(
      "SELECT b.*, m.full_name AS member_name, m.member_code AS member_code FROM class_bookings b JOIN members m ON m.id = b.member_id WHERE b.session_id = ? ORDER BY b.booked_at",
      [sessionId],
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
    }));
}

export function listMemberBookings(db: Db, actor: ServiceActor, memberId: string, limit = 30): BookingRow[] {
  requirePermission(actor, "classes.view");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  return db
    .all<Row>(
      "SELECT b.*, m.full_name AS member_name, m.member_code AS member_code FROM class_bookings b JOIN members m ON m.id = b.member_id WHERE b.member_id = ? ORDER BY b.booked_at DESC LIMIT ?",
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

  const bookedCount = Number(
    db.scalar(
      "SELECT COUNT(*) FROM class_bookings WHERE session_id = ? AND status IN ('booked','attended')",
      [input.sessionId],
    ) ?? 0,
  );
  const capacity = num(session.capacity);
  const wantsOverride = bookedCount >= capacity;
  if (wantsOverride) {
    const allowed =
      input.overrideCapacity === true &&
      (actor.roleId === "owner" || roleHasPermission(actor.roleId, "classes.manage"));
    if (!allowed) throw errConflict("errors.classFull", { capacity });
  }

  await db.transaction(async () => {
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
        // find the member's active session-based subscription with remaining sessions
        const sub = db.first<Row>(
          "SELECT s.id FROM member_subscriptions s JOIN membership_plans p ON p.id = s.plan_id\nWHERE s.member_id = ? AND s.status = 'active' AND p.kind = 'sessions'\nAND s.sessions_total IS NOT NULL AND s.sessions_used < s.sessions_total\nORDER BY (s.sessions_total - s.sessions_used) ASC LIMIT 1",
          [str(row.member_id)],
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

function stamp(): string {
  return nowStamp();
}
