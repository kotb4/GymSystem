import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import * as leads from "@/core/services/lead.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let trainer: ServiceActor;

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
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "مدرب",
      roleId: "trainer",
    }),
  );
});

describe("lead authorization", () => {
  it("denies trainer from lead operations without leads.view / leads.manage", async () => {
    await expect(
      leads.createLead(db, trainer, { fullName: "محظور", source: "facebook" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => leads.listLeads(db, trainer, {})).toThrow();
    expect(() => leads.leadStats(db, trainer)).toThrow();
  });
});

describe("lead CRUD + pipeline", () => {
  it("creates a lead with default status new and reads it back", async () => {
    const lead = await leads.createLead(db, owner, {
      fullName: "أحمد محمد",
      phone: "01012345678",
      source: "facebook",
      department: "general",
      notes: "مهتم بباقة شهرية",
    });
    expect(lead.status).toBe("new");
    expect(lead.fullName).toBe("أحمد محمد");
    expect(lead.phone).toBe("01012345678");

    const found = leads.getLead(db, owner, lead.id);
    expect(found.id).toBe(lead.id);
    expect(found.source).toBe("facebook");
  });

  it("moves a lead through the pipeline and records the status timestamp", async () => {
    const lead = await leads.createLead(db, owner, { fullName: "سارة", source: "instagram" });
    const contacted = await leads.updateLead(db, owner, lead.id, { status: "contacted" });
    expect(contacted.contactedAt).toBeTruthy();

    const interested = await leads.updateLead(db, owner, lead.id, { status: "interested" });
    expect(interested.interestedAt).toBeTruthy();

    const joined = await leads.updateLead(db, owner, lead.id, { status: "joined" });
    expect(joined.joinedAt).toBeTruthy();
    expect(joined.status).toBe("joined");
  });

  it("records lost_reason when marking a lead lost", async () => {
    const lead = await leads.createLead(db, owner, { fullName: "محمد", source: "walk_in" });
    const lost = await leads.updateLead(db, owner, lead.id, {
      status: "lost",
      lostReason: "اختار ناديًا آخر",
    });
    expect(lost.status).toBe("lost");
    expect(lost.lostReason).toBe("اختار ناديًا آخر");
    expect(lost.lostAt).toBeTruthy();
  });

  it("rejects invalid source and invalid status", async () => {
    await expect(
      leads.createLead(db, owner, { fullName: "خطأ", source: "tiktok" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const lead = await leads.createLead(db, owner, { fullName: "سليم", source: "referral" });
    await expect(
      leads.updateLead(db, owner, lead.id, { status: "stale" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("filters listLeads by status and source", async () => {
    await leads.createLead(db, owner, { fullName: "أ", source: "facebook" });
    const b = await leads.createLead(db, owner, { fullName: "ب", source: "instagram" });
    await leads.createLead(db, owner, { fullName: "ج", source: "facebook" });
    await leads.updateLead(db, owner, b.id, { status: "contacted" });
    const fb = leads.listLeads(db, owner, { source: "facebook" });
    expect(fb.items.length).toBe(2);
    const contacted = leads.listLeads(db, owner, { status: "contacted" });
    expect(contacted.items.length).toBe(1);
  });

  it("deletes a lead", async () => {
    const lead = await leads.createLead(db, owner, { fullName: "محمود", source: "other" });
    await leads.deleteLead(db, owner, lead.id);
    expect(() => leads.getLead(db, owner, lead.id)).toThrow();
  });
});

describe("lead follow-ups", () => {
  it("adds a follow-up, completes it, and surfaces it in todayFollowups", async () => {
    const lead = await leads.createLead(db, owner, { fullName: "نور", source: "whatsapp" });
    const f = await leads.addFollowup(db, owner, lead.id, {
      dueDate: "2026-01-01",
      dueTime: "10:00",
      note: "متابعة أولى",
    });
    expect(f.done).toBe(false);

    const due = leads.todayFollowups(db, owner);
    expect(due.some((x) => x.id === f.id)).toBe(true);

    const done = await leads.completeFollowup(db, owner, f.id, true);
    expect(done.done).toBe(true);
    expect(done.doneAt).toBeTruthy();

    expect(leads.todayFollowups(db, owner).some((x) => x.id === f.id)).toBe(false);
  });
});

describe("lead conversion", () => {
  it("converts a lead to a new member and links it", async () => {
    const lead = await leads.createLead(db, owner, {
      fullName: "تحويل جديد",
      phone: "01011112222",
      source: "existing_member",
    });
    const res = await leads.convertLead(db, owner, { leadId: lead.id });
    expect(res.linkedExisting).toBe(false);
    expect(res.memberCode).toBeTruthy();

    const after = leads.getLead(db, owner, lead.id);
    expect(after.status).toBe("joined");
    expect(after.convertedMemberId).toBe(res.memberId);
    expect(after.joinedAt).toBeTruthy();
  });

  it("throws leadAlreadyConverted on a second conversion", async () => {
    const lead = await leads.createLead(db, owner, { fullName: "مرة واحدة", source: "referral" });
    await leads.convertLead(db, owner, { leadId: lead.id });
    await expect(leads.convertLead(db, owner, { leadId: lead.id })).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "errors.leadAlreadyConverted",
    });
  });

  it("blocks conversion when the phone belongs to an existing member", async () => {
    const member = await createMember(db, owner, { fullName: "عضو موجود", phone: "01033334444" });
    const lead = await leads.createLead(db, owner, {
      fullName: "مكرر",
      phone: member.phone!,
      source: "walk_in",
    });
    await expect(leads.convertLead(db, owner, { leadId: lead.id })).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "errors.leadDuplicatePhone",
    });
  });

  it("links to an existing member explicitly", async () => {
    const member = await createMember(db, owner, { fullName: "ربط مباشر", phone: "01055556666" });
    const lead = await leads.createLead(db, owner, { fullName: "المحتمل", source: "facebook" });
    const res = await leads.convertLead(db, owner, { leadId: lead.id, existingMemberId: member.id });
    expect(res.linkedExisting).toBe(true);
    expect(res.memberId).toBe(member.id);
    expect(leads.getLead(db, owner, lead.id).convertedMemberId).toBe(member.id);
  });
});

describe("lead stats", () => {
  it("reports totals, joined count and conversion rate", async () => {
    await leads.createLead(db, owner, { fullName: "1", source: "facebook" });
    await leads.createLead(db, owner, { fullName: "2", source: "instagram" });
    const joinedLead = await leads.createLead(db, owner, { fullName: "3", source: "whatsapp" });
    await leads.convertLead(db, owner, { leadId: joinedLead.id });

    const stats = leads.leadStats(db, owner);
    expect(stats.total).toBe(3);
    expect(stats.joined).toBe(1);
    expect(stats.conversionRate).toBeCloseTo(33.3, 0);
    expect(stats.byStatus["joined"]).toBe(1);
    expect(stats.bySource["facebook"]).toBe(1);
  });
});
