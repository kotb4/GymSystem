import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import type { Db } from "@/db/engine";
import { createQuickSession } from "@/core/services/quick-session.service";
import { listLiveOccupants } from "@/core/services/attendance.service";
import { fillMessagePlaceholders } from "@/core/whatsapp";
import {
  handleWhatsAppInbound,
  listBotHandovers,
  resolveBotHandover,
} from "@/core/services/whatsapp-bot.service";
import { collectNotifications } from "@/core/services/notifications.service";

describe("User Issues: Day Pass Live Occupancy, Gym Name Placeholders, and Bot Option 0 Handover", () => {
  let db: Db;
  let ownerActor: ReturnType<typeof buildActor>;

  beforeEach(async () => {
    db = createTestDb();
    const user = await setup(db, {
      username: "owner",
      password: "OwnerPassword123!",
      ownerFullName: "Gym Owner",
      gymName: "Gold Gym Egypt",
    });
    ownerActor = buildActor(user);
  });

  it("1. Day Pass (quick session) creates attendance and shows guest in listLiveOccupants with countdown", async () => {
    const session = createQuickSession(db, ownerActor, {
      clientType: "guest",
      guestName: "أحمد الزائر",
      guestPhone: "01099887766",
      guestGender: "male",
      sessionName: "تذكرة تمرين يوم واحد (Day Pass)",
      priceMinor: 5000,
      paidAmountMinor: 5000,
      methodCode: "cash",
      recordAttendance: true,
    });

    expect(session.member_id).toBeTruthy();
    expect(session.attendance_recorded).toBe(1);

    // Verify member record was created
    const guestMember = db.first<{ id: string; full_name: string; member_code: string }>(
      "SELECT id, full_name, member_code FROM members WHERE id = ?",
      [session.member_id],
    );
    expect(guestMember).toBeTruthy();
    expect(guestMember?.full_name).toBe("أحمد الزائر");

    // Verify attendance was inserted
    const att = db.first<{ id: string; member_id: string; checkin_at: string; notes: string }>(
      "SELECT id, member_id, checkin_at, notes FROM attendance WHERE member_id = ?",
      [session.member_id],
    );
    expect(att).toBeTruthy();
    expect(att?.notes).toContain("تذكرة تمرين");

    // Verify guest appears in listLiveOccupants
    const live = listLiveOccupants(db, ownerActor);
    expect(live.totalNow).toBeGreaterThanOrEqual(1);
    const occupant = live.occupants.find((o) => o.memberId === session.member_id);
    expect(occupant).toBeTruthy();
    expect(occupant?.fullName).toBe("أحمد الزائر");
    expect(occupant?.planName).toBe("تذكرة تمرين: تذكرة تمرين يوم واحد (Day Pass)");
    expect(occupant?.durationMinutes).toBeGreaterThan(0);
    expect(occupant?.minutesRemaining).toBeGreaterThanOrEqual(0);
  });

  it("2. fillMessagePlaceholders cleanly replaces {اسم الجيم} and {اسم_الجيم}", () => {
    const tmpl1 = "مرحباً بك يا {اسم العميل} في {اسم الجيم}، كود عضويتك {رقم العضوية}.";
    const res1 = fillMessagePlaceholders(tmpl1, {
      memberName: "محمد محمود",
      memberCode: "MEM-0001",
      gymName: "Iron Gym",
    });
    expect(res1).toBe("مرحباً بك يا محمد محمود في Iron Gym، كود عضويتك MEM-0001.");

    const tmpl2 = "عرض خاص من {اسم_الجيم} بخصم {الخصم}";
    const res2 = fillMessagePlaceholders(tmpl2, {
      gymName: "Hero Gym",
      discount: "20%",
    });
    expect(res2).toBe("عرض خاص من Hero Gym بخصم 20%");

    // Fallback when gymName is empty or missing
    const tmpl3 = "أهلاً بك في {اسم الجيم}";
    const res3 = fillMessagePlaceholders(tmpl3, {});
    expect(res3).toBe("أهلاً بك في الجيم");
  });

  it("3. WhatsApp Bot Option 0 records handover, triggers notifications, and allows resolution", async () => {
    // Member sends 0 to request human receptionist
    const inbound = await handleWhatsAppInbound(
      db,
      "01012345678",
      "0",
      undefined,
      "01012345678@s.whatsapp.net",
      undefined,
      "عميل مهتم",
      { bypassDisabledCheck: true },
    );

    expect(inbound.handledOption).toBe("0");
    expect(inbound.reply).toBeTruthy();

    // Verify recorded in whatsapp_bot_handovers
    const handovers = listBotHandovers(db, ownerActor, { status: "pending" });
    expect(handovers.length).toBe(1);
    expect(handovers[0].phone).toContain("1012345678");
    expect(handovers[0].status).toBe("pending");

    // Verify collectNotifications alerts reception
    const notifs = collectNotifications(db, ownerActor);
    const handoverNotif = notifs.find((n) => n.type === "bot_handover");
    expect(handoverNotif).toBeTruthy();
    expect(handoverNotif?.severity).toBe("danger");
    expect(handoverNotif?.count).toBe(1);

    // Reception resolves the handover
    const resolveRes = resolveBotHandover(db, ownerActor, handovers[0].id);
    expect(resolveRes.ok).toBe(true);

    // Verify resolved in DB
    const pendingAfter = listBotHandovers(db, ownerActor, { status: "pending" });
    expect(pendingAfter.length).toBe(0);

    const resolved = listBotHandovers(db, ownerActor, { status: "resolved" });
    expect(resolved.length).toBe(1);
    expect(resolved[0].resolved_by).toBe(ownerActor.userId);

    // Verify notification clears
    const notifsAfter = collectNotifications(db, ownerActor);
    expect(notifsAfter.find((n) => n.type === "bot_handover")).toBeUndefined();
  });
});
