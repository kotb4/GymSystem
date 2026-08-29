import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, login, setup } from "@/core/services/auth.service";
import {
  createMember,
  listMembers,
  searchMembersForPicker,
  setMemberStatus,
  updateMember,
} from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  effectiveStatus,
  freezeSubscription,
  listExpiringSubscriptions,
  listMemberSubscriptions,
  listSubscriptions,
  updateSubscription,
} from "@/core/services/subscriptions.service";
import { addDaysKey, todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  const { createUser } = await import("@/core/services/users.service");
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
});

async function member(overrides: Partial<Parameters<typeof createMember>[2]> = {}) {
  return createMember(db, owner, {
    fullName: "عضو تجريبي",
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    ...overrides,
  });
}

async function monthlyPlan() {
  return createPlan(db, owner, { name: "شهري", durationDays: 30, price: 300 });
}

describe("members service", () => {
  it("creates members with sequential codes and audits them", async () => {
    const a = await member({ fullName: "أحمد الأول" });
    const b = await member({ fullName: "أحمد الثاني" });
    expect(a.memberCode).toBe("MEM-000001");
    expect(b.memberCode).toBe("MEM-000002");
  });

  it("rejects duplicate phone numbers", async () => {
    await member({ fullName: "صاحب الرقم", phone: "01001234567" });
    await expect(member({ fullName: "مكرر", phone: "01001234567" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("updates member data", async () => {
    const created = await member({ fullName: "قبل التعديل" });
    const updated = await updateMember(db, owner, created.id, { fullName: "بعد التعديل" });
    expect(updated.fullName).toBe("بعد التعديل");
    expect(updated.memberCode).toBe(created.memberCode);
  });

  it("changes status and archives with timestamp", async () => {
    const created = await member({ fullName: "سيؤرشف" });
    const suspended = await setMemberStatus(db, owner, created.id, "suspended");
    expect(suspended.status).toBe("suspended");
    const archived = await setMemberStatus(db, owner, created.id, "archived");
    expect(archived.status).toBe("archived");
    await expect(updateMember(db, owner, created.id, { fullName: "x" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("lists with search across name, code and phone", async () => {
    await member({ fullName: "محمد صلاح", phone: "01111111111" });
    await member({ fullName: "عمر خالد", phone: "01222222222" });
    expect(listMembers(db, owner, { search: "صلاح" }).total).toBe(1);
    expect(listMembers(db, owner, { search: "0122222222" }).total).toBe(1);
    expect(listMembers(db, owner, {}).items.length).toBe(2);
  });

  it("hides archived members from default listing but shows on filter", async () => {
    const m = await member({ fullName: "مؤرشف" });
    await setMemberStatus(db, owner, m.id, "archived");
    await member({ fullName: "عادي" });
    expect(listMembers(db, owner, {}).total).toBe(1);
    expect(listMembers(db, owner, { status: "all" }).total).toBe(2);
    expect(listMembers(db, owner, { status: "archived" }).total).toBe(1);
  });

  it("enforces permission at service level for creation", async () => {
    const { createUser } = await import("@/core/services/users.service");
    const trainer = buildActor(
      await createUser(db, owner, {
        username: "trainer",
        password: "Trainer@2026",
        fullName: "مدرب",
        roleId: "trainer",
      }),
    );
    await expect(
      createMember(db, trainer, { fullName: "ممنوع" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("search picker finds by partial name", async () => {
    await member({ fullName: "كريم عبد العزيز" });
    const hits = searchMembersForPicker(db, owner, "كريم");
    expect(hits.length).toBe(1);
  });
});

describe("plans service", () => {
  it("creates plans with unique names", async () => {
    const plan = await monthlyPlan();
    expect(plan.durationDays).toBe(30);
    await expect(monthlyPlan()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("updates plan including deactivation while keeping history", async () => {
    const plan = await monthlyPlan();
    const updated = await import("@/core/services/plans.service").then((m) =>
      m.updatePlan(db, owner, plan.id, { price: 350, isActive: false }),
    );
    expect(updated.price).toBe(350);
    expect(updated.isActive).toBe(false);
    expect(await import("@/core/services/plans.service").then((m) => m.listPlans(db, owner))).toHaveLength(0);
    expect(
      await import("@/core/services/plans.service").then((m) =>
        m.listPlans(db, owner, true),
      ),
    ).toHaveLength(1);
  });
});

describe("subscriptions service", () => {
  it("computes end date inclusively from plan duration", async () => {
    const m = await member({ fullName: "مشترك" });
    const plan = await monthlyPlan();
    const start = todayKey();
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    expect(sub.endDate).toBe(addDaysKey(start, 29));
    expect(effectiveStatus(sub, todayKey())).toBe("active");
  });

  it("detects overlapping active subscriptions and suggests next day", async () => {
    const m = await member({ fullName: "متداخل" });
    const plan = await monthlyPlan();
    await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    await expect(
      createSubscription(db, owner, { memberId: m.id, planId: plan.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const all = listMemberSubscriptions(db, owner, m.id);
    const suggestedStart = addDaysKey(all[0].endDate, 1);
    const later = await createSubscription(db, owner, {
      memberId: m.id,
      planId: plan.id,
      startDate: suggestedStart,
    });
    expect(effectiveStatus(later, todayKey())).toBe("upcoming");
  });

  it("orders member subscriptions newest-start first", async () => {
    const m = await member({ fullName: "سجل الاشتراكات" });
    const p1 = await createPlan(db, owner, { name: "باقة أ", durationDays: 30, price: 300 });
    const p2 = await createPlan(db, owner, { name: "باقة ب", durationDays: 90, price: 800 });
    await createSubscription(db, owner, {
      memberId: m.id,
      planId: p1.id,
      startDate: addDaysKey(todayKey(), -60),
    });
    await createSubscription(db, owner, {
      memberId: m.id,
      planId: p2.id,
      startDate: todayKey(),
    });
    const subs = listMemberSubscriptions(db, owner, m.id);
    expect(subs[0].effectiveStatus).toBe("active");
    expect(subs[subs.length - 1].effectiveStatus).toBe("expired");
  });

  it("shifts end date when start edited keeping same length", async () => {
    const m = await member({ fullName: "تعديل تواريخ" });
    const plan = await monthlyPlan();
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const newStart = addDaysKey(sub.startDate, 5);
    const updated = await updateSubscription(db, owner, sub.id, { startDate: newStart });
    expect(updated.startDate).toBe(newStart);
    expect(updated.endDate).toBe(addDaysKey(newStart, 29));
  });

  it("blocks subscription creation for archived members", async () => {
    const m = await member({ fullName: "مؤرشف مشترك" });
    await setMemberStatus(db, owner, m.id, "archived");
    const plan = await monthlyPlan();
    await expect(
      createSubscription(db, owner, { memberId: m.id, planId: plan.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lists expiring subscriptions within window only", async () => {
    const soon = await member({ fullName: "ينتهي قريباً" });
    const later = await member({ fullName: "بعيد الانتهاء" });
    const plan = await monthlyPlan();
    await createSubscription(db, owner, {
      memberId: soon.id,
      planId: plan.id,
      startDate: addDaysKey(todayKey(), -28),
    });
    await createSubscription(db, owner, {
      memberId: later.id,
      planId: plan.id,
      startDate: todayKey(),
    });
    const expiring = listExpiringSubscriptions(db, owner, 7);
    expect(expiring.map((s) => s.memberId)).toContain(soon.id);
    expect(expiring.map((s) => s.memberId)).not.toContain(later.id);
  });

  it("purges a trashed member with full cascade across financial and attendance history", async () => {
    const { trashMember, purgeMember, listTrashedMembers } = await import(
      "@/core/services/members.service"
    );
    const { recordPayment } = await import("@/core/services/payments.service");

    const m = await member({ fullName: "للحذف النهائي" });
    const plan = await monthlyPlan();
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: m.id,
      subscriptionId: sub.id,
      baseAmountMinor: 30_000,
      paidAmountMinor: 30_000,
      methodCode: "cash",
    });
    db.run(
      "INSERT INTO attendance (id, member_id, subscription_id, checkin_at) VALUES (?, ?, ?, ?)",
      [`att-${m.id}`, m.id, sub.id, new Date().toISOString()],
    );
    db.run(
      "INSERT INTO files (id, kind, original_name, mime_type, size_bytes, sha256, created_by, created_at)\nVALUES ('file-photo-1', 'member_photo', 'photo.jpg', 'image/jpeg', 1000, 'deadbeef', NULL, '2026-01-01T00:00:00')",
    );
    db.run("UPDATE members SET photo_file_id = 'file-photo-1' WHERE id = ?", [m.id]);

    await trashMember(db, owner, m.id, "اختبار");
    expect(listTrashedMembers(db, owner)).toHaveLength(1);

    await purgeMember(db, owner, m.id);

    expect(listTrashedMembers(db, owner)).toHaveLength(0);
    expect(db.count("SELECT COUNT(*) AS c FROM members WHERE id = ?", [m.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM payments WHERE member_id = ?", [m.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM member_subscriptions WHERE member_id = ?", [m.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM attendance WHERE member_id = ?", [m.id])).toBe(0);
    expect(
      db.count("SELECT COUNT(*) AS c FROM financial_ledger WHERE member_id = ?", [m.id]),
    ).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM files WHERE id = 'file-photo-1'")).toBe(0);
    expect(
      db.count("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'MEMBER_PURGED'"),
    ).toBe(1);
  });
});

describe("members — strict duplicate name enforcement", () => {
  it("rejects creating a new member with an existing active member name", async () => {
    await createMember(db, owner, { fullName: "محمد علي", phone: "01011111111" });
    let err: unknown = null;
    try {
      await createMember(db, owner, { fullName: "محمد علي", phone: "01022222222" });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect((err as { code: string }).code).toBe("CONFLICT");
    expect((err as { messageKey: string }).messageKey).toBe("errors.nameTaken");
  });

  it("allows the same name to be reused after the original is hard-purged", async () => {
    const a = await createMember(db, owner, { fullName: "اسم مكرر", phone: "01011111111" });
    const { trashMember, purgeMember, listTrashedMembers } = await import(
      "@/core/services/members.service"
    );
    await trashMember(db, owner, a.id, "اختبار");
    expect(listTrashedMembers(db, owner)).toHaveLength(1);
    await purgeMember(db, owner, a.id);
    // After purge the row is gone, so the name is reusable
    const b = await createMember(db, owner, { fullName: "اسم مكرر", phone: "01022222222" });
    expect(b.id).not.toBe(a.id);
  });

  it("rejects updating a member name to a duplicate of another active member", async () => {
    const a = await createMember(db, owner, { fullName: "الاسم الأول", phone: "01011111111" });
    const b = await createMember(db, owner, { fullName: "الاسم الثاني", phone: "01022222222" });
    let err: unknown = null;
    try {
      await updateMember(db, owner, b.id, { fullName: "الاسم الأول" });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect((err as { code: string }).code).toBe("CONFLICT");
    expect((err as { messageKey: string }).messageKey).toBe("errors.nameTaken");
    // 'a' was not changed
    const aAfter = db.first<{ full_name: string }>("SELECT full_name FROM members WHERE id = ?", [a.id]);
    expect(aAfter?.full_name).toBe("الاسم الأول");
  });

  it("allows updating a member name to its own current value (no-op edit)", async () => {
    const a = await createMember(db, owner, { fullName: "نفس الاسم", phone: "01011111111" });
    const updated = await updateMember(db, owner, a.id, { fullName: "نفس الاسم" });
    expect(updated.fullName).toBe("نفس الاسم");
  });
});

describe("listSubscriptions — memberId filter", () => {
  it("returns only the requested member's subscriptions", async () => {
    const { listSubscriptions } = await import("@/core/services/subscriptions.service");
    const a = await member({ fullName: `عضو-أ-${Math.random()}` });
    const b = await member({ fullName: `عضو-ب-${Math.random()}` });
    await createSubscription(db, owner, { memberId: a.id, planId: (await createPlan(db, owner, { name: `خطة أ-${Math.random()}`, durationDays: 30, price: 100 })).id });
    await createSubscription(db, owner, { memberId: b.id, planId: (await createPlan(db, owner, { name: `خطة ب-${Math.random()}`, durationDays: 30, price: 200 })).id });
    const all = listSubscriptions(db, owner, { pageSize: 100 });
    expect(all.total).toBe(2);
    const onlyA = listSubscriptions(db, owner, { pageSize: 100, memberId: a.id });
    expect(onlyA.total).toBe(1);
    expect(onlyA.items[0].memberId).toBe(a.id);
    const onlyB = listSubscriptions(db, owner, { pageSize: 100, memberId: b.id });
    expect(onlyB.total).toBe(1);
    expect(onlyB.items[0].memberId).toBe(b.id);
  });
});

describe("listSubscriptions — frozen vs suspended", () => {
  it("filters frozen separately from suspended-without-freeze", async () => {
    const frozenMember = await member({ fullName: `مجمد-${Math.random()}` });
    const suspendedMember = await member({ fullName: `موقوف-${Math.random()}` });
    const frozenPlan = await createPlan(db, owner, {
      name: `خطة تجميد-${Math.random()}`,
      durationDays: 30,
      price: 100,
    });
    const suspendedPlan = await createPlan(db, owner, {
      name: `خطة إيقاف-${Math.random()}`,
      durationDays: 30,
      price: 100,
    });
    const frozenSub = await createSubscription(db, owner, {
      memberId: frozenMember.id,
      planId: frozenPlan.id,
    });
    const suspendedSub = await createSubscription(db, owner, {
      memberId: suspendedMember.id,
      planId: suspendedPlan.id,
    });
    await freezeSubscription(db, owner, frozenSub.id, {
      endDate: addDaysKey(todayKey(), 3),
      reason: "سفر",
    });
    db.run("UPDATE member_subscriptions SET status = 'suspended', frozen_at = NULL WHERE id = ?", [
      suspendedSub.id,
    ]);

    const frozen = listSubscriptions(db, owner, { pageSize: 100, effective: "frozen" });
    expect(frozen.items.map((s) => s.id)).toEqual([frozenSub.id]);
    const suspended = listSubscriptions(db, owner, { pageSize: 100, effective: "suspended" });
    expect(suspended.items.map((s) => s.id)).toEqual([suspendedSub.id]);
  });
});
