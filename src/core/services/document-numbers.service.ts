import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { getLocalBranchPrefix } from "@/core/branch";
import type { Db } from "@/db/engine";

/**
 * Printable, searchable reference number for every customer-facing operation.
 *
 * The operator's real workflow is: a document gets printed, the customer keeps
 * it, and days later they come back and read the number out loud. So each
 * operation type owns a prefix and its own counter, and `searchByDocNo` accepts
 * ANY of them and reports which operation matched.
 *
 * Numbers are idempotent: asking again for a row that already has one returns
 * the stored value and never burns a counter.
 */
export type DocKind =
  | "payment"
  | "refund"
  | "store_sale"
  | "store_return"
  | "store_debt_payment"
  | "cash_closing"
  | "attendance";

interface KindSpec {
  kind: DocKind;
  /** Human-facing prefix, e.g. `RCP`. */
  prefix: string;
  /** Row in `counters` holding the sequence. */
  counter: string;
  table: string;
  column: string;
  /** Route the UI should navigate to for this kind. */
  route: string;
  /** Short Arabic description shown in the search result. */
  summary: string;
  /** FROM + JOINs needed to reach the member, aliased as `x`. */
  from: string;
  /** Money column (minor units) or null when the kind has no amount. */
  amount: string | null;
  /** Timestamp column or null. */
  occurred: string | null;
  /** Member id expression (may be null for kinds with no member). */
  memberId: string | null;
  /** Member name expression; null when `from` does not join `members`. */
  memberName: string | null;
  /** Extra WHERE fragment, e.g. skipping soft-deleted attendance. */
  extraWhere: string | null;
}

const DOC_KINDS: Record<DocKind, KindSpec> = {
  payment: {
    kind: "payment",
    prefix: "RCP",
    counter: "receipt_no",
    table: "payments",
    column: "receipt_no",
    route: "/payments",
    summary: "دفعة اشتراك",
    from: "payments x LEFT JOIN members m ON m.id = x.member_id",
    amount: "x.paid_amount_minor",
    occurred: "x.paid_at",
    memberId: "x.member_id",
    memberName: "m.full_name",
    extraWhere: null,
  },
  refund: {
    kind: "refund",
    prefix: "RFD",
    counter: "refund_no",
    table: "payment_refunds",
    column: "refund_no",
    route: "/payments",
    summary: "استرجاع مبلغ",
    from: "payment_refunds x LEFT JOIN payments p ON p.id = x.payment_id LEFT JOIN members m ON m.id = p.member_id",
    amount: "x.amount_minor",
    occurred: "x.created_at",
    memberId: "p.member_id",
    memberName: "m.full_name",
    extraWhere: null,
  },
  store_sale: {
    kind: "store_sale",
    prefix: "POS",
    counter: "store_sale_no",
    table: "store_sales",
    column: "sale_no",
    route: "/store",
    summary: "عملية بيع متجر",
    from: "store_sales x LEFT JOIN members m ON m.id = x.member_id",
    amount: "x.total_minor",
    occurred: "x.sold_at",
    memberId: "x.member_id",
    memberName: "m.full_name",
    extraWhere: null,
  },
  store_return: {
    kind: "store_return",
    prefix: "SRT",
    counter: "store_return_no",
    table: "store_returns",
    column: "return_no",
    route: "/store",
    summary: "مرتجع متجر",
    from: "store_returns x LEFT JOIN store_sales s ON s.id = x.sale_id LEFT JOIN members m ON m.id = s.member_id",
    amount: "x.total_minor",
    occurred: "x.created_at",
    memberId: "s.member_id",
    memberName: "m.full_name",
    extraWhere: null,
  },
  store_debt_payment: {
    kind: "store_debt_payment",
    prefix: "SDP",
    counter: "store_debt_payment_no",
    table: "store_debt_payments",
    column: "payment_no",
    route: "/store",
    summary: "سداد دين متجر",
    from:
      "store_debt_payments x LEFT JOIN store_debts d ON d.id = x.debt_id " +
      "LEFT JOIN store_sales s ON s.id = d.sale_id LEFT JOIN members m ON m.id = s.member_id",
    amount: "x.amount_minor",
    occurred: "x.created_at",
    memberId: "s.member_id",
    memberName: "m.full_name",
    extraWhere: null,
  },
  cash_closing: {
    kind: "cash_closing",
    prefix: "CS",
    counter: "cash_closing_no",
    table: "cash_sessions",
    column: "closing_no",
    route: "/treasury",
    summary: "إقفال صندوق",
    from: "cash_sessions x",
    amount: "x.counted_closing_minor",
    occurred: "x.closed_at",
    memberId: null,
    memberName: null,
    extraWhere: "x.closed_at IS NOT NULL",
  },
  attendance: {
    kind: "attendance",
    prefix: "ATT",
    counter: "attendance_no",
    table: "attendance",
    column: "visit_no",
    route: "/attendance",
    summary: "حضور",
    from: "attendance x LEFT JOIN members m ON m.id = x.member_id",
    amount: null,
    occurred: "x.checkin_at",
    memberId: "x.member_id",
    memberName: "m.full_name",
    // Soft-deleted check-ins (undo) must never surface in a lookup.
    extraWhere: "x.deleted_at IS NULL",
  },
};

/**
 * Allocate the NEXT reference number for a kind, without touching a row.
 *
 * Use this when the number must be part of an INSERT (the column is NOT NULL).
 * Use `assignDocNo` when the row already exists.
 *
 * The branch prefix comes first (like member codes `B1-MEM-000001`) so two
 * branches syncing independently can never mint the same document number. It is
 * omitted when the branch has no prefix configured.
 */
export function nextDocNo(db: Db, kind: DocKind, atIso: string): string {
  const spec = DOC_KINDS[kind];
  const year = (atIso.slice(0, 4) || String(new Date().getFullYear())).replace(/\D/g, "");
  db.run("INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1", [
    spec.counter,
  ]);
  const seq = Number(db.scalar("SELECT value FROM counters WHERE name = ?", [spec.counter]) ?? 1);
  const tail = `${spec.prefix}-${year}-${String(seq).padStart(6, "0")}`;
  const branch = getLocalBranchPrefix(db);
  return branch ? `${branch}-${tail}` : tail;
}

/**
 * Allocate (or return) the reference number for one row.
 * MUST be called inside the same transaction as the row insert, so a number is
 * never allocated for a row that later rolls back.
 */
export function assignDocNo(db: Db, kind: DocKind, rowId: string, atIso: string): string {
  const spec = DOC_KINDS[kind];
  const cached = db.scalar(`SELECT ${spec.column} FROM ${spec.table} WHERE id = ?`, [rowId]);
  if (typeof cached === "string" && cached !== "") return cached;
  const docNo = nextDocNo(db, kind, atIso);
  db.run(`UPDATE ${spec.table} SET ${spec.column} = ? WHERE id = ?`, [docNo, rowId]);
  return docNo;
}

export interface DocNoMatch {
  kind: DocKind;
  docNo: string;
  table: string;
  rowId: string;
  memberId: string | null;
  memberName: string | null;
  occurredAt: string | null;
  amountMinor: number | null;
  /** Route to navigate to, plus the id of the matched row. */
  route: string;
  summary: string;
}

interface RawMatch {
  row_id: string;
  doc_no: string;
  member_id: string | null;
  member_name: string | null;
  occurred_at: string | null;
  amount_minor: number | null;
}

/**
 * Normalise whatever the operator typed into forms we can match.
 *
 * Numbers exist in two shapes now: legacy `POS-000001` (no year, no branch) and
 * current `B1-RCP-2026-000123`. A customer may also read out only digits, or
 * only the sequence without the branch/year. So we match on the FULL string,
 * on the string with a leading branch token removed, and on the trailing
 * sequence digits.
 */
function matchForms(rawQuery: string): { exacts: string[]; seq: string } {
  const query = rawQuery.trim().toUpperCase();
  const exacts = new Set<string>([query]);
  // Strip a leading branch token like `B1-` / `B2-`.
  const withoutBranch = query.replace(/^[A-Z0-9]{1,6}-(?=[A-Z]{2,}-)/, "");
  exacts.add(withoutBranch);
  // The sequence is the LAST purely-numeric hyphen-separated token.
  const parts = query.split("-").filter(Boolean);
  const numeric = parts.filter((p) => /^\d+$/.test(p));
  const seq = numeric.length > 0 ? numeric[numeric.length - 1] : "";
  return { exacts: [...exacts], seq };
}

/**
 * Look up any operation by its printed reference number.
 *
 * Two stages, deliberately:
 *  1. exact match on the full number (with/without branch token). If the
 *     operator pasted or read the whole number, this must return exactly that
 *     row — no fuzzy fan-out;
 *  2. only if stage 1 finds nothing, fall back to the trailing sequence digits,
 *     because a customer often reads out "one-two-hundred-thousand" with no
 *     prefix. Different kinds keep separate counters starting at 1, so a bare
 *     sequence can legitimately match several operations; returning them all
 *     (each labelled with its type) is the useful answer, not a bug.
 */
export function searchByDocNo(db: Db, actor: ServiceActor, rawQuery: string): DocNoMatch[] {
  requirePermission(actor, "reports.view");
  const query = String(rawQuery ?? "").trim();
  if (!query) throw errValidation("errors.finance.docNoRequired");

  const { exacts, seq } = matchForms(query);
  const extra = (spec: KindSpec) => (spec.extraWhere ? `AND ${spec.extraWhere}` : "");
  const project = (spec: KindSpec) =>
    `SELECT x.id AS row_id,
            UPPER(x.${spec.column}) AS doc_no,
            ${spec.memberId ? `${spec.memberId} AS member_id` : "NULL AS member_id"},
            ${spec.memberName ? `${spec.memberName} AS member_name` : "NULL AS member_name"},
            ${spec.occurred ? `${spec.occurred} AS occurred_at` : "NULL AS occurred_at"},
            ${spec.amount ? `${spec.amount} AS amount_minor` : "NULL AS amount_minor"}
       FROM ${spec.from}`;

  const specs = (Object.keys(DOC_KINDS) as DocKind[]).map((k) => DOC_KINDS[k]);
  const available = specs.filter((s) => tableExists(db, s.table) && columnExists(db, s.table, s.column));

  // Stage 1 — exact.
  const exactRows = available.flatMap((spec) =>
    db
      .all<RawMatch>(
        `${project(spec)}
          WHERE UPPER(x.${spec.column}) IN (${exacts.map(() => "?").join(", ")})
            ${extra(spec)}
          LIMIT 5`,
        exacts,
      )
      .map((r) => toMatch(spec, r)),
  );
  if (exactRows.length > 0) return exactRows;

  // Stage 2 — trailing sequence digits only.
  if (!seq) return [];
  return available.flatMap((spec) =>
    db
      .all<RawMatch>(
        `${project(spec)}
          WHERE x.${spec.column} LIKE ?
            ${extra(spec)}
          LIMIT 5`,
        [`%${seq}%`],
      )
      .map((r) => toMatch(spec, r)),
  );
}

function toMatch(spec: KindSpec, r: RawMatch): DocNoMatch {
  return {
    kind: spec.kind,
    docNo: String(r.doc_no),
    table: spec.table,
    rowId: String(r.row_id),
    memberId: r.member_id == null ? null : String(r.member_id),
    memberName: r.member_name == null ? null : String(r.member_name),
    occurredAt: r.occurred_at == null ? null : String(r.occurred_at),
    amountMinor: r.amount_minor == null ? null : Number(r.amount_minor),
    route: spec.route,
    summary: spec.summary,
  };
}

function tableExists(db: Db, table: string): boolean {
  return db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
}

function columnExists(db: Db, table: string, column: string): boolean {
  return db.count("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?", [table, column]) > 0;
}
