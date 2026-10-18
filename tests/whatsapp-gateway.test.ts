import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { updateSetting, SETTING_KEYS } from "@/core/services/settings.service";
import { buildActor, setup } from "@/core/services/auth.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { queueCardDelivery, sendPendingCardDeliveries } from "@/core/services/card-delivery.service";
import { createMember } from "@/core/services/members.service";
import { listMemberCards } from "@/core/services/cards.service";

// Import gateway session module using require
const wa = require("../whatsapp-gateway/wa-session");

describe("whatsapp-gateway session & retry decryption", () => {
  it("caches and retrieves messages across LID and Phone aliases", async () => {
    const testLid = "91109594279952";
    const testPhone = "201288536381";
    wa.cacheLidMapping(`${testLid}@lid`, `${testPhone}@s.whatsapp.net`);

    expect(wa.getLidForPhone(testPhone)).toBe(testLid);
    expect(wa.getPhoneForLid(testLid)).toBe(testPhone);

    const msgKey = {
      id: "TEST_MSG_001",
      remoteJid: `${testLid}@lid`,
    };
    const msgContent = {
      conversation: "مرحباً يا بطل",
    };

    wa.saveMessage(msgKey, msgContent, [`${testPhone}@s.whatsapp.net`]);

    // Lookup by compound LID key
    const foundByLid = await wa.getStoredMessage({
      id: "TEST_MSG_001",
      remoteJid: `${testLid}@lid`,
    });
    expect(foundByLid).toEqual(msgContent);

    // Lookup by compound phone number key (simulate retry receipt asking by phone JID)
    const foundByPhone = await wa.getStoredMessage({
      id: "TEST_MSG_001",
      remoteJid: `${testPhone}@s.whatsapp.net`,
    });
    expect(foundByPhone).toEqual(msgContent);

    // Lookup by message ID alone
    const foundById = await wa.getStoredMessage({
      id: "TEST_MSG_001",
    });
    expect(foundById).toEqual(msgContent);

    // Participant lookup
    const msgKeyWithPart = {
      id: "TEST_MSG_002",
      remoteJid: `${testPhone}@s.whatsapp.net`,
      participant: `${testLid}@lid`,
    };
    const partContent = { conversation: "رسالة بمشارك" };
    wa.saveMessage(msgKeyWithPart, partContent);
    const foundByPart = await wa.getStoredMessage({
      id: "TEST_MSG_002",
      remoteJid: `${testLid}@lid`,
    });
    expect(foundByPart).toEqual(partContent);
  });

  it("accurately reports socket open only when WebSocket is active", () => {
    // When socket is not set, isSocketOpen MUST be false regardless of pairing
    expect(wa.isSocketOpen()).toBe(false);
  });
});

describe("whatsapp-gateway wa-send JID resolution and validation", () => {
  it("targets verified @lid for phone number when contact has a known @lid to avoid decryption delay", async () => {
    const { send } = require("../whatsapp-gateway/wa-send");

    let sentTargetJid = "";
    let sentPayload: any = null;

    // Mock ensureBrowser, isPaired, waitForOpen
    const origEnsureBrowser = wa.ensureBrowser;
    const origIsPaired = wa.isPaired;
    const origWaitForOpen = wa.waitForOpen;

    const fakeSock = {
      user: { id: "201000000000:1@s.whatsapp.net" },
      onWhatsApp: async (jid: string) => [
        {
          jid: "201288536381@s.whatsapp.net",
          exists: true,
          lid: "91109594279952@lid",
        },
      ],
      presenceSubscribe: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid: string, payload: any) => {
        sentTargetJid = jid;
        sentPayload = payload;
        return {
          key: { id: "MSG_FAKE_123", remoteJid: jid },
          message: payload.image ? { imageMessage: { caption: payload.caption } } : { conversation: payload.text },
        };
      },
    };

    wa.ensureBrowser = async () => ({ ok: true, client: fakeSock });
    wa.isPaired = async () => true;
    wa.waitForOpen = async () => true;

    try {
      const res = await send("01288536381", "بطاقة اختبار", {
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        mime: "image/png",
      });

      expect(res.ok).toBe(true);
      // Crucial: Targets the verified LID directly to match the phone's active Signal ratchet, preventing decryption delay
      expect(sentTargetJid).toBe("91109594279952@lid");
      expect(sentPayload).toBeDefined();
      expect(sentPayload.image).toBeInstanceOf(Buffer);

      // And verify that LID mapping was learned
      expect(wa.getLidForPhone("201288536381")).toBe("91109594279952");
    } finally {
      wa.ensureBrowser = origEnsureBrowser;
      wa.isPaired = origIsPaired;
      wa.waitForOpen = origWaitForOpen;
    }
  });

  it("rejects immediately when onWhatsApp reports empty list (number not registered)", async () => {
    const { send } = require("../whatsapp-gateway/wa-send");

    const origEnsureBrowser = wa.ensureBrowser;
    const origIsPaired = wa.isPaired;
    const origWaitForOpen = wa.waitForOpen;

    const fakeSock = {
      onWhatsApp: async () => [], // Empty array = not on WhatsApp
      presenceSubscribe: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async () => {},
    };

    wa.ensureBrowser = async () => ({ ok: true, client: fakeSock });
    wa.isPaired = async () => true;
    wa.waitForOpen = async () => true;

    try {
      const res = await send("01099999999", "مرحباً");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("الرقم غير مسجل في خدمة واتساب");
    } finally {
      wa.ensureBrowser = origEnsureBrowser;
      wa.isPaired = origIsPaired;
      wa.waitForOpen = origWaitForOpen;
    }
  });
});

describe("whatsappApiUrl default fallback (http://127.0.0.1:8891)", () => {
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

  it("card-delivery uses default 8891 when whatsapp is enabled but apiUrl is empty", { timeout: 60000 }, async () => {
    await updateSetting(db, owner, SETTING_KEYS.whatsappEnabled, "1");

    const member = await createMember(db, owner, {
      fullName: "عضو بطاقة",
      phone: "01288536381",
      department: "general",
    });
    const cards = listMemberCards(db, owner, member.id);
    expect(cards).toHaveLength(1);

    await queueCardDelivery(db, owner, { cardId: cards[0].id });

    // Mock fetch to check which URL it attempted to call
    let calledUrl = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    try {
      const res = await sendPendingCardDeliveries(db, owner, 10);
      expect(res.sent).toBe(1);
      expect(calledUrl).toBe("http://127.0.0.1:8891/send");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("disconnects session, logs out socket and clears cached credentials", async () => {
    const res = await wa.disconnect();
    expect(res.ok).toBe(true);
    expect(res.disconnected).toBe(true);
    expect(wa.isSocketOpen()).toBe(false);
    expect(await wa.isPaired()).toBe(false);
  });
});
