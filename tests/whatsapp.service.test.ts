import { describe, expect, it, vi, beforeAll, afterAll } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WhatsAppService } from "../server/whatsapp/service.js"
import { createTestDb } from "./helpers/test-db.js"

// Isolate the app-data dir so init()'s session-dir resolution never touches
// the real %LOCALAPPDATA%\GymSystem.
let dataDir: string
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "gym-whatsapp-test-"))
  process.env.GYMSYSTEM_DATA_DIR = dataDir
})
afterAll(() => {
  delete process.env.GYMSYSTEM_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

/**
 * A WhatsAppClient stand-in whose connect() is a no-op. Using it (instead of
 * the real client) keeps these tests offline and isolated — svc.init() with
 * the real client launches a browser and may fetch WhatsApp Web HTML.
 */
function fakeClient() {
  return {
    getState: () => ({ status: "DISCONNECTED", qrCode: null, connectedNumber: null, lastError: null, busy: false }),
    isReady: () => false,
    connect: vi.fn().mockResolvedValue(undefined),
    sendImage: vi.fn(),
    getQrCode: vi.fn().mockResolvedValue(null),
    logout: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as any
}

describe("WhatsAppService", () => {
  it("returns DISCONNECTED status before init completes", () => {
    const svc = new WhatsAppService(fakeClient())
    expect(svc.getStatus().status).toBe("DISCONNECTED")
  })

  it("hasAutoSent returns false for unknown member", () => {
    const db = createTestDb()
    const svc = new WhatsAppService(fakeClient())
    svc.init(db)
    expect(svc.hasAutoSent("nonexistent")).toBe(false)
  })

  it("sendMembershipQr returns error without db", async () => {
    const svc = new WhatsAppService(fakeClient())
    const result = await svc.sendMembershipQr("m1", "actor1")
    expect(result.ok).toBe(false)
    expect(result.sent).toBe(false)
    expect(result.messageKey).toBe("errors.unexpected")
  })

  it("sendMembershipQr reports a full i18n path for a member without phone", async () => {
    const db = createTestDb()
    db.run(
      "INSERT INTO members (id, member_code, full_name, registration_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["m1", "MEM-000001", "member no phone", "2026-01-01", "2026-01-01 00:00:00", "2026-01-01 00:00:00"],
    )
    const svc = new WhatsAppService(fakeClient())
    svc.init(db)
    const result = await svc.sendMembershipQr("m1", "actor1")
    expect(result.ok).toBe(false)
    expect(result.messageKey).toBe("errors.whatsappNoPhone")
  })

  it("sendMembershipQr reports not-connected when the client is not ready", async () => {
    const db = createTestDb()
    db.run(
      "INSERT INTO members (id, member_code, full_name, phone, registration_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["m2", "MEM-000002", "member with phone", "01012345678", "2026-01-01", "2026-01-01 00:00:00", "2026-01-01 00:00:00"],
    )
    const readyLater = {
      ...fakeClient(),
      isReady: () => false,
    } as any
    const svc = new WhatsAppService(readyLater)
    svc.init(db)
    const result = await svc.sendMembershipQr("m2", "actor1", { force: true })
    expect(result.ok).toBe(false)
    expect(result.messageKey).toBe("errors.whatsappNotConnected")
  })
})

describe("WhatsAppClient", () => {
  it("isReady returns false before connection", async () => {
    const { WhatsAppClient } = await import("../server/whatsapp/client.js");
    const client = new WhatsAppClient();
    expect(client.isReady()).toBe(false);
  });
});