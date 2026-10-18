import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createTrainer } from "@/core/services/trainers.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { createAnnouncement } from "@/core/services/announcements.service";
import {
  listTrainerAttendance,
  getTrainerAttendanceSummary,
  recordTrainerCheckIn,
  recordTrainerCheckOut,
} from "@/core/services/trainer-attendance.service";
import {
  listMemberConversations,
  getMemberMessages,
  sendMemberMessage,
} from "@/core/services/member-messages.service";
import { todayKey } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let manager: ReturnType<typeof buildActor>;
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
  manager = buildActor(
    await createUser(db, owner, {
      username: "manager",
      password: "Manager@2026",
      fullName: "مدير النظام",
      roleId: "manager",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "موظف استقبال",
      roleId: "reception",
    }),
  );
});

describe("v52 Advanced Competitive Features Test Suite", () => {

  it("2. Trainer Attendance Tracking & Presence Summary", async () => {
    // Create trainers
    const trainer1 = await createTrainer(db, owner, {
      fullName: "كابتن شريف كمال",
      phone: "01122334455",
      specialization: "لياقة وبناء أجسام",
    });
    const trainer2 = await createTrainer(db, owner, {
      fullName: "كابتن سارة محمود",
      phone: "01233445566",
      specialization: "كروس فيت وزومبا",
    });

    // Initial summary
    const today = todayKey();
    let summary = getTrainerAttendanceSummary(db, today);
    expect(summary.totalTrainers).toBe(2);
    expect(summary.presentToday).toBe(0);
    expect(summary.currentlyPresent).toBe(0);
    expect(summary.absentToday).toBe(2);

    // Record check in for trainer1
    const checkIn = recordTrainerCheckIn(db, reception, {
      trainerId: trainer1.id,
      time: "09:00",
      status: "present",
      notes: "حضور وردية الصباح",
    });
    expect(checkIn.id).toBeDefined();
    expect(checkIn.trainer_name).toBe("كابتن شريف كمال");
    expect(checkIn.check_in_time).toBe("09:00");
    expect(checkIn.check_out_time).toBeNull();

    // Summary after 1 trainer checked in
    summary = getTrainerAttendanceSummary(db, today);
    expect(summary.presentToday).toBe(1);
    expect(summary.currentlyPresent).toBe(1);
    expect(summary.absentToday).toBe(1);

    // Record check out
    const checkOut = recordTrainerCheckOut(db, reception, {
      attendanceId: checkIn.id,
      time: "17:00",
    });
    expect(checkOut.check_out_time).toBe("17:00");

    // Summary after checkout (present today is 1, but currently present is 0)
    summary = getTrainerAttendanceSummary(db, today);
    expect(summary.presentToday).toBe(1);
    expect(summary.currentlyPresent).toBe(0);

    // List records
    const records = listTrainerAttendance(db, today);
    expect(records.length).toBe(1);
    expect(records[0].trainer_id).toBe(trainer1.id);
  });

  it("3. Member Messaging & Conversations Center", async () => {
    const member = await createMember(db, reception, {
      fullName: "محمد إبراهيم الزبون",
      phone: "01055554444",
      gender: "male",
    });

    // List conversations before messages
    let convs = listMemberConversations(db, owner);
    expect(convs.length).toBeGreaterThan(0);
    const mConv = convs.find((c) => c.member_id === member.id);
    expect(mConv).toBeDefined();

    // Reception is denied messages.send
    await expect(
      sendMemberMessage(db, reception, {
        memberId: member.id,
        message: "رسالة موظف استقبال غير مصرح له",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Send internal message with manager
    const msg1 = await sendMemberMessage(db, manager, {
      memberId: member.id,
      message: "أهلاً بك يا كابتن محمد، نود تذكيرك بموعد حصتك غداً",
      channel: "internal",
    });
    expect(msg1.id).toBeDefined();
    expect(msg1.sender_type).toBe("gym");
    expect(msg1.status).toBe("sent");

    // Get messages
    const msgs = getMemberMessages(db, owner, member.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].message).toContain("أهلاً بك يا كابتن محمد");

    // Check conversation updated
    convs = listMemberConversations(db, owner);
    const updatedConv = convs.find((c) => c.member_id === member.id);
    expect(updatedConv?.total_messages).toBe(1);
    expect(updatedConv?.last_message).toContain("أهلاً بك يا كابتن محمد");
  });
});
