import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, memberDepartmentById } from "./department";

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function num(v: unknown, fallback = 0): number {
  return v == null ? fallback : Number(v);
}
function stamp(): string {
  return nowStamp();
}

// --------------------------- body assessments ----------------------------

export interface AssessmentInput {
  memberId: string;
  assessmentDate: string;
  heightCm?: number | null;
  weightKg?: number | null;
  bodyFatPercent?: number | null;
  muscleMassKg?: number | null;
  bmi?: number | null;
  waistCm?: number | null;
  chestCm?: number | null;
  armCm?: number | null;
  thighCm?: number | null;
  notes?: string | null;
  trainerId?: string | null;
}

export interface PublicAssessment {
  id: string;
  memberId: string;
  assessmentDate: string;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
  bmi: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  notes: string | null;
  trainerId: string | null;
  createdAt: string;
}

const ASSESS_SELECT =
  "SELECT b.*, m.full_name AS member_name FROM body_assessments b JOIN members m ON m.id = b.member_id";

function mapAssessment(r: Row): PublicAssessment {
  return {
    id: str(r.id),
    memberId: str(r.member_id),
    assessmentDate: str(r.assessment_date),
    heightCm: numOrNull(r.height_cm),
    weightKg: numOrNull(r.weight_kg),
    bodyFatPercent: numOrNull(r.body_fat_percent),
    muscleMassKg: numOrNull(r.muscle_mass_kg),
    bmi: numOrNull(r.bmi),
    waistCm: numOrNull(r.waist_cm),
    chestCm: numOrNull(r.chest_cm),
    armCm: numOrNull(r.arm_cm),
    thighCm: numOrNull(r.thigh_cm),
    notes: r.notes == null ? null : str(r.notes),
    trainerId: r.trainer_id == null ? null : str(r.trainer_id),
    createdAt: str(r.created_at),
  };
}

export function computeBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const h = heightCm / 100;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

/** Append-only history: creation allowed, edits never happen. */
export async function createAssessment(
  db: Db,
  actor: ServiceActor,
  input: AssessmentInput,
): Promise<PublicAssessment> {
  requirePermission(actor, "assessments.manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.assessmentDate)) throw errValidation("errors.invalidDate");
  if (!db.first("SELECT id FROM members WHERE id = ?", [input.memberId]))
    throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, input.memberId));
  const bmi = input.bmi ?? computeBmi(input.weightKg ?? null, input.heightCm ?? null);
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO body_assessments (id, member_id, assessment_date, height_cm, weight_kg, body_fat_percent, muscle_mass_kg, bmi, waist_cm, chest_cm, arm_cm, thigh_cm, notes, trainer_id, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.memberId,
        input.assessmentDate,
        input.heightCm ?? null,
        input.weightKg ?? null,
        input.bodyFatPercent ?? null,
        input.muscleMassKg ?? null,
        bmi,
        input.waistCm ?? null,
        input.chestCm ?? null,
        input.armCm ?? null,
        input.thighCm ?? null,
        input.notes?.trim() || null,
        input.trainerId ?? null,
        actor.userId,
        stamp(),
      ],
    );
    recordAudit(db, actor, "ASSESSMENT_CREATED", "assessment", id, { memberId: input.memberId });
  });
  return mapAssessment(db.first<Row>("SELECT * FROM body_assessments WHERE id = ?", [id])!);
}

/** History immutable by design; deletion requires explicit manage permission. */
export async function deleteAssessment(db: Db, actor: ServiceActor, assessmentId: string): Promise<void> {
  requirePermission(actor, "assessments.manage");
  const row = db.first<Row>("SELECT * FROM body_assessments WHERE id = ?", [assessmentId]);
  if (!row) throw errNotFound("errors.assessmentNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));
  await db.transaction(async () => {
    db.run("DELETE FROM body_assessments WHERE id = ?", [assessmentId]);
    recordAudit(db, actor, "ASSESSMENT_DELETED", "assessment", assessmentId, {});
  });
}

export function listAssessments(db: Db, actor: ServiceActor, memberId: string, limit = 50): PublicAssessment[] {
  requirePermission(actor, "assessments.view");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  return db
    .all<Row>(`${ASSESS_SELECT} WHERE b.member_id = ? ORDER BY b.assessment_date DESC LIMIT ?`, [
      memberId,
      Math.min(200, Math.max(1, limit)),
    ])
    .map(mapAssessment);
}

export interface ProgressDelta {
  field: "weightKg" | "bodyFatPercent" | "muscleMassKg" | "bmi";
  latest: number | null;
  previous: number | null;
  delta: number | null;
}

export interface ProgressComparison {
  latest: PublicAssessment | null;
  previous: PublicAssessment | null;
  deltas: ProgressDelta[];
}

/** Change between the two most recent measurements per tracked field. */
export function getProgress(db: Db, actor: ServiceActor, memberId: string): ProgressComparison {
  requirePermission(actor, "assessments.view");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  const rows = db
    .all<Row>(`${ASSESS_SELECT} WHERE b.member_id = ? ORDER BY b.assessment_date DESC LIMIT 2`, [memberId])
    .map(mapAssessment);
  const latest = rows[0] ?? null;
  const previous = rows[1] ?? null;
  const fields: ProgressDelta["field"][] = ["weightKg", "bodyFatPercent", "muscleMassKg", "bmi"];
  const deltas = fields.map((f) => ({
    field: f,
    latest: latest ? ((latest[f] as number | null) ?? null) : null,
    previous: previous ? ((previous[f] as number | null) ?? null) : null,
    delta:
      latest && previous && latest[f] != null && previous[f] != null
        ? Math.round(((latest[f] as number) - (previous[f] as number)) * 10) / 10
        : null,
  }));
  return { latest, previous, deltas };
}

// ------------------------- custom fitness tests --------------------------

export interface FitnessTestDef {
  id: string;
  name: string;
  unit: string | null;
  isActive: boolean;
}

export function listFitnessTestDefs(db: Db, actor: ServiceActor, activeOnly = false): FitnessTestDef[] {
  requirePermission(actor, "assessments.view");
  const where = activeOnly ? "WHERE is_active = 1" : "";
  return db
    .all<Row>(`SELECT * FROM fitness_test_defs ${where} ORDER BY name`)
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      unit: r.unit == null ? null : str(r.unit),
      isActive: num(r.is_active, 1) === 1,
    }));
}

export async function upsertFitnessTestDef(
  db: Db,
  actor: ServiceActor,
  input: { name: string; unit?: string | null },
): Promise<FitnessTestDef> {
  requirePermission(actor, "assessments.manage");
  const name = input.name.trim();
  if (name.length < 2) throw errValidation("errors.fitnessDefNameShort");
  const existing = db.first("SELECT id FROM fitness_test_defs WHERE name = ?", [name]);
  let id: string;
  if (existing) {
    id = str(existing.id);
    db.run("UPDATE fitness_test_defs SET unit = ?, is_active = 1 WHERE id = ?", [
      input.unit?.trim() || null,
      id,
    ]);
  } else {
    id = crypto.randomUUID();
    db.run(
      "INSERT INTO fitness_test_defs (id, name, unit, is_active, created_by, created_at)\nVALUES (?, ?, ?, 1, ?, ?)",
      [id, name, input.unit?.trim() || null, actor.userId, stamp()],
    );
  }
  recordAudit(db, actor, "FITNESS_TEST_DEF_UPDATED", "fitness_test_def", id, { name });
  return { id, name, unit: input.unit?.trim() || null, isActive: true };
}

export async function recordFitnessResult(
  db: Db,
  actor: ServiceActor,
  input: { defId: string; memberId: string; value: number; testDate: string; notes?: string | null },
): Promise<{ id: string }> {
  requirePermission(actor, "assessments.manage");
  if (!db.first("SELECT id FROM fitness_test_defs WHERE id = ?", [input.defId]))
    throw errNotFound("errors.fitnessDefNotFound");
  if (!db.first("SELECT id FROM members WHERE id = ?", [input.memberId]))
    throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, input.memberId));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.testDate)) throw errValidation("errors.invalidDate");
  if (!Number.isFinite(Number(input.value))) throw errValidation("errors.invalidAmount");
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO fitness_test_results (id, def_id, member_id, value, test_date, notes, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.defId, input.memberId, Number(input.value), input.testDate, input.notes?.trim() || null, actor.userId, stamp()],
    );
    recordAudit(db, actor, "FITNESS_TEST_RESULT_RECORDED", "fitness_test_result", id, {
      memberId: input.memberId,
      defId: input.defId,
    });
  });
  return { id };
}

export interface FitnessResultRow {
  id: string;
  defName: string;
  unit: string | null;
  value: number;
  testDate: string;
  notes: string | null;
}

export function listFitnessResults(
  db: Db,
  actor: ServiceActor,
  query: { memberId?: string; defId?: string; limit?: number },
): FitnessResultRow[] {
  requirePermission(actor, "assessments.view");
  const limit = Math.min(300, Math.max(1, query.limit ?? 100));
  if (query.memberId) assertDepartmentAccess(actor, memberDepartmentById(db, query.memberId));
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (query.memberId) {
    conditions.push("r.member_id = ?");
    params.push(query.memberId);
  }
  if (query.defId) {
    conditions.push("r.def_id = ?");
    params.push(query.defId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<Row>(
      `SELECT r.*, d.name AS def_name, d.unit AS unit FROM fitness_test_results r JOIN fitness_test_defs d ON d.id = r.def_id ${where} ORDER BY r.test_date DESC LIMIT ?`,
      [...params, limit],
    )
    .map((r) => ({
      id: str(r.id),
      defName: str(r.def_name),
      unit: r.unit == null ? null : str(r.unit),
      value: num(r.value),
      testDate: str(r.test_date),
      notes: r.notes == null ? null : str(r.notes),
    }));
}