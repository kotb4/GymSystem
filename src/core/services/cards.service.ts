import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { nowStamp } from "@/core/dates";
import { getLocalBranchPrefix } from "@/core/branch";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById } from "./members.service";

export type CardStatus = "available" | "assigned" | "lost" | "blocked";
export type CardKind = "physical" | "virtual";

const BARCODE_RE = /^[A-Za-z0-9-]{4,32}$/;

export interface CardRow extends Row {
  id: string;
  barcode_value: string;
  status: CardStatus;
  kind: CardKind;
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
  kind: CardKind;
  memberId: string | null;
  notes: string | null;
  assignedAt: string | null;
  unassignedAt: string | null;
}

export interface CardWithMember extends PublicCard {
  memberCode: string | null;
  memberName: string | null;
  memberPhone: string | null;
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
    kind: row.kind ?? "physical",
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

/**
 * Creates (or returns) the member's virtual card whose barcode equals their
 * member code. Idempotent: two members never share a virtual card because
 * member_code is UNIQUE. Runs inside the caller's transaction.
 */
export function ensureVirtualCard(
  db: Db,
  opts: { memberId: string; memberCode: string; actorId?: string | null; stamp?: string },
): CardRow {
  const barcode = assertBarcodeFormat(opts.memberCode);
  const stamp = opts.stamp ?? nowStamp();
  const existing = db.first<CardRow>("SELECT * FROM cards WHERE barcode_value = ? LIMIT 1", [barcode]);
  if (existing) {
    if (existing.kind !== "virtual" || existing.status !== "assigned" || existing.member_id !== opts.memberId) {
      db.run(
        "UPDATE cards SET kind = 'virtual', status = 'assigned', member_id = ?, assigned_at = ?, assigned_by = COALESCE(assigned_by, ?), unassigned_at = NULL, updated_at = ? WHERE id = ?",
        [opts.memberId, stamp, opts.actorId ?? null, stamp, existing.id],
      );
      return getCardById(db, existing.id)!;
    }
    return existing;
  }
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO cards (id, barcode_value, status, kind, member_id, notes, assigned_at, assigned_by, created_at, updated_at)\nVALUES (?, ?, 'assigned', 'virtual', ?, ?, ?, ?, ?, ?)",
    [id, barcode, opts.memberId, "Virtual card (member code)", stamp, opts.actorId ?? null, stamp, stamp],
  );
  return getCardById(db, id)!;
}

/**
 * Creates or re-attaches a virtual card for a member (e.g. after it was unassigned).
 */
export async function createVirtualCard(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): Promise<PublicCard> {
  requirePermission(actor, "cards.assign");
  const member = getMemberRowById(db, memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  if (member.status === "archived") throw errValidation("errors.memberArchived");

  return db.transaction(() => {
    const card = ensureVirtualCard(db, {
      memberId: member.id,
      memberCode: member.member_code,
      actorId: actor.userId,
    });
    recordAudit(db, actor, "CARD_ASSIGNED", "card", card.id, {
      barcode: card.barcode_value,
      kind: "virtual",
      memberCode: member.member_code,
      memberName: member.full_name,
    });
    return toCard(card);
  });
}

export function nextBarcodePreview(db: Db): string {
  const branchPrefix = getLocalBranchPrefix(db);
  const current = Number(db.scalar("SELECT value FROM counters WHERE name = 'card_barcode'") ?? 100);
  const numStr = String(current + 1).padStart(6, "0");
  return branchPrefix ? `${branchPrefix}-CRD-${numStr}` : `CRD-${numStr}`;
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
  status?: CardStatus | "all" | "lost_or_blocked";
  kind?: CardKind | "all";
  search?: string;
  page?: number;
  pageSize?: number;
}

interface CardJoinRow extends CardRow {
  member_code: string | null;
  full_name: string | null;
  phone: string | null;
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
    if (query.status === "lost_or_blocked") {
      conditions.push("c.status IN ('lost', 'blocked')");
    } else {
      conditions.push("c.status = ?");
      params.push(query.status);
    }
  }
  if (query.kind && query.kind !== "all") {
    conditions.push("c.kind = ?");
    params.push(query.kind);
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
    `SELECT c.*, m.member_code AS member_code, m.full_name AS full_name, m.phone AS phone\nFROM cards c LEFT JOIN members m ON m.id = c.member_id\n${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  return {
    items: rows.map((row) => ({
      ...toCard(row),
      memberCode: row.member_code,
      memberName: row.full_name,
      memberPhone: row.phone,
    })),
    total,
  };
}

export function listMemberCards(db: Db, actor: ServiceActor, memberId: string): CardWithMember[] {
  requirePermission(actor, "cards.view");
  return db
    .all<CardJoinRow>(
      "SELECT c.*, m.member_code AS member_code, m.full_name AS full_name, m.phone AS phone\nFROM cards c LEFT JOIN members m ON m.id = c.member_id\nWHERE c.member_id = ? ORDER BY c.assigned_at DESC",
      [memberId],
    )
    .map((row) => ({ ...toCard(row), memberCode: row.member_code, memberName: row.full_name, memberPhone: row.phone }));
}

export interface CardStats {
  total: number;
  assigned: number;
  available: number;
  virtual: number;
  physical: number;
  lost: number;
  blocked: number;
}

export function getCardStats(db: Db, actor: ServiceActor): CardStats {
  requirePermission(actor, "cards.view");
  const row = db.first<{
    total: number;
    assigned: number;
    available: number;
    virtual: number;
    physical: number;
    lost: number;
    blocked: number;
  }>(
    `SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned,
      COALESCE(SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), 0) AS available,
      COALESCE(SUM(CASE WHEN kind = 'virtual' THEN 1 ELSE 0 END), 0) AS virtual,
      COALESCE(SUM(CASE WHEN kind = 'physical' THEN 1 ELSE 0 END), 0) AS physical,
      COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS lost,
      COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked
    FROM cards`,
  );
  return {
    total: Number(row?.total ?? 0),
    assigned: Number(row?.assigned ?? 0),
    available: Number(row?.available ?? 0),
    virtual: Number(row?.virtual ?? 0),
    physical: Number(row?.physical ?? 0),
    lost: Number(row?.lost ?? 0),
    blocked: Number(row?.blocked ?? 0),
  };
}

export interface AutoGenerateCardsInput {
  count: number;
  prefix?: string;
}

export interface AutoGenerateCardsResult {
  count: number;
  fromBarcode: string;
  toBarcode: string;
  registered: string[];
}

export async function autoGenerateCards(
  db: Db,
  actor: ServiceActor,
  input: AutoGenerateCardsInput,
): Promise<AutoGenerateCardsResult> {
  requirePermission(actor, "cards.register");
  const count = Math.min(200, Math.max(1, Number(input.count) || 1));
  const rawPrefix = (input.prefix ?? "GYM").trim().toUpperCase();
  const cleanPrefix = rawPrefix.endsWith("-") ? rawPrefix : `${rawPrefix}-`;

  const existing = db.all<{ barcode_value: string }>(
    "SELECT barcode_value FROM cards WHERE barcode_value LIKE ? ORDER BY barcode_value DESC LIMIT 500",
    [`${cleanPrefix}%`],
  );

  let maxNum = 100;
  const numRegex = new RegExp(`^${cleanPrefix.replace("-", "\\-")}(\\d+)$`);
  for (const row of existing) {
    const m = row.barcode_value.match(numRegex);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }

  const generatedBarcodes: string[] = [];
  for (let i = 1; i <= count; i++) {
    const nextNum = maxNum + i;
    const barcode = `${cleanPrefix}${String(nextNum).padStart(6, "0")}`;
    generatedBarcodes.push(barcode);
  }

  const bulkRes = await registerCardsBulk(db, actor, { values: generatedBarcodes });

  return {
    count: bulkRes.registered.length,
    fromBarcode: generatedBarcodes[0] ?? "",
    toBarcode: generatedBarcodes[generatedBarcodes.length - 1] ?? "",
    registered: bulkRes.registered,
  };
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

export interface DeleteCardResult {
  /** True when the card was released from its member as part of the delete. */
  unassigned: boolean;
  /** Attendance rows kept but detached from the deleted card. */
  detachedAttendance: number;
}

export interface DeleteCardOptions {
  /**
   * Force mode — lets a printed card be removed even while assigned to a
   * member and/or already used for check-in. The card row is still deleted
   * (hard delete); `force` only relaxes the two guards below.
   */
  force?: boolean;
}

/**
 * Hard-deletes a physical card. Virtual cards (auto-generated member cards)
 * are always protected — they ARE the member's check-in identity.
 *
 * Default (safe) mode refuses cards that are assigned to a member or that
 * already have attendance history. `force: true` releases the card from its
 * member and detaches historical attendance rows (setting `attendance.card_id`
 * to NULL) instead of refusing, so a lost/worn printed card can be replaced
 * without discarding check-in history.
 */
export async function deleteCard(
  db: Db,
  actor: ServiceActor,
  cardId: string,
  opts: DeleteCardOptions = {},
): Promise<DeleteCardResult> {
  requirePermission(actor, "cards.delete");

  const card = getCardById(db, cardId);
  if (!card) throw errNotFound("errors.cardNotFound");

  if (card.kind === "virtual") {
    throw errConflict("errors.cardVirtualCannotDelete");
  }

  // `force` arrives straight off the RPC boundary, so only an explicit boolean
  // true enables the destructive path; anything else falls back to safe mode.
  const force = opts != null && opts.force === true;
  if (!force) {
    if (card.status === "assigned") {
      throw errConflict("errors.cardAssignedCannotDelete");
    }
    // Protect cards that have attendance history (used for check-in at least once)
    const usageCount = db.count(
      "SELECT COUNT(*) FROM attendance WHERE card_id = ?",
      [cardId],
    );
    if (usageCount > 0) {
      throw errConflict("errors.cardHasAttendanceCannotDelete");
    }
  }

  return db.transaction(() => {
    const unassigned = card.status === "assigned";
    if (unassigned) {
      const stamp = nowStamp();
      db.run(
        "UPDATE cards SET status = 'available', member_id = NULL, unassigned_at = ?, updated_at = ? WHERE id = ?",
        [stamp, stamp, cardId],
      );
      recordAudit(db, actor, "CARD_UNASSIGNED", "card", cardId, {
        barcode: card.barcode_value,
        reason: "card_deleted",
      });
    }

    // Keep the check-in history but drop the link to the card being deleted —
    // attendance rows survive (member, time, subscription) so reports stay
    // intact; only "which physical card" is lost, which is inherent to
    // deleting that card.
    const detachedAttendance = db.run(
      "UPDATE attendance SET card_id = NULL WHERE card_id = ?",
      [cardId],
    ).changes;

    // Remove any pending delivery records first (FK-safe order)
    db.run("DELETE FROM card_deliveries WHERE card_id = ?", [cardId]);
    db.run("DELETE FROM cards WHERE id = ?", [cardId]);
    recordAudit(db, actor, "CARD_DELETED", "card", cardId, {
      barcode: card.barcode_value,
      kind: card.kind,
      status: card.status,
      unassigned,
      detachedAttendance,
    });

    return { unassigned, detachedAttendance };
  });
}
