import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink, mkdir } from "node:fs/promises";

import type { Db } from "../../src/db/engine";
import { getMemberRowById } from "../../src/core/services/members.service";
import { getCardByBarcode } from "../../src/core/services/cards.service";
import { renderQrPngBase64 } from "../../src/core/qr";
import { normalizeEgyNumber } from "../../whatsapp-gateway/numbers.js";
import { nowStamp } from "../../src/core/dates";
import { recordAudit } from "../../src/core/services/audit.service";
import { resolveAppDirs } from "../config.js";

import { WhatsAppClient } from "./client.js";
import type { WhatsAppSessionInfo, SendQrResult } from "./types.js";

/** Session directory survives restarts/rebuilds — lives in app data. */
function getSessionDir(): string {
  return join(resolveAppDirs().configDir, "WhatsApp");
}

/** Where we materialize the QR PNG temporarily for sending. */
function getTempDir(): string {
  return join(tmpdir(), "gym-whatsapp-qr");
}

let instance: WhatsAppService | null = null;

export class WhatsAppService {
  private client: WhatsAppClient;
  private db: Db | null = null;

  constructor(client?: WhatsAppClient) {
    this.client = client ?? new WhatsAppClient();
  }

  /** Singleton accessor used across RPC handlers. */
  static getInstance(): WhatsAppService {
    if (!instance) {
      instance = new WhatsAppService();
    }
    return instance;
  }

  /**
   * Wire the database and kick off async initialization. Safe to call at
   * backend startup — errors here must NOT crash GymSystem.
   */
  init(db: Db): void {
    this.db = db;
    this.ensureSchema();
    void this.initialize();
  }

  private ensureSchema(): void {
    if (!this.db) return;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS whatsapp_qr_sends (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES members(id),
        status TEXT NOT NULL DEFAULT 'pending',
        auto_sent INTEGER NOT NULL DEFAULT 0,
        phone TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_qr_auto_sent
      ON whatsapp_qr_sends(member_id) WHERE auto_sent = 1
    `);
  }

  async initialize(): Promise<void> {
    try {
      await this.client.connect(getSessionDir());
    } catch {
      // status reflects failure via client events; swallow here
    }
  }

  getStatus(): WhatsAppSessionInfo {
    const s = this.client.getState();
    return {
      status: s.status,
      connectedNumber: s.connectedNumber,
      lastError: s.lastError,
      busy: s.busy,
    };
  }

  async getQrCode(): Promise<string | null> {
    return this.client.getQrCode();
  }

  async logout(): Promise<void> {
    await this.client.logout();
  }

  async reconnect(): Promise<void> {
    await this.client.destroy();
    await this.initialize();
  }

  async shutdown(): Promise<void> {
    await this.client.destroy();
  }

  hasAutoSent(memberId: string): boolean {
    if (!this.db) return false;
    const row = this.db.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM whatsapp_qr_sends WHERE member_id = ? AND auto_sent = 1 AND status = 'sent'",
      [memberId],
    );
    return (row?.c ?? 0) > 0;
  }

  /**
   * Send a member's membership QR as an IMAGE via WhatsApp.
   * Handles: member lookup, phone normalization, QR rendering, image send,
   * deduplication, audit. Returns a friendly i18n result.
   */
  async sendMembershipQr(
    memberId: string,
    actorId: string,
    opts: { force?: boolean; caption?: string } = {},
  ): Promise<SendQrResult> {
    if (!this.db) {
      return { ok: false, sent: false, messageKey: "errors.unexpected" };
    }

    const db = this.db;

    // 1. Load member
    const member = getMemberRowById(db, memberId);
    if (!member) {
      return { ok: false, sent: false, messageKey: "errors.memberNotFound" };
    }

    // 2. Validate phone
    const phone = normalizeEgyNumber(member.phone);
    if (!phone) {
      return { ok: false, sent: false, messageKey: "whatsappNoPhone" };
    }

    // 3. Deduplication: skip if already auto-sent (unless forced)
    if (!opts.force) {
      const existing = db.first<{ c: number }>(
        "SELECT COUNT(*) AS c FROM whatsapp_qr_sends WHERE member_id = ? AND auto_sent = 1 AND status = 'sent'",
        [memberId],
      );
      if (existing && existing.c > 0) {
        return { ok: true, sent: false, messageKey: "whatsappQrAlreadySent" };
      }
    }

    // 4. Check connection
    if (!this.client.isReady()) {
      return { ok: false, sent: false, messageKey: "whatsappNotConnected" };
    }

    // 5. Locate the QR barcode (virtual card's barcode = member code)
    const card = getCardByBarcode(db, member.member_code);
    const barcode = card?.barcode_value ?? member.member_code;

    // 6. Render QR to temp PNG
    const tempDir = getTempDir();
    await mkdir(tempDir, { recursive: true });
    const qrPath = join(tempDir, `qr-${memberId}.png`);
    const b64 = await renderQrPngBase64(barcode);
    await writeFile(qrPath, Buffer.from(b64, "base64"));

    // 7. Send image (with caption)
    const caption = opts.caption ?? `بطاقة العضوية - ${member.full_name}`;
    const { MessageMedia } = await import("whatsapp-web.js");
    const media = MessageMedia.fromFilePath(qrPath);

    const id = crypto.randomUUID();
    const stamp = nowStamp();
    const isAuto = opts.force ? 0 : 1;

    try {
      await this.client.sendImage(phone, media, caption);

      db.run(
        `INSERT INTO whatsapp_qr_sends (id, member_id, status, auto_sent, phone, created_at, updated_at)
         VALUES (?, ?, 'sent', ?, ?, ?, ?)`,
        [id, memberId, isAuto, phone, stamp, stamp],
      );
      recordAudit(db, { userId: actorId, username: "", roleId: "owner" } as any, "WHATSAPP_QR_SENT", "member", memberId, {
        phone,
        auto: isAuto === 1,
      });

      return { ok: true, sent: true, messageKey: "whatsappMemberQrSent" };
    } catch (err: any) {
      const msg = err?.message ?? "send failed";
      db.run(
        `INSERT INTO whatsapp_qr_sends (id, member_id, status, auto_sent, phone, error, created_at, updated_at)
         VALUES (?, ?, 'failed', ?, ?, ?, ?, ?)`,
        [id, memberId, isAuto, phone, msg, stamp, stamp],
      );
      return { ok: false, sent: false, messageKey: "whatsappMemberQrFailed" };
    } finally {
      try {
        await unlink(qrPath);
      } catch {
        /* ignore */
      }
    }
  }
}
