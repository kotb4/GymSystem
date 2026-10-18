import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import {
  createQuickSession,
  getQuickSessionById,
  listQuickSessions,
} from "@/core/services/quick-session.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { todayKey } from "@/core/dates";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;

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
});

describe("Day Pass / Quick Sessions CRM Lead Integration", () => {
  it("automatically creates and links a new CRM lead when guest takes a Day Pass", async () => {
    const session = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "كابتن طارق يحيى",
      guestPhone: "01055556666",
      guestGender: "male",
      sessionName: "تذكرة تمرين يوم واحد (Day Pass)",
      priceMinor: 6000,
      paidAmountMinor: 6000,
      methodCode: "cash",
      autoCreateLead: true,
    });

    expect(session.lead_id).toBeTruthy();

    const lead = db.first<{
      id: string;
      full_name: string;
      phone: string;
      source: string;
      status: string;
      department: string;
    }>("SELECT id, full_name, phone, source, status, department FROM leads WHERE id = ?", [
      session.lead_id,
    ]);

    expect(lead).toBeTruthy();
    expect(lead?.full_name).toBe("كابتن طارق يحيى");
    expect(lead?.phone).toBe("01055556666");
    expect(lead?.source).toBe("walk_in");
    expect(lead?.status).toBe("new");
    expect(lead?.department).toBe("men");

    // Check activity entry
    const activity = db.first<{ action: string; note: string }>(
      "SELECT action, note FROM lead_activity WHERE lead_id = ? AND action = 'day_pass'",
      [session.lead_id],
    );
    expect(activity).toBeTruthy();
    expect(activity?.note).toContain("قطع تذكرة تمرين يوم واحد");
  });

  it("links to existing CRM lead with same phone on subsequent day pass without duplicating lead", async () => {
    const session1 = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "سارة محمود",
      guestPhone: "01122223333",
      guestGender: "female",
      sessionName: "تذكرة يوم واحد صالة",
      priceMinor: 5000,
      paidAmountMinor: 5000,
      methodCode: "cash",
      autoCreateLead: true,
    });

    const session2 = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "سارة محمود",
      guestPhone: "01122223333",
      guestGender: "female",
      sessionName: "تذكرة يوم واحد صالة - زيارة ثانية",
      priceMinor: 5000,
      paidAmountMinor: 5000,
      methodCode: "cash",
      autoCreateLead: true,
    });

    expect(session1.lead_id).toBeTruthy();
    expect(session2.lead_id).toBe(session1.lead_id);

    // Verify only 1 lead in database
    const leadsCount = db.count("SELECT COUNT(*) FROM leads WHERE phone = '01122223333'");
    expect(leadsCount).toBe(1);

    // Verify 2 activities recorded under this lead
    const activities = db.all<{ action: string; note: string }>(
      "SELECT action, note FROM lead_activity WHERE lead_id = ? ORDER BY created_at ASC",
      [session1.lead_id],
    );
    expect(activities.length).toBe(2);
  });

  it("does not create a CRM lead when autoCreateLead is explicitly false", async () => {
    const session = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "زائر عابر بدون تسجيل",
      guestPhone: "01299998888",
      sessionName: "تذكرة سريعة",
      priceMinor: 5000,
      paidAmountMinor: 5000,
      methodCode: "cash",
      autoCreateLead: false,
    });

    expect(session.lead_id).toBeNull();
    const lead = db.first("SELECT id FROM leads WHERE phone = '01299998888'");
    expect(lead).toBeNull();
  });

  it("filters listQuickSessions by leadId", async () => {
    const session = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "هيثم كمال",
      guestPhone: "01077778888",
      sessionName: "تذكرة خاصة",
      priceMinor: 7000,
      paidAmountMinor: 7000,
      methodCode: "cash",
      autoCreateLead: true,
    });

    const res = listQuickSessions(db, owner, { leadId: session.lead_id! });
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe(session.id);
    expect(res.items[0].lead_id).toBe(session.lead_id);
    expect(res.items[0].lead_name).toBe("هيثم كمال");
  });

  it("handles Day Pass with guest invitation from host member, deducts invitation and links CRM lead", async () => {
    // 1. Create a host member with a subscription containing 3 invitations
    const plan = await createPlan(db, owner, {
      name: "باقة سنوية بلاتينية",
      durationDays: 365,
      price: 2500,
      invitationsCount: 3,
    });
    const hostMember = await createMember(db, owner, {
      fullName: "محمود عبد العزيز",
      phone: "01012345678",
    });
    const sub = await createSubscription(db, owner, {
      memberId: hostMember.id,
      planId: plan.id,
      startDate: todayKey(),
    });
    expect(sub.invitationsTotal).toBe(3);
    expect(sub.invitationsUsed).toBe(0);

    // 2. Guest enters with invitation
    const session = createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "علي حسن",
      guestPhone: "01234567890",
      guestGender: "male",
      sessionName: "تذكرة تمرين بدعوة من مشترك",
      priceMinor: 0,
      paidAmountMinor: 0,
      methodCode: "cash",
      invitationMemberId: hostMember.id,
      autoCreateLead: true,
    });

    expect(session.invitation_member_id).toBe(hostMember.id);
    expect(session.lead_id).toBeTruthy();

    // 3. Verify host subscription invitations deducted
    const updatedSub = db.first<{ invitations_used: number }>(
      "SELECT invitations_used FROM member_subscriptions WHERE id = ?",
      [sub.id],
    );
    expect(updatedSub?.invitations_used).toBe(1);

    // 4. Verify guest_invitations record created
    const guestInv = db.first<{ guest_name: string; member_id: string }>(
      "SELECT guest_name, member_id FROM guest_invitations WHERE member_id = ?",
      [hostMember.id],
    );
    expect(guestInv).toBeTruthy();
    expect(guestInv?.guest_name).toBe("علي حسن");

    // 5. Verify lead created with source 'referral' and attribution notes
    const lead = db.first<{ source: string; notes: string }>(
      "SELECT source, notes FROM leads WHERE id = ?",
      [session.lead_id],
    );
    expect(lead?.source).toBe("referral");
    expect(lead?.notes).toContain("محمود عبد العزيز");

    // 6. Verify retrieved session has host member details
    const retrieved = getQuickSessionById(db, owner, session.id);
    expect(retrieved?.invitation_member_id).toBe(hostMember.id);
    expect(retrieved?.invitation_member_name).toBe("محمود عبد العزيز");
  });

  it("throws error when host member has no invitations remaining", async () => {
    const plan = await createPlan(db, owner, {
      name: "باقة شهرية بدون دعوات",
      durationDays: 30,
      price: 500,
      invitationsCount: 0,
    });
    const hostMember = await createMember(db, owner, {
      fullName: "عمر خالد",
      phone: "01599990000",
    });
    await createSubscription(db, owner, {
      memberId: hostMember.id,
      planId: plan.id,
      startDate: todayKey(),
    });

    expect(() =>
      createQuickSession(db, owner, {
        clientType: "guest",
        guestName: "ضيف مرفوض",
        priceMinor: 0,
        paidAmountMinor: 0,
        invitationMemberId: hostMember.id,
      }),
    ).toThrow();
  });
});
