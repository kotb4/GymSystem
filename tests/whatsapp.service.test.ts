import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("whatsapp-web.js", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      info: { wid: { user: "201000000000" } },
      sendMessage: vi.fn().mockResolvedValue({ id: { id: "msg_123" } }),
      logout: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    })),
    LocalAuth: vi.fn().mockImplementation(() => ({})),
    MessageMedia: { fromFilePath: vi.fn().mockReturnValue({ mimetype: "image/png" }) },
  }
});

import { WhatsAppService } from "../server/whatsapp/service.js";
import { createTestDb } from "./helpers/test-db.js";

describe("WhatsAppService", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    const svc = new WhatsAppService();
    svc.init(db);
  });

  it("returns DISCONNECTED status before init completes", () => {
    const svc = new WhatsAppService();
    expect(svc.getStatus().status).toBe("DISCONNECTED");
  });

  it("hasAutoSent returns false for unknown member", () => {
    const svc = new WhatsAppService();
    svc.init(db);
    expect(svc.hasAutoSent("nonexistent")).toBe(false);
  });

  it("sendMembershipQr returns error without db", async () => {
    const svc = new WhatsAppService();
    const result = await svc.sendMembershipQr("m1", "actor1");
    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
  });
});

describe("WhatsAppClient", () => {
  it("isReady returns false before connection", async () => {
    const { WhatsAppClient } = await import("../server/whatsapp/client.js");
    const client = new WhatsAppClient();
    expect(client.isReady()).toBe(false);
  });
});