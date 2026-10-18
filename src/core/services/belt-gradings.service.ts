import { nowStamp, todayKey } from "@/core/dates";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row, SqlValue } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getLocalBranchId } from "@/core/branch";

export interface MemberBeltGrading {
  id: string;
  memberId: string;
  discipline: string;
  beltName: string;
  beltColor: string;
  gradingDate: string;
  examinerName: string | null;
  scoreOrGrade: string | null;
  certificateNo: string | null;
  notes: string | null;
  branchId: string;
  createdAt: string;
  createdBy: string;
}

export interface MemberBeltGradingWithMember extends MemberBeltGrading {
  memberName: string;
  memberCode: string;
  memberPhone: string | null;
  emergencyContactPhone: string | null;
  emergencyContactName: string | null;
}

export interface RecordGradingInput {
  memberId: string;
  discipline: string;
  beltName: string;
  beltColor?: string;
  gradingDate?: string;
  examinerName?: string | null;
  scoreOrGrade?: string | null;
  certificateNo?: string | null;
  notes?: string | null;
}

export function listMemberGradings(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): MemberBeltGrading[] {
  requirePermission(actor, "classes.view");
  const rows = db.all<Row>(
    `SELECT * FROM member_belt_gradings
     WHERE member_id = ?
     ORDER BY grading_date DESC, created_at DESC`,
    [memberId],
  );

  return rows.map((r) => ({
    id: String(r.id),
    memberId: String(r.member_id),
    discipline: String(r.discipline),
    beltName: String(r.belt_name),
    beltColor: String(r.belt_color || "#10B981"),
    gradingDate: String(r.grading_date),
    examinerName: r.examiner_name == null ? null : String(r.examiner_name),
    scoreOrGrade: r.score_or_grade == null ? null : String(r.score_or_grade),
    certificateNo: r.certificate_no == null ? null : String(r.certificate_no),
    notes: r.notes == null ? null : String(r.notes),
    branchId: String(r.branch_id || "main"),
    createdAt: String(r.created_at),
    createdBy: String(r.created_by),
  }));
}

export function listAllGradings(
  db: Db,
  actor: ServiceActor,
  filter?: {
    discipline?: string;
    memberId?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
  },
): MemberBeltGradingWithMember[] {
  requirePermission(actor, "classes.view");

  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.discipline) {
    conditions.push("g.discipline = ?");
    params.push(filter.discipline);
  }
  if (filter?.memberId) {
    conditions.push("g.member_id = ?");
    params.push(filter.memberId);
  }
  if (filter?.fromDate) {
    conditions.push("g.grading_date >= ?");
    params.push(filter.fromDate);
  }
  if (filter?.toDate) {
    conditions.push("g.grading_date <= ?");
    params.push(filter.toDate);
  }
  if (filter?.search) {
    const q = `%${filter.search.trim()}%`;
    conditions.push("(m.full_name LIKE ? OR m.member_code LIKE ? OR g.belt_name LIKE ? OR g.certificate_no LIKE ?)");
    params.push(q, q, q, q);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.all<Row>(
    `SELECT g.*, m.full_name AS member_name, m.member_code, m.phone AS member_phone,
            m.emergency_contact_phone, m.emergency_contact_name
     FROM member_belt_gradings g
     JOIN members m ON m.id = g.member_id
     ${where}
     ORDER BY g.grading_date DESC, g.created_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: String(r.id),
    memberId: String(r.member_id),
    discipline: String(r.discipline),
    beltName: String(r.belt_name),
    beltColor: String(r.belt_color || "#10B981"),
    gradingDate: String(r.grading_date),
    examinerName: r.examiner_name == null ? null : String(r.examiner_name),
    scoreOrGrade: r.score_or_grade == null ? null : String(r.score_or_grade),
    certificateNo: r.certificate_no == null ? null : String(r.certificate_no),
    notes: r.notes == null ? null : String(r.notes),
    branchId: String(r.branch_id || "main"),
    createdAt: String(r.created_at),
    createdBy: String(r.created_by),
    memberName: String(r.member_name),
    memberCode: String(r.member_code),
    memberPhone: r.member_phone == null ? null : String(r.member_phone),
    emergencyContactPhone: r.emergency_contact_phone == null ? null : String(r.emergency_contact_phone),
    emergencyContactName: r.emergency_contact_name == null ? null : String(r.emergency_contact_name),
  }));
}

export async function recordGrading(
  db: Db,
  actor: ServiceActor,
  input: RecordGradingInput,
): Promise<MemberBeltGrading> {
  requirePermission(actor, "classes.manage");

  if (!input.memberId) throw errValidation("errors.memberRequired");
  if (!input.discipline?.trim()) throw errValidation("errors.disciplineRequired");
  if (!input.beltName?.trim()) throw errValidation("errors.beltNameRequired");

  const member = db.first<Row>("SELECT id, full_name FROM members WHERE id = ?", [input.memberId]);
  if (!member) throw errNotFound("errors.memberNotFound");

  const id = crypto.randomUUID();
  const date = input.gradingDate || todayKey();
  const branchId = getLocalBranchId(db);
  const now = nowStamp();

  const certNo =
    input.certificateNo?.trim() ||
    `CERT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  await db.transaction(async () => {
    db.run(
      `INSERT INTO member_belt_gradings (
        id, member_id, discipline, belt_name, belt_color, grading_date,
        examiner_name, score_or_grade, certificate_no, notes, branch_id,
        created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.memberId,
        input.discipline.trim(),
        input.beltName.trim(),
        input.beltColor?.trim() || "#10B981",
        date,
        input.examinerName?.trim() || null,
        input.scoreOrGrade?.trim() || null,
        certNo,
        input.notes?.trim() || null,
        branchId,
        now,
        actor.userId,
      ],
    );

    recordAudit(db, actor, "MEMBER_UPDATED", "member_belt_grading", id, {
      memberId: input.memberId,
      memberName: member.full_name,
      discipline: input.discipline,
      beltName: input.beltName,
      certificateNo: certNo,
    });
  });

  return {
    id,
    memberId: input.memberId,
    discipline: input.discipline.trim(),
    beltName: input.beltName.trim(),
    beltColor: input.beltColor?.trim() || "#10B981",
    gradingDate: date,
    examinerName: input.examinerName?.trim() || null,
    scoreOrGrade: input.scoreOrGrade?.trim() || null,
    certificateNo: certNo,
    notes: input.notes?.trim() || null,
    branchId,
    createdAt: now,
    createdBy: actor.userId,
  };
}

export async function deleteGrading(
  db: Db,
  actor: ServiceActor,
  gradingId: string,
): Promise<void> {
  requirePermission(actor, "classes.manage");

  const row = db.first<Row>("SELECT * FROM member_belt_gradings WHERE id = ?", [gradingId]);
  if (!row) throw errNotFound("errors.notFound");

  await db.transaction(async () => {
    db.run("DELETE FROM member_belt_gradings WHERE id = ?", [gradingId]);
    recordAudit(db, actor, "MEMBER_UPDATED", "member_belt_grading", gradingId, {
      deleted: true,
      memberId: row.member_id,
      beltName: row.belt_name,
    });
  });
}

export function buildParentAttendanceMessage(data: {
  memberName: string;
  className: string;
  date?: string;
  time?: string;
  sessionsRemaining: number | null;
  gymName?: string;
}): string {
  const gName = data.gymName || "جيم جيت (GymGate)";
  const dateStr = data.date || todayKey();
  const timeStr = data.time || new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  const remainingStr =
    data.sessionsRemaining !== null ? `• رصيد الحصص المتبقي: ${data.sessionsRemaining} حصة` : "• نوع الاشتراك: مفتوح";

  return `🥋 *إشعار حضور تمرين الأكاديمية - ${gName}*

مرحباً ولي أمر بطلنا: *${data.memberName}* 👋
نحيطكم علماً بأنه تم تسجيل حضور التمرين بنجاح:
• الحصة: *${data.className}*
• التاريخ: ${dateStr}
• الوقت: ${timeStr}
${remainingStr}

نتمنى لبطلنا حصة تدريبية ممتعة وموفقة دائماً! 🥊💪`;
}
