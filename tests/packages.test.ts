import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { assignCardByBarcode } from "@/core/services/cards.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import * as packages from "@/core/services/packages.service";
import { updateSetting } from "@/core/services/settings.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  owner = buildActor(
    await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
});

const sample = {
  name: "اشتراك 90 يوم",
  model: "hybrid" as packages.PackageModel,
  durationDays: 90,
  price: 45000,
  visitLimit: 20,
  unlimitedVisits: false,
  freezeAllowanceDays: 10,
  allowedFreezes: 2,
  ptSessions: 4,
  allowedAreas: ["general", "men"] as packages.AccessArea[],
  description: "باقة شاملة",
};

describe("package authorization", () => {
  it("denies view to users without packages.view and create to non-managers", async () => {
    const trainer = buildActor(
      await createUser(db, owner, {
        username: "trainer",
        password: "Trainer@2026",
        fullName: "مدرب",
        roleId: "trainer",
      }),
    );
    expect(() => packages.listPackages(db, trainer, true)).toThrow();

    await expect(packages.createPackage(db, reception, sample as never)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      packages.createPackage(db, reception, {} as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("package CRUD + validation", () => {
  it("creates a package and mirrors a synthetic plan", async () => {
    const pkg = await packages.createPackage(db, owner, sample);
    expect(pkg.name).toBe(sample.name);
    expect(pkg.model).toBe("hybrid");
    expect(pkg.price).toBe(45000);
    expect(pkg.isActive).toBe(true);
    expect(pkg.syntheticPlanId).toBeTruthy();

    const plan = db.first<{ id: string; kind: string; sessions_count: number | null }>(
      "SELECT id, kind, sessions_count FROM membership_plans WHERE id = ?",
      [pkg.syntheticPlanId!],
    );
    expect(plan).toBeTruthy();
    expect(plan!.kind).toBe("sessions");
    expect(plan!.sessions_count).toBe(20);
  });

  it("maps time model to a time plan and visit model to a sessions plan", async () => {
    const t = await packages.createPackage(db, owner, {
      name: "بالوقت",
      model: "time",
      durationDays: 30,
      price: 30000,
    });
    expect(
      db.first<{ kind: string }>("SELECT kind FROM membership_plans WHERE id = ?", [t.syntheticPlanId!])!.kind,
    ).toBe("time");

    const v = await packages.createPackage(db, owner, {
      name: "بالزيارات",
      model: "visit",
      durationDays: 30,
      price: 20000,
      visitLimit: 10,
    });
    expect(
      db.first<{ kind: string }>("SELECT kind FROM membership_plans WHERE id = ?", [v.syntheticPlanId!])!.kind,
    ).toBe("sessions");
  });

  it("validates input: name, model, duration, price, areas, visits, freeze", async () => {
    await expect(packages.createPackage(db, owner, { ...sample, name: "" })).rejects.toMatchObject({
      messageKey: "errors.packageNameRequired",
    });
    await expect(
      packages.createPackage(db, owner, { ...sample, model: "ghost" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      packages.createPackage(db, owner, { ...sample, durationDays: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      packages.createPackage(db, owner, { ...sample, price: -1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      packages.createPackage(db, owner, { ...sample, visitLimit: 0 }),
    ).rejects.toMatchObject({ messageKey: "errors.packageVisitLimitInvalid" });
    await expect(
      packages.createPackage(db, owner, { ...sample, allowedAreas: ["roof"] as never }),
    ).rejects.toMatchObject({ messageKey: "errors.packageAreaInvalid" });
    await expect(
      packages.createPackage(db, owner, { ...sample, allowedFreezes: -2 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      packages.createPackage(db, owner, { ...sample, ptSessions: -1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await packages.createPackage(db, owner, sample);
    await expect(packages.createPackage(db, owner, sample)).rejects.toMatchObject({
      messageKey: "errors.packageNameTaken",
    });
  });

  it("allows unlimited visits without a visit limit for visit/hybrid models", async () => {
    const pkg = await packages.createPackage(db, owner, {
      name: "زيارات غير محدودة",
      model: "visit",
      durationDays: 30,
      price: 30000,
      unlimitedVisits: true,
      visitLimit: undefined,
    });
    expect(pkg.unlimitedVisits).toBe(true);
    // unlimited visits produce no sessions_count on the synthetic plan
    expect(
      db.first<{ sessions_count: number | null; kind: string }>(
        "SELECT sessions_count, kind FROM membership_plans WHERE id = ?",
        [pkg.syntheticPlanId!],
      ),
    ).toMatchObject({ sessions_count: null, kind: "time" });
  });

  it("creates an unlimited-visit subscription and allows check-in without consuming sessions", async () => {
    const pkg = await packages.createPackage(db, owner, {
      name: "زيارات مفتوحة للاشتراك",
      model: "visit",
      durationDays: 30,
      price: 30000,
      unlimitedVisits: true,
    });
    const member = await createMember(db, owner, { fullName: "زيارات مفتوحة" });
    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    expect(sub.sessionsTotal).toBeNull();
    expect(sub.kind).toBe("time");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "PKG-UL-0001",
      memberId: member.id,
    });
    updateSetting(db, owner, "checkin_duplicate_window_seconds", "0");
    const ok1 = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(ok1.kind).toBe("success");
    const ok2 = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(ok2.kind).toBe("success");
    expect(ok2).toMatchObject({ sessionsRemaining: null });
  });

  it("still creates a subscription when a legacy unlimited plan is kind sessions with no count", async () => {
    const pkg = await packages.createPackage(db, owner, {
      name: "باقة قديمة غير محدودة",
      model: "visit",
      durationDays: 30,
      price: 30000,
      unlimitedVisits: true,
    });
    db.run("UPDATE membership_plans SET kind = 'sessions', sessions_count = NULL WHERE id = ?", [
      pkg.syntheticPlanId!,
    ]);
    const member = await createMember(db, owner, { fullName: "اشتراك باقة قديمة" });
    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    expect(sub.sessionsTotal).toBeNull();
  });

  it("updates a package and re-syncs its synthetic plan", async () => {
    const pkg = await packages.createPackage(db, owner, sample);
    const updated = await packages.updatePackage(db, owner, pkg.id, {
      price: 60000,
      durationDays: 60,
      visitLimit: 15,
    });
    expect(updated.price).toBe(60000);
    expect(updated.durationDays).toBe(60);
    const plan = db.first<{ price: number; duration_days: number; sessions_count: number | null }>(
      "SELECT price, duration_days, sessions_count FROM membership_plans WHERE id = ?",
      [pkg.syntheticPlanId!],
    )!;
    expect(plan.price).toBe(60000);
    expect(plan.duration_days).toBe(60);
    expect(plan.sessions_count).toBe(15);
  });

  it("toggles active status and reflects it on the synthetic plan", async () => {
    const pkg = await packages.createPackage(db, owner, sample);
    const off = await packages.setPackageActive(db, owner, pkg.id, false);
    expect(off.isActive).toBe(false);
    expect(
      db.first<{ is_active: number }>("SELECT is_active FROM membership_plans WHERE id = ?", [
        pkg.syntheticPlanId!,
      ])!.is_active,
    ).toBe(0);
  });

  it("duplicates a package with a new name and independent synthetic plan", async () => {
    const pkg = await packages.createPackage(db, owner, sample);
    const dup = await packages.duplicatePackage(db, owner, pkg.id);
    expect(dup.name.startsWith(`${sample.name} (نسخة)`)).toBe(true);
    expect(dup.id).not.toBe(pkg.id);
    expect(dup.syntheticPlanId).not.toBe(pkg.syntheticPlanId);
    expect(dup.price).toBe(pkg.price);
    expect(dup.visitLimit).toBe(20);
  });
});

describe("package stats", () => {
  it("aggregates counts and active subscriptions by package", async () => {
    const pkg = await packages.createPackage(db, owner, sample);
    const member = await createMember(db, owner, { fullName: "عميل باقة" });
    await createSubscription(db, owner, {
      memberId: member.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    // a subscription on the synthetic plan WITHOUT packageId is not attributed
    const other = await createMember(db, owner, { fullName: "عميل عادي" });
    await createSubscription(db, owner, { memberId: other.id, planId: pkg.syntheticPlanId! });

    const stats = packages.packageStats(db, owner);
    expect(stats.totalPackages).toBe(1);
    expect(stats.activePackages).toBe(1);
    // only the packageId-linked subscription is counted
    expect(stats.perPackage[0].totalSubscriptions).toBe(1);
    expect(stats.totalSubscriptions).toBe(1);
    expect(stats.byModel.hybrid).toBe(1);
  });
});

describe("package subscription snapshot + check-in", () => {
  it("snapshots the package config onto the subscription row", async () => {
    const pkg = await packages.createPackage(db, owner, sample);
    const member = await createMember(db, owner, { fullName: "اشتراك باقة" });
    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    const row = db.first<{
      package_id: string | null;
      package_name: string | null;
      package_model: string | null;
      package_visit_limit: number | null;
      package_freeze_allowance_days: number;
      package_allowed_freezes: number;
      package_pt_sessions: number;
    }>("SELECT package_id, package_name, package_model, package_visit_limit, package_freeze_allowance_days, package_allowed_freezes, package_pt_sessions FROM member_subscriptions WHERE id = ?", [sub.id])!;
    expect(row.package_id).toBe(pkg.id);
    expect(row.package_name).toBe(sample.name);
    expect(row.package_model).toBe("hybrid");
    expect(row.package_visit_limit).toBe(20);
    expect(row.package_freeze_allowance_days).toBe(10);
    expect(row.package_allowed_freezes).toBe(2);
    expect(row.package_pt_sessions).toBe(4);
  });

  it("decrements visits on check-in for a visit/hybrid package and denies when exhausted", async () => {
    const pkg = await packages.createPackage(db, owner, {
      name: "زيارات محدودة",
      model: "visit",
      durationDays: 30,
      price: 30000,
      visitLimit: 2,
    });
    const member = await createMember(db, owner, { fullName: "زيارات" });
    await createSubscription(db, owner, {
      memberId: member.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "PKG-900001",
      memberId: member.id,
    });
    // disable the duplicate-scan window so successive check-ins are allowed
    updateSetting(db, owner, "checkin_duplicate_window_seconds", "0");

    const ok1 = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(ok1.kind).toBe("success");
    const ok2 = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(ok2.kind).toBe("success");
    const denied = await recordCheckIn(db, owner, { barcode: card.barcodeValue });
    expect(denied).toMatchObject({ kind: "denied", reason: "NO_SESSIONS_LEFT" });
  });

  it("enforces the package allowed-freeze limit", async () => {
    const pkg = await packages.createPackage(db, owner, {
      name: "تجميد محدود",
      model: "time",
      durationDays: 30,
      price: 20000,
      allowedFreezes: 1,
      freezeAllowanceDays: 90,
    });
    const member = await createMember(db, owner, { fullName: "تجميد" });
    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: pkg.syntheticPlanId!,
      packageId: pkg.id,
    });
    const { freezeSubscription, unfreezeSubscription } = await import(
      "@/core/services/subscriptions.service"
    );
    const subEnd = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [sub.id])!
    ).end_date;
    await freezeSubscription(db, owner, sub.id, { endDate: subEnd, reason: "سفر" });
    await unfreezeSubscription(db, owner, sub.id);
    await expect(freezeSubscription(db, owner, sub.id, { endDate: subEnd, reason: "مرة أخرى" })).rejects.toMatchObject(
      { messageKey: "errors.freezeMaxReached" },
    );
  });
});
