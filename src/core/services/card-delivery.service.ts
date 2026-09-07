import { nowStamp } from "@/core/dates";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { renderQrPngBase64, sha256Hex } from "@/core/qr";
import { recordAudit } from "./audit.service";
import { getCardById } from "./cards.service";
import { assertDepartmentAccess } from "./department";
import { getMemberRowById } from "./members.service";
import { readSetting, SETTING_KEYS } from "./settings.service";

export type CardDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped_no_phone"
  | "not_configured";

export interface CardDeliveryRow extends Row {
  id: string;
  member_id: string;
  card_id: string;
  barcode_value: string;
  member_name: string | null;
  phone: string | null;
  status: CardDeliveryStatus;
  error: string | null;
  image_hash: string | null;
  dedupe_key: string;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PublicCardDelivery {
  id: string;
  memberId: string;
  memberName: string | null;
  cardId: string;
  barcodeValue: string;
  phone: string | null;
  status: CardDeliveryStatus;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface CardDeliveryMediaPayload {
  base64: string;
  mime: string;
  caption: string;
}

type MessageTransport = (
  phone: string,
  body: string,
  media?: CardDeliveryMediaPayload,
) => Promise<{ ok: boolean; error?: string }>;

export const mockTransport: MessageTransport = async () => ({ ok: true });

/**
 * Real WhatsApp gateway. `whatsapp_api_url` points at the gateway/your provider;
 * the payload carries the media image plus the caption so the client receives
 * the QR picture and the barcode text together. Offline-first: any network
 * failure marks the delivery `failed`, never crashes the backend.
 */
export const whatsappTransport =
  (apiUrl: string): MessageTransport =>
  async (phone, body, media) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: body, media }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error instanceof Error ? error.message : error) };
    }
  };

function envFlag(name: string): boolean {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return proc.process?.env?.[name] === "1";
}

function resolveTransport(db: Db): { transport: MessageTransport | null; provider: "mock" | "whatsapp" | "none" } {
  if (envFlag("GYM_CRM_MOCK")) return { transport: mockTransport, provider: "mock" };
  const enabled = readSetting(db, SETTING_KEYS.whatsappEnabled) === "1";
  const apiUrl = readSetting(db, SETTING_KEYS.whatsappApiUrl) ?? "";
  if (enabled && apiUrl.trim() !== "") {
    return { transport: whatsappTransport(apiUrl.trim()), provider: "whatsapp" };
  }
  return { transport: null, provider: "none" };
}

const DELIVERY_SELECT =
  "SELECT * FROM card_deliveries";

function toDelivery(row: CardDeliveryRow): PublicCardDelivery {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    cardId: row.card_id,
    barcodeValue: row.barcode_value,
    phone: row.phone,
    status: row.status,
    error: row.error,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

async function renderDeliveryMedia(barcodeValue: string, memberName: string): Promise<CardDeliveryMediaPayload> {
  const base64 = await renderQrPngBase64(barcodeValue);
  return {
    base64,
    mime: "image/png",
    caption: `بطاقة العضوية - ${memberName}\n${barcodeValue}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Randomized 2-5s pacing to look human; skipped in mock mode so tests stay fast. */
async function pacingDelay(isMock: boolean): Promise<void> {
  if (isMock) return;
  const ms = 2000 + Math.floor(Math.random() * 3001);
  await sleep(ms);
}

/**
 * Queues a QR delivery for a card. Idempotent per card: the existing row is
 * (re)used — pending/sent are returned as-is; failed/skipped_no_phone/
 * not_configured are flipped back to pending with fresh member snapshots.
 * card_deliveries.dedupe_key is UNIQUE, so a second INSERT for the same card
 * is impossible; we always reuse the existing row instead.
 */
export async function queueCardDelivery(
  db: Db,
  actor: ServiceActor,
  input: { cardId: string },
): Promise<PublicCardDelivery> {
  requirePermission(actor, "cards.send");
  const card = getCardById(db, input.cardId);
  if (!card) throw errNotFound("errors.cardNotFound");
  if (!card.member_id) throw errValidation("errors.cardNotAssigned");

  const member = getMemberRowById(db, card.member_id);
  if (!member) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, member.department);

  const dedupeKey = `card:${card.id}:v1`;
  return db.transaction(async () => {
    const existing = db.first<CardDeliveryRow>(
      `${DELIVERY_SELECT} WHERE dedupe_key = ? ORDER BY created_at DESC LIMIT 1`,
      [dedupeKey],
    );
    if (existing && (existing.status === "pending" || existing.status === "sent")) {
      return toDelivery(existing);
    }
    if (existing) {
      // Re-queue an old terminal row (failed/skipped_no_phone/not_configured):
      // reuse the id, refresh member snapshots, clear the error.
      db.run(
        "UPDATE card_deliveries SET status = 'pending', member_name = ?, phone = ?, error = NULL, image_hash = NULL, sent_at = NULL, created_at = ? WHERE id = ?",
        [member.full_name, member.phone ?? null, nowStamp(), existing.id],
      );
      recordAudit(db, actor, "CARD_DELIVERY_QUEUED", "card", card.id, {
        barcode: card.barcode_value,
        memberCode: member.member_code,
        phone: member.phone ?? null,
        requeued: existing.status,
      });
      return toDelivery(db.first<CardDeliveryRow>(`${DELIVERY_SELECT} WHERE id = ?`, [existing.id])!);
    }

    const id = crypto.randomUUID();
    db.run(
      "INSERT INTO card_deliveries (id, member_id, card_id, barcode_value, member_name, phone, status, error, image_hash, dedupe_key, sent_at, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL, ?, ?)",
      [
        id,
        member.id,
        card.id,
        card.barcode_value,
        member.full_name,
        member.phone ?? null,
        dedupeKey,
        actor.userId,
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "CARD_DELIVERY_QUEUED", "card", card.id, {
      barcode: card.barcode_value,
      memberCode: member.member_code,
      phone: member.phone ?? null,
    });
    return toDelivery(db.first<CardDeliveryRow>(`${DELIVERY_SELECT} WHERE id = ?`, [id])!);
  });
}

/**
 * Flushes the pending queue. Without a configured provider every row becomes
 * `not_configured`; without a phone `skipped_no_phone`; successful sends render
 * the QR image and hand it to the transport.
 */
export async function sendPendingCardDeliveries(
  db: Db,
  actor: ServiceActor,
  limit = 20,
): Promise<{ sent: number; failed: number; skippedNoPhone: number; notConfigured: number }> {
  requirePermission(actor, "cards.send");
  const { transport, provider } = resolveTransport(db);
  const mock = envFlag("GYM_CRM_MOCK");
  const pending = db
    .all<CardDeliveryRow>(
      `${DELIVERY_SELECT} WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
      [Math.min(100, Math.max(1, limit))],
    )
    .map(toDelivery);

  let sent = 0;
  let failed = 0;
  let skippedNoPhone = 0;
  let notConfigured = 0;

  for (const item of pending) {
    if (!transport) {
      db.run("UPDATE card_deliveries SET status = 'not_configured', error = NULL WHERE id = ?", [item.id]);
      notConfigured++;
      continue;
    }
    if (!item.phone) {
      db.run("UPDATE card_deliveries SET status = 'skipped_no_phone', error = NULL WHERE id = ?", [item.id]);
      skippedNoPhone++;
      continue;
    }

    const media = await renderDeliveryMedia(item.barcodeValue, item.memberName ?? item.memberId);
    db.run("UPDATE card_deliveries SET image_hash = ? WHERE id = ?", [
      await sha256Hex(media.base64).catch(() => ""),
      item.id,
    ]);
    const body = `بطاقة العضوية - ${item.memberName ?? ""}\n${item.barcodeValue}`;

    try {
      const result = await transport(item.phone, body, media);
      if (result.ok) {
        db.run("UPDATE card_deliveries SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [
          nowStamp(),
          item.id,
        ]);
        recordAudit(db, actor, "CARD_DELIVERY_SENT", "card", item.cardId, {
          barcode: item.barcodeValue,
          memberId: item.memberId,
          phone: item.phone,
          provider,
        });
        sent++;
      } else {
        db.run("UPDATE card_deliveries SET status = 'failed', error = ? WHERE id = ?", [
          result.error ?? null,
          item.id,
        ]);
        recordAudit(db, actor, "CARD_DELIVERY_FAILED", "card", item.cardId, {
          barcode: item.barcodeValue,
          memberId: item.memberId,
          error: result.error,
        });
        failed++;
      }
    } catch (error) {
      db.run("UPDATE card_deliveries SET status = 'failed', error = ? WHERE id = ?", [String(error), item.id]);
      failed++;
    }
    await pacingDelay(mock);
  }

  return { sent, failed, skippedNoPhone, notConfigured };
}

export function listCardDeliveries(
  db: Db,
  actor: ServiceActor,
  query: { memberId?: string; status?: CardDeliveryStatus | "all"; limit?: number } = {},
): PublicCardDelivery[] {
  requirePermission(actor, "cards.send");
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (query.memberId) {
    conditions.push("member_id = ?");
    params.push(query.memberId);
  }
  if (query.status && query.status !== "all") {
    conditions.push("status = ?");
    params.push(query.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  return db
    .all<CardDeliveryRow>(`${DELIVERY_SELECT} ${where} ORDER BY created_at DESC LIMIT ?`, [
      ...params,
      limit,
    ])
    .map(toDelivery);
}

export function countPendingCardDeliveries(db: Db, actor: ServiceActor): number {
  requirePermission(actor, "cards.send");
  return db.count("SELECT COUNT(*) FROM card_deliveries WHERE status = 'pending'");
}