import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  createAssessment,
  deleteAssessment,
  listAssessments,
  getProgress,
  computeBmi,
  upsertFitnessTestDef,
  recordFitnessResult,
  listFitnessResults,
} from "@/core/services/inbody.service";
import { addDaysKey, todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let trainer: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "مدرب",
      roleId: "trainer",
    }),
  );
});

async function makeMember(name = "عضو إن بادي") {
  return createMember(db, owner, {
    fullName: name,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

describe("body assessments", () => {
  it("creates an assessment with computed BMI", async () => {
    const m = await makeMember();
    const a = await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: todayKey(),
      heightCm: 170,
      weightKg: 80,
    });
    expect(a.heightCm).toBe(170);
    expect(a.weightKg).toBe(80);
    const expectedBmi = Math.round((80 / (1.7 * 1.7)) * 10) / 10;
    expect(a.bmi).toBe(expectedBmi);
  });

  it("lists assessments for a member ordered by date desc", async () => {
    const m = await makeMember();
    await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: addDaysKey(todayKey(), -10),
      weightKg: 85,
    });
    await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: todayKey(),
      weightKg: 80,
    });
    const list = listAssessments(db, owner, m.id);
    expect(list.length).toBe(2);
    expect(list[0].assessmentDate).toBe(todayKey());
  });

  it("computes progress between two assessments", async () => {
    const m = await makeMember();
    await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: addDaysKey(todayKey(), -30),
      weightKg: 85,
      heightCm: 170,
    });
    await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: todayKey(),
      weightKg: 80,
      heightCm: 170,
    });
    const progress = getProgress(db, owner, m.id);
    expect(progress.latest).not.toBeNull();
    expect(progress.previous).not.toBeNull();
    const weightDelta = progress.deltas.find((d) => d.field === "weightKg");
    expect(weightDelta!.delta).toBe(-5);
  });

  it("deletes an assessment with manage permission", async () => {
    const m = await makeMember();
    const a = await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: todayKey(),
      weightKg: 80,
    });
    await deleteAssessment(db, owner, a.id);
    expect(listAssessments(db, owner, m.id).length).toBe(0);
  });

  it("denies trainer from deleting assessment", async () => {
    const m = await makeMember();
    const a = await createAssessment(db, owner, {
      memberId: m.id,
      assessmentDate: todayKey(),
      weightKg: 80,
    });
    await expect(deleteAssessment(db, trainer, a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("computeBmi", () => {
  it("returns null when inputs are missing", () => {
    expect(computeBmi(null, 170)).toBeNull();
    expect(computeBmi(80, null)).toBeNull();
  });

  it("computes BMI correctly", () => {
    const bmi = computeBmi(80, 170);
    expect(bmi).toBe(Math.round((80 / (1.7 * 1.7)) * 10) / 10);
  });
});

describe("fitness tests", () => {
  it("upserts a fitness test def and is idempotent", async () => {
    const def = await upsertFitnessTestDef(db, owner, { name: "Bench Press", unit: "kg" });
    expect(def.name).toBe("Bench Press");
    expect(def.unit).toBe("kg");

    const def2 = await upsertFitnessTestDef(db, owner, { name: "Bench Press", unit: "kg" });
    expect(def2.id).toBe(def.id);

    const defs = db.count("SELECT COUNT(*) FROM fitness_test_defs WHERE name = 'Bench Press'");
    expect(defs).toBe(1);
  });

  it("records and lists fitness results", async () => {
    const m = await makeMember();
    const def = await upsertFitnessTestDef(db, owner, { name: "Squat", unit: "kg" });
    await recordFitnessResult(db, owner, {
      defId: def.id,
      memberId: m.id,
      value: 120,
      testDate: todayKey(),
    });
    const results = listFitnessResults(db, owner, { memberId: m.id });
    expect(results.length).toBe(1);
    expect(results[0].defName).toBe("Squat");
    expect(results[0].value).toBe(120);
  });
});
