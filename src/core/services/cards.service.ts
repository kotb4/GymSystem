import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { nowStamp } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById } from "./members.service";

export type CardStatus = "available" | "assigned" | "lost" | "blocked";

const BARCODE_RE = /^[A-Za-z0-9-]{4,32}$/;

export interface CardRow extends Row {
  id: string;
  barcode_value: string;
  status: CardStatus;
  member_id: string | null;
  notes: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  unassigned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicCard {
  id: string;
  barcodeValue: string;
  status: CardStatus;
  memberId: string | null;
  notes: string | null;
  assignedAt: string | null;
  unassignedAt: string | null;
}

export interface CardWithMember extends PublicCard {
  memberCode: string | null;
  memberName: string | null;
}

function normalizeBarcode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function assertBarcodeFormat(raw: string): string {
  const barcode = normalizeBarcode(raw);
  if (!BARCODE_RE.test(barcode)) throw errValidation("errors.barcodeInvalid");
  return barcode;
}

function toCard(row: CardRow): PublicCard {
  return {
    id: row.id,
    barcodeValue: row.barcode_value,
    status: row.status,
    memberId: row.member_id,
    notes: row.notes,
    assignedAt: row.assigned_at,
    unassignedAt: row.unassigned_at,
  };
}

export function getCardByBarcode(db: Db, rawBarcode: string): CardRow | null {
  return db.first<CardRow>("SELECT * FROM cards WHERE barcode_value = ?", [
    normalizeBarcode(rawBarcode),
  ]);
}

export function getCardById(db: Db, cardId: string): CardRow | null {
  return db.first<CardRow>("SELECT * FROM cards WHERE id = ?", [cardId]);
}

export function nextBarcodePreview(db: Db): string {
  const current = Number(db.scalar("SELECT value FROM counters WHERE name = 'card_barcode'") ?? 100);
  return `GYM-${String(current + 1).padStart(6, "0")}`;
}

export async function registerCard(
  db: Db,
  actor: ServiceActor,
  input: { barcodeValue: string; notes?: string | null },
): Promise<PublicCard> {
  requirePermission(actor, "cards.register");
  const barcode = assertBarcodeFormat(input.barcodeValue);
  if (getCardByBarcode(db, barcode)) throw errConflict("errors.cardExists", { barcode });

  const id = crypto.randomUUID();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO cards (id, barcode_value, status, member_id, notes, created_at, updated_at)\nVALUES (?, ?, 'available', NULL, ?, ?, ?)",
      [id, barcode, input.notes?.trim() || null, nowStamp(), nowStamp()],
    );
    recordAudit(db, actor, "CARD_REGISTERED", "card", id, { barcode });
  });
  return toCard(getCardById(db, id)!);
}

export async function assignCardByBarcode(
  db: Db,
  actor: ServiceActor,
  input: { barcodeValue: string; memberId: string },
): Promise<{ card: PublicCard; registeredNew: boolean }> {
  requirePermission(actor, "cards.assign");
  const barcode = assertBarcodeFormat(input.barcodeValue);
  const member = getMemberRowById(db, input.memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  if (member.status === "archived") throw errValidation("errors.memberArchived");

  const stamp = nowStamp();

  return db.transaction(async () => {
    let card = getCardByBarcode(db, barcode);
    let registeredNew = false;

    if (!card) {
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO cards (id, barcode_value, status, member_id, created_at, updated_at)\nVALUES (?, ?, 'available', NULL, ?, ?)",
        [id, barcode, stamp, stamp],
      );
      recordAudit(db, actor, "CARD_REGISTERED", "card", id, { barcode });
      card = getCardById(db, id);
      registeredNew = true;
    }
    if (!card) throw new Error("card vanished");

    if (card.status === "lost") throw errConflict("errors.cardLost", { barcode });
    if (card.status === "blocked") throw errConflict("errors.cardBlocked", { barcode });

    if (card.status === "assigned") {
      if (card.member_id === member.id) {
        return { card: toCard(card), registeredNew };
      }
      const holder = card.member_id ? getMemberRowById(db, card.member_id) : null;
      throw errConflict("errors.cardAssignedOther", {
        barcode,
        holderName: holder?.full_name ?? "",
      });
    }

    db.run(
      "UPDATE cards SET status = 'assigned', member_id = ?, assigned_at = ?, assigned_by = ?, unassigned_at = NULL, updated_at = ? WHERE id = ?",
      [member.id, stamp, actor.userId, stamp, card.id],
    );
    recordAudit(db, actor, "CARD_ASSIGNED", "card", card.id, {
      barcode,
      memberCode: member.member_code,
      memberName: member.full_name,
    });

    return { card: toCard(getCardById(db, card.id)!), registeredNew };
  });
}

export async function unassignCard(
  db: Db,
  actor: ServiceActor,
  cardId: string,
): Promise<PublicCard> {
  requirePermission(actor, "cards.unassign");
  const card = getCardById(db, cardId);
  if (!card) throw errNotFound("errors.cardNotFound");
  if (card.status !== "assigned") throw errValidation("errors.cardNotAssigned");

  await db.transaction(async () => {
    db.run(
      "UPDATE cards SET status = 'available', member_id = NULL, unassigned_at = ?, updated_at = ? WHERE id = ?",
      [nowStamp(), nowStamp(), cardId],
    );
    recordAudit(db, actor, "CARD_UNASSIGNED", "card", cardId, { barcode: card.barcode_value });
  });
  return toCard(getCardById(db, cardId)!);
}

export async function reportCardLost(
  db: Db,
  actor: ServiceActor,
  cardId: string,
): Promise<PublicCard> {
  requirePermission(actor, "cards.report_lost");
  const card = getCardById(db, cardId);
  if (!card) throw errNotFound("errors.cardNotFound");
  if (card.status === "lost") return toCard(card);

  await db.transaction(async () => {
    db.run("UPDATE cards SET status = 'lost', updated_at = ? WHERE id = ?", [nowStamp(), cardId]);
    recordAudit(db, actor, "CARD_REPORTED_LOST", "card", cardId, {
      barcode: card.barcode_value,
    });
  });
  return toCard(getCardById(db, cardId)!);
}

export async function setCardBlocked(
  db: Db,
  actor: ServiceActor,
  cardId: string,
  blocked: boolean,
): Promise<PublicCard> {
  requirePermission(actor, "cards.block");
  const card = getCardById(db, cardId);
  if (!card) throw errNotFound("errors.cardNotFound");
  const targetStatus: CardStatus = blocked ? "blocked" : card.member_id ? "assigned" : "available";
  if (card.status === targetStatus && !(blocked && card.status === "blocked")) {
    return toCard(card);
  }

  await db.transaction(async () => {
    db.run("UPDATE cards SET status = ?, updated_at = ? WHERE id = ?", [
      targetStatus,
      nowStamp(),
      cardId,
    ]);
    recordAudit(db, actor, blocked ? "CARD_BLOCKED" : "CARD_UNBLOCKED", "card", cardId, {
      barcode: card.barcode_value,
      restoredTo: targetStatus,
    });
  });
  return toCard(getCardById(db, cardId)!);
}

export interface CardListQuery {
  status?: CardStatus | "all";
  search?: string;
  page?: number;
  pageSize?: number;
}

interface CardJoinRow extends CardRow {
  member_code: string | null;
  full_name: string | null;
}

export function listCards(
  db: Db,
  actor: ServiceActor,
  query: CardListQuery = {},
): { items: CardWithMember[]; total: number } {
  requirePermission(actor, "cards.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status && query.status !== "all") {
    conditions.push("c.status = ?");
    params.push(query.status);
  }
  const search = query.search?.trim();
  if (search) {
    conditions.push("(c.barcode_value LIKE ? OR m.full_name LIKE ? OR m.member_code LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM cards c LEFT JOIN members m ON m.id = c.member_id ${where}`, params);
  const rows = db.all<CardJoinRow>(
    `SELECT c.*, m.member_code AS member_code, m.full_name AS full_name\nFROM cards c LEFT JOIN members m ON m.id = c.member_id\n${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  return {
    items: rows.map((row) => ({
      ...toCard(row),
      memberCode: row.member_code,
      memberName: row.full_name,
    })),
    total,
  };
}

export function listMemberCards(db: Db, actor: ServiceActor, memberId: string): CardWithMember[] {
  requirePermission(actor, "cards.view");
  return db
    .all<CardJoinRow>(
      "SELECT c.*, m.member_code AS member_code, m.full_name AS full_name\nFROM cards c LEFT JOIN members m ON m.id = c.member_id\nWHERE c.member_id = ? ORDER BY c.assigned_at DESC",
      [memberId],
    )
    .map((row) => ({ ...toCard(row), memberCode: row.member_code, memberName: row.full_name }));
}

export interface BulkRegisterResult {
  registered: string[];
  existing: string[];
  duplicateInBatch: string[];
  invalid: Array<{ value: string; reason: "empty" | "format" }>;
}

const BULK_LIMIT = 200;

/**
 * Registers a batch of pre-printed barcode values scanned/pasted by staff.
 * Only clean values are inserted; every rejected value is reported back.
 */
export async function registerCardsBulk(
  db: Db,
  actor: ServiceActor,
  input: { values: string[] },
): Promise<BulkRegisterResult> {
  requirePermission(actor, "cards.register");

  const result: BulkRegisterResult = {
    registered: [],
    existing: [],
    duplicateInBatch: [],
    invalid: [],
  };

  const seen = new Set<string>();
  const normalized: string[] = [];
  let processed = 0;
  for (const raw of input.values) {
    if (processed >= BULK_LIMIT) break;
    const value = raw.trim().toUpperCase();
    if (value === "") continue;
    processed += 1;
    try {
      const barcode = assertBarcodeFormat(value);
      if (seen.has(barcode)) {
        result.duplicateInBatch.push(barcode);
        continue;
      }
      seen.add(barcode);
      normalized.push(barcode);
    } catch {
      result.invalid.push({ value: value.slice(0, 40), reason: "format" });
    }
  }

  const existingSet = new Set<string>();
  for (const barcode of normalized) {
    if (getCardByBarcode(db, barcode)) existingSet.add(barcode);
  }
  result.existing = [...existingSet];

  const toInsert = normalized.filter((barcode) => !existingSet.has(barcode));

  await db.transaction(async () => {
    const stamp = nowStamp();
    for (const barcode of toInsert) {
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO cards (id, barcode_value, status, member_id, notes, created_at, updated_at)\nVALUES (?, ?, 'available', NULL, ?, ?, ?)",
        [id, barcode, "bulk", stamp, stamp],
      );
    }
    if (toInsert.length > 0) {
      recordAudit(db, actor, "CARD_BULK_REGISTERED", "card", null, {
        count: toInsert.length,
        skipped: result.existing.length + result.duplicateInBatch.length + result.invalid.length,
      });
    }
  });

  result.registered = toInsert;
  return result;
}
