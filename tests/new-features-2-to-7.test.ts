import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createPlan } from "@/core/services/plans.service";
import { createMember } from "@/core/services/members.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { useGuestInvitation, getMemberInvitationsSummary } from "@/core/services/invitations.service";
import { openShift, getShiftSummary, closeShift, getActiveShift } from "@/core/services/shifts.service";
import { createPromoCode, validatePromoCode, togglePromoCode } from "@/core/services/promo.service";
import { listExpiringSubscriptionsForRenewal, sendRenewalReminders } from "@/core/services/renewal-alerts.service";
import { getPeakHoursHeatmap } from "@/core/services/attendance-analytics.service";
import { scanFraudAlerts } from "@/core/services/fraud-alerts.service";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";
import { todayKey, addDaysKey, nowStamp } from "@/core/dates";

let db: Db;
let owner: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
});

describe("Feature 2: Guest Invitations", () => {
  it("allows members with invitations on their plan/subscription to invite guests", async () => {
    const plan = await createPlan(db, owner, {
      name: "باقة سنوية VIP",
      durationDays: 365,
      price: 3000,
      invitationsCount: 5,
    });
    expect(plan.invitationsCount).toBe(5);

    const member = await createMember(db, owner, {
      fullName: "محمد أحمد",
      phone: "01011112222",
    });

    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: todayKey(),
    });

    expect(sub.invitationsTotal).toBe(5);
    expect(sub.invitationsUsed).toBe(0);

    // Use an invitation
    const invite = await useGuestInvitation(db, owner, {
      subscriptionId: sub.id,
      guestName: "صديق محمد",
      guestPhone: "01099998888",
      notes: "زيارة أولى تجريبية",
    });

    expect(invite.guestName).toBe("صديق محمد");
    expect(invite.guestPhone).toBe("01099998888");

    // Check summary
    const summary = await getMemberInvitationsSummary(db, owner, member.id);
    expect(summary).not.toBeNull();
    expect(summary?.invitationsUsed).toBe(1);
    expect(summary?.invitationsRemaining).toBe(4);
    expect(summary?.history.length).toBe(1);

    // Verify lead was auto-created for CRM
    const leadsCount = db.count("SELECT COUNT(*) FROM leads WHERE phone = ?", ["01099998888"]);
    expect(leadsCount).toBe(1);
  });
});

describe("Feature 3: Staff Shifts & Cash Handover", () => {
  it("manages staff shifts, tracks cash drawer expectations, and records closing difference", async () => {
    // Open shift
    const shift = await openShift(db, owner, {
      openingCashMinor: 50000, // 500 EGP
      notes: "استلام وردية صباحية",
    });
    expect(shift.status).toBe("open");
    expect(shift.openingCashMinor).toBe(50000);

    const active = await getActiveShift(db, owner);
    expect(active?.id).toBe(shift.id);

    // Get shift summary
    const summary = await getShiftSummary(db, owner, shift.id);
    expect(summary.shift.expectedCashMinor).toBe(50000);

    // Close shift with counted cash
    const closed = await closeShift(db, owner, {
      shiftId: shift.id,
      countedCashMinor: 55000, // 550 EGP (+50 surplus)
      notes: "تم تسليم الدرج للمسائي",
    });
    expect(closed.status).toBe("closed");
    expect(closed.differenceMinor).toBe(5000);
  });
});

describe("Feature 4: Promo Codes & Promotions", () => {
  it("creates, validates, and toggles promo codes with min spend and usage limit", async () => {
    const promo = await createPromoCode(db, owner, {
      code: "SAVE20",
      discountType: "percentage",
      discountValue: 20,
      minSpendMinor: 10000, // min 100 EGP
      maxUses: 10,
    });
    expect(promo.code).toBe("SAVE20");
    expect(promo.isActive).toBe(true);

    // Validate on 200 EGP order (20000 minor)
    const valValid = await validatePromoCode(db, owner, {
      code: "SAVE20",
      orderAmountMinor: 20000,
    });
    expect(valValid.valid).toBe(true);
    expect(valValid.calculatedDiscountMinor).toBe(4000); // 20% of 20000 = 4000 (40 EGP)

    // Validate on 50 EGP order (fails min spend)
    const valBelowMin = await validatePromoCode(db, owner, {
      code: "SAVE20",
      orderAmountMinor: 5000,
    });
    expect(valBelowMin.valid).toBe(false);
    expect(valBelowMin.errorKey).toBe("errors.promoCodeMinSpendNotMet");

    // Toggle active state
    const toggled = await togglePromoCode(db, owner, promo.id, false);
    expect(toggled.isActive).toBe(false);

    const valDisabled = await validatePromoCode(db, owner, {
      code: "SAVE20",
      orderAmountMinor: 20000,
    });
    expect(valDisabled.valid).toBe(false);
  });
});

describe("Feature 5: WhatsApp Renewal Reminders", () => {
  it("lists expiring subscriptions and sends batch reminders without same-day duplicates", async () => {
    const plan = await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 300 });
    const member = await createMember(db, owner, {
      fullName: "علي حسن",
      phone: "01123456789",
    });

    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: addDaysKey(todayKey(), -27), // expires in 2 days
    });

    // List expiring
    const expiring = listExpiringSubscriptionsForRenewal(db, owner, 7);
    const found = expiring.find((e) => e.subscriptionId === sub.id);
    expect(found).toBeDefined();
    expect(found?.phone).toBe("01123456789");

    // Send batch reminders (CRM mock is enabled by default in test env or transport null)
    process.env.GYM_CRM_MOCK = "1";
    const res = await sendRenewalReminders(db, owner, [sub.id]);
    expect(res.sentCount).toBe(1);

    // Sending again today skips to prevent duplicate spamming
    const resDuplicate = await sendRenewalReminders(db, owner, [sub.id]);
    expect(resDuplicate.skippedCount).toBe(1);
    expect(resDuplicate.sentCount).toBe(0);
    delete process.env.GYM_CRM_MOCK;
  });
});

describe("Feature 6: Gym Peak Hours Heatmap", () => {
  it("computes 7x24 checkin matrix across days of week and hours", async () => {
    const today = todayKey();
    const stamp = `${today}T18:30:00.000Z`;

    const m = await createMember(db, owner, { fullName: "عضو تجريبي للحضور", phone: "01011112222" });
    db.run(
      `INSERT INTO attendance (id, member_id, checkin_at)
       VALUES (?, ?, ?)`,
      ["att-1", m.id, stamp],
    );
    db.run(
      `INSERT INTO attendance (id, member_id, checkin_at)
       VALUES (?, ?, ?)`,
      ["att-2", m.id, stamp],
    );

    const heatmap = getPeakHoursHeatmap(db, owner, {
      fromKey: today,
      toKey: today,
    });

    expect(heatmap.totalVisits).toBe(2);
    expect(heatmap.matrix.length).toBe(7 * 24);
    expect(heatmap.maxCount).toBe(2);
  });
});

describe("Feature 7: Administrative Anti-Fraud / Audit Alerts", () => {
  it("scans voided payments and large discrepancies for management auditing", async () => {
    const m = await createMember(db, owner, { fullName: "عضو دفع ملغي", phone: "01033334444" });
    const stamp = nowStamp();
    db.run(
      `INSERT INTO payments (
         id, member_id, base_amount_minor, net_amount_minor, paid_amount_minor,
         remaining_amount_minor, method_code, status, paid_at, voided_at, void_reason,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "pay-void-1",
        m.id,
        60000,
        60000,
        60000,
        0,
        "cash",
        "voided",
        stamp,
        stamp,
        "خطأ في التسجيل",
        owner.userId,
        stamp,
        stamp,
      ],
    );

    const summary = scanFraudAlerts(db, owner, 14);
    expect(summary.totalAlerts).toBeGreaterThan(0);
    const alert = summary.alerts.find((a) => a.relatedEntityId === "pay-void-1");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("high");
  });
});
