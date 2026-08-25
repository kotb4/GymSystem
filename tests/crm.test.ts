import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import {
  listTemplates,
  renderTemplate,
  upsertTemplate,
  queueMessage,
  sendPendingMessages,
  markManuallySent,
  listMessages,
  generateDueMessages,
} from "@/core/services/crm.service";
import { addDaysKey, todayKey, nowStamp } from "@/core/dates";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "جيم برو",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
  const ts = nowStamp();
  db.run(
    "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, created_at, updated_at) VALUES ('system', 'system', NULL, 'N/A', 'النظام', 'owner', 1, ?, ?)",
    [ts, ts],
  );
});

async function makeMember(name = "عضو CRM") {
  return createMember(db, owner, {
    fullName: name,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

describe("templates", () => {
  it("lists seeded templates", () => {
    const tpls = listTemplates(db, owner);
    expect(tpls.length).toBeGreaterThanOrEqual(5);
    expect(tpls.map((t) => t.code)).toContain("expiry_reminder");
  });

  it("upserts a new template and updates existing", async () => {
    const created = await upsertTemplate(db, owner, { code: "custom_msg", bodyAr: "رسالة مخصصة لـ {{name}}" });
    expect(created.code).toBe("custom_msg");

    const updated = await upsertTemplate(db, owner, { code: "custom_msg", bodyAr: "رسالة محدثة لـ {{name}}" });
    expect(updated.bodyAr).toContain("محدثة");
  });

  it("denies reception from creating templates", async () => {
    await expect(
      upsertTemplate(db, reception, { code: "bad", bodyAr: "رسالة ممنوعة" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("renderTemplate", () => {
  it("substitutes variables", () => {
    expect(renderTemplate("مرحبا {{name}}", { name: "أحمد" })).toBe("مرحبا أحمد");
  });

  it("leaves unknown placeholders intact", () => {
    const result = renderTemplate("مرحبا {{name}}", {});
    expect(result).toBe("مرحبا {{name}}");
  });
});

describe("message queue", () => {
  it("queues a pending message", async () => {
    const m = await makeMember();
    const res = await queueMessage(db, owner, {
      memberId: m.id,
      templateCode: "welcome",
      vars: { name: m.fullName, gym: "جيم برو" },
    });
    expect(res.status).toBe("pending");
    expect(res.duplicate).toBe(false);
  });

  it("deduplicates by dedupe_key", async () => {
    const m = await makeMember();
    const first = await queueMessage(db, owner, {
      memberId: m.id,
      templateCode: "welcome",
      vars: { name: m.fullName, gym: "جيم برو" },
      dedupeKey: "dup-test-1",
    });
    expect(first.duplicate).toBe(false);

    const second = await queueMessage(db, owner, {
      memberId: m.id,
      templateCode: "welcome",
      vars: { name: m.fullName, gym: "جيم برو" },
      dedupeKey: "dup-test-1",
    });
    expect(second.duplicate).toBe(true);
  });

  it("skips_no_phone when member has no phone", async () => {
    const m = await createMember(db, owner, {
      fullName: "بدون هاتف",
    });
    const res = await queueMessage(db, owner, {
      memberId: m.id,
      customBody: "رسالة بدون هاتف",
    });
    expect(res.status).toBe("skipped_no_phone");
  });
});

describe("sendPendingMessages", () => {
  it("sends pending messages via mock transport", async () => {
    const m = await makeMember();
    await queueMessage(db, owner, {
      memberId: m.id,
      customBody: "رسالة تجريبية",
    });

    const prev = process.env.GYM_CRM_MOCK;
    process.env.GYM_CRM_MOCK = "1";
    try {
      const result = await sendPendingMessages(db, owner);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.GYM_CRM_MOCK;
      else process.env.GYM_CRM_MOCK = prev;
    }

    const msgs = listMessages(db, owner, { status: "sent" });
    expect(msgs.length).toBe(1);
  });

  it("marks skipped_no_provider without transport", async () => {
    const m = await makeMember();
    await queueMessage(db, owner, {
      memberId: m.id,
      customBody: "رسالة بدون مزود",
    });

    const prev = process.env.GYM_CRM_MOCK;
    delete process.env.GYM_CRM_MOCK;
    try {
      const result = await sendPendingMessages(db, owner);
      expect(result.skipped).toBe(1);
    } finally {
      if (prev) process.env.GYM_CRM_MOCK = prev;
    }
  });
});

describe("markManuallySent", () => {
  it("sets status to manual_opened", async () => {
    const m = await makeMember();
    const res = await queueMessage(db, owner, {
      memberId: m.id,
      customBody: " رسالة يدوية",
    });
    await markManuallySent(db, owner, res.id);
    const msgs = listMessages(db, owner, { memberId: m.id });
    expect(msgs[0].status).toBe("manual_opened");
  });
});

describe("generateDueMessages", () => {
  it("queues expiry reminders for members with subs ending soon", async () => {
    const m = await makeMember("عضو منتهي");
    const plan = await createPlan(db, owner, {
      name: "قريب الانتهاء",
      durationDays: 8,
      price: 200,
    });
    await createSubscription(db, owner, {
      memberId: m.id,
      planId: plan.id,
      startDate: addDaysKey(todayKey(), -3),
    });

    const result = await generateDueMessages(db, owner);
    expect(result.queued).toBeGreaterThanOrEqual(1);

    const pending = listMessages(db, owner, { status: "pending" });
    expect(pending.some((msg) => msg.memberId === m.id)).toBe(true);
  });
});
