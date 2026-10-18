import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { nowStamp } from "@/core/dates";
import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { renderReceiptPdf, type ReceiptData } from "@/core/pdf/receipt";
import { renderStoreReceiptPdf, type StoreReceiptData } from "@/core/pdf/store-receipt";
import { renderSubscriptionContractPdf, type SubscriptionContractData } from "@/core/pdf/subscription-contract";
import { renderPayslipPdf, type PayslipData } from "@/core/pdf/payslip";
import { assignDocNo } from "./document-numbers.service";
import { recordAudit } from "./audit.service";
import { getPaymentById } from "./payments.service";
import { getMemberRowById } from "./members.service";
import { getSale } from "./store.service";
import { getSubscriptionRow } from "./subscriptions.service";
import { getPlanRow } from "./plans.service";
import { assertDepartmentAccess } from "./department";
import { readSetting, SETTING_KEYS } from "./settings.service";
import { whatsappTransport, type MessageTransport } from "./card-delivery.service";
import { formatMinor } from "@/core/money";
import { buildPaymentReceiptMessage, buildWhatsAppDirectUrl } from "@/core/whatsapp";

export type PdfDocType = "payment_receipt" | "store_sale_receipt" | "subscription_contract";

/**
 * Heading shown under the gym name for each document type. Adding a new PDF
 * type means adding one entry here — the title is derived automatically, no
 * template change needed.
 */
export const DOC_TYPE_TITLES: Record<PdfDocType, string> = {
  // A recorded payment is money the member handed over.
  payment_receipt: "فاتورة دفع",
  store_sale_receipt: "فاتورة مبيعات متجر",
  subscription_contract: "عقد اشتراك عضوية",
};

export type PdfDeliveryStatus = "sent" | "failed" | "not_configured" | "no_phone";

export interface PdfDeliveryRow extends Row {
  id: string;
  doc_type: string;
  ref_table: string;
  ref_id: string;
  member_id: string | null;
  member_name: string | null;
  phone: string | null;
  channel: string;
  status: string;
  error: string | null;
  file_name: string | null;
  file_size: number | null;
  file_hash: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PublicPdfDelivery {
  id: string;
  docType: string;
  refId: string;
  memberName: string | null;
  phone: string | null;
  channel: string;
  status: string;
  error: string | null;
  fileName: string | null;
  fileSize: number | null;
  sentAt: string | null;
  createdAt: string;
}

export interface GeneratedPdf {
  fileName: string;
  base64: string;
  size: number;
  hash: string;
}

const STATUS_SELECT = "SELECT * FROM pdf_deliveries";

function toDelivery(row: PdfDeliveryRow): PublicPdfDelivery {
  return {
    id: row.id,
    docType: row.doc_type,
    refId: row.ref_id,
    memberName: row.member_name,
    phone: row.phone,
    channel: row.channel,
    status: row.status,
    error: row.error,
    fileName: row.file_name,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Heading for a document. The Settings value wins so the owner can word it as
 * they like; otherwise it falls back to the per-type default. A blank setting is
 * treated as "not set" rather than an empty heading.
 */
function docTitle(db: Db, docType: PdfDocType): string {
  const override = readSetting(db, SETTING_KEYS.receiptTitle)?.trim();
  if (override && override !== "") return override;
  return DOC_TYPE_TITLES[docType] ?? "إيصال";
}

interface ReceiptTemplateSettings {
  gymName: string;
  gymPhone: string | null;
  gymAddress: string | null;
  receiptTitle: string | null;
  showLogo: boolean;
  logoBuffer: Buffer | null;
  logoWidth: number;
  showTax: boolean;
  taxPercent: number;
  showQr: boolean;
  footerText: string | null;
  terms: string[];
}

let cachedBrandLogo: Buffer | null | undefined;
function getDefaultBrandLogo(): Buffer | null {
  if (cachedBrandLogo !== undefined) return cachedBrandLogo;
  const rel = join("public", "branding", "kotb-logo-light.png");
  const exeDir = process.env.GYMGATE_EXE_DIR ?? process.env.GYMSYSTEM_EXE_DIR ?? "";
  const candidates = [
    join(process.cwd(), rel),
    exeDir ? join(exeDir, rel) : "",
    typeof __dirname !== "undefined" ? join(__dirname, "..", "..", "..", rel) : "",
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        cachedBrandLogo = readFileSync(p);
        return cachedBrandLogo;
      } catch {
        // ignore
      }
    }
  }
  cachedBrandLogo = null;
  return null;
}

function getReceiptSettings(db: Db): ReceiptTemplateSettings {
  const gName = readSetting(db, SETTING_KEYS.gymName) ?? "الجيم";
  const gPhone = readSetting(db, SETTING_KEYS.gymPhone)?.trim() || null;
  const gAddress = readSetting(db, SETTING_KEYS.gymAddress)?.trim() || null;
  const rTitle = readSetting(db, SETTING_KEYS.receiptTitle)?.trim() || null;
  const showLogo = (readSetting(db, SETTING_KEYS.receiptShowLogo) ?? "1") === "1";
  const rawLogo = readSetting(db, SETTING_KEYS.receiptLogoData) || "";
  const logoWidth = Math.max(40, Math.min(240, parseInt(readSetting(db, SETTING_KEYS.receiptLogoWidth) ?? "100", 10) || 100));
  let logoBuffer: Buffer | null = null;
  if (showLogo && rawLogo) {
    const match = rawLogo.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
    if (match && match[1]) {
      try {
        logoBuffer = Buffer.from(match[1], "base64");
      } catch {
        logoBuffer = null;
      }
    }
  }
  if (showLogo && !logoBuffer) {
    logoBuffer = getDefaultBrandLogo();
  }
  const showTax = readSetting(db, SETTING_KEYS.receiptShowTax) === "1";
  const taxPercent = Math.max(0, Math.min(100, parseInt(readSetting(db, SETTING_KEYS.receiptTaxPercent) ?? "0", 10) || 0));
  const showQr = (readSetting(db, SETTING_KEYS.receiptShowQr) ?? "1") === "1";
  const footerText = readSetting(db, SETTING_KEYS.receiptFooterText)?.trim() || null;
  const rawTerms = readSetting(db, SETTING_KEYS.receiptTerms)?.trim() || "";
  const terms = rawTerms ? rawTerms.split("\n").map((l) => l.trim()).filter(Boolean) : [];

  return {
    gymName: gName,
    gymPhone: gPhone,
    gymAddress: gAddress,
    receiptTitle: rTitle,
    showLogo,
    logoBuffer,
    logoWidth,
    showTax,
    taxPercent,
    showQr,
    footerText,
    terms,
  };
}

function branchName(db: Db): string | null {
  const row = db.first<{ branch_name: string | null }>(
    "SELECT branch_name FROM branch_info LIMIT 1",
  );
  return row?.branch_name ?? null;
}

function receiptFileName(receiptNo: string): string {
  return `receipt-${receiptNo}.pdf`;
}

/**
 * Human-facing receipt number (e.g. B1-RCP-2026-000123).
 * Delegates to the shared document-number allocator so the branch prefix and the
 * counter stay consistent with every other operation type.
 */
function receiptNumber(db: Db, paymentId: string, paidAt: string, actorOrUserId?: ServiceActor | string): string {
  return assignDocNo(db, "payment", paymentId, paidAt, actorOrUserId);
}

async function buildReceipt(db: Db, actor: ServiceActor, paymentId: string): Promise<{
  data: ReceiptData;
  fileName: string;
  bytes: Buffer;
}> {
  const payment = getPaymentById(db, actor, paymentId);
  const member = getMemberRowById(db, payment.memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, member.department);

  const receiptNo = receiptNumber(db, payment.id, payment.paidAt, actor);
  const settings = getReceiptSettings(db);
  const data: ReceiptData = {
    gymName: settings.gymName,
    gymPhone: settings.gymPhone,
    gymAddress: settings.gymAddress,
    title: settings.receiptTitle ?? docTitle(db, "payment_receipt"),
    logoBuffer: settings.logoBuffer,
    logoWidth: settings.logoWidth,
    showQr: settings.showQr,
    showTax: settings.showTax,
    taxPercent: settings.taxPercent,
    taxAmountMinor: settings.showTax && settings.taxPercent > 0
      ? Math.round((payment.netAmountMinor * settings.taxPercent) / 100)
      : 0,
    footerText: settings.footerText,
    terms: settings.terms,
    receiptNo,
    issuedAt: formatStamp(payment.paidAt),
    memberCode: payment.memberCode,
    memberName: payment.memberName,
    memberPhone: member.phone ?? null,
    planName: payment.planName,
    baseAmountMinor: payment.baseAmountMinor,
    discountAmountMinor: payment.discountAmountMinor,
    netAmountMinor: payment.netAmountMinor,
    paidAmountMinor: payment.paidAmountMinor,
    remainingAmountMinor: payment.remainingAmountMinor,
    refundedAmountMinor: payment.refundedAmountMinor,
    methodLabel: payment.methodLabel,
    status: payment.status,
    referenceNo: payment.referenceNo,
    notes: payment.notes,
    createdByName: payment.createdByName,
    branchName: branchName(db),
  };
  const bytes = await renderReceiptPdf(data);
  return { data, fileName: receiptFileName(receiptNo), bytes };
}

function formatStamp(stamp: string): string {
  return stamp.replace("T", " ").slice(0, 16);
}

/**
 * Generate the PDF bytes for a document. Read-only: no audit row and no
 * delivery record, so the UI can preview/download without polluting history.
 */
export async function generatePaymentReceipt(
  db: Db,
  actor: ServiceActor,
  paymentId: string,
): Promise<GeneratedPdf> {
  requirePermission(actor, "pdf.receipt");
  const { fileName, bytes } = await buildReceipt(db, actor, paymentId);
  return {
    fileName,
    base64: bytes.toString("base64"),
    size: bytes.length,
    hash: sha256(bytes),
  };
}

function resolveTransport(db: Db): { transport: MessageTransport | null; provider: string } {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  if (proc.process?.env?.GYM_CRM_MOCK === "1") {
    return {
      transport: async () => ({ ok: true }),
      provider: "mock",
    };
  }
  const enabled = readSetting(db, SETTING_KEYS.whatsappEnabled) === "1";
  const apiUrl = (readSetting(db, SETTING_KEYS.whatsappApiUrl) || "").trim() || "http://127.0.0.1:8891";
  if (enabled && apiUrl !== "") {
    return { transport: whatsappTransport(apiUrl), provider: "whatsapp" };
  }
  return { transport: null, provider: "none" };
}

/**
 * Generate the receipt and send it to the member over the configured channel.
 * The delivery is always recorded in `pdf_deliveries` (owner chose a real
 * archive over audit-log-only), including failures, so the owner can see what
 * was sent, when, and whether it landed.
 */
export async function sendPaymentReceipt(
  db: Db,
  actor: ServiceActor,
  paymentId: string,
): Promise<{ delivery: PublicPdfDelivery; directUrl?: string | null }> {
  requirePermission(actor, "pdf.receipt");

  const { data, fileName, bytes } = await buildReceipt(db, actor, paymentId);
  const hash = sha256(bytes);
  const { transport, provider } = resolveTransport(db);
  const phone = data.memberPhone?.trim() ?? "";

  const directText = buildPaymentReceiptMessage({
    gymName: data.gymName,
    memberName: data.memberName,
    memberCode: data.memberCode,
    receiptNo: data.receiptNo,
    planName: data.planName ?? undefined,
    amountPaid: formatMinor(data.paidAmountMinor),
    amountRemaining: data.remainingAmountMinor > 0 ? formatMinor(data.remainingAmountMinor) : undefined,
    date: data.issuedAt?.slice(0, 10),
    notes: data.notes || undefined,
  });
  const directUrl = phone ? buildWhatsAppDirectUrl(phone, directText) : null;

  const insert = (status: PdfDeliveryStatus, error: string | null, sentAt: string | null) => {
    const id = `pdfd_${randomUUID()}`;
    db.run(
      "INSERT INTO pdf_deliveries (id, doc_type, ref_table, ref_id, member_id, member_name, phone, channel, status, error, file_name, file_size, file_hash, sent_at, created_by, created_at)\n" +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        "payment_receipt",
        "payments",
        paymentId,
        data.memberCode ? memberIdOf(db, paymentId) : null,
        data.memberName,
        phone || null,
        provider,
        status,
        error,
        fileName,
        bytes.length,
        hash,
        sentAt,
        actor.userId,
        nowStamp(),
      ],
    );
    const row = db.first<PdfDeliveryRow>(`${STATUS_SELECT} WHERE id = ?`, [id]);
    return row ? toDelivery(row) : null;
  };

  // Check the member data before the transport: a missing phone is actionable
  // on its own, and reporting it as "WhatsApp is off" would send the owner
  // chasing the wrong setting.
  if (phone === "") return { delivery: insert("no_phone", null, null)!, directUrl: null };
  if (!transport) return { delivery: insert("not_configured", null, null)!, directUrl };

  const caption = `إيصال قبض - ${data.gymName} - ${data.receiptNo}`;
  const result = await transport(phone, caption, {
    base64: bytes.toString("base64"),
    mime: "application/pdf",
    caption,
  });

  if (result.ok) {
    const delivery = insert("sent", null, nowStamp())!;
    recordAudit(db, actor, "PDF_RECEIPT_SENT", "payment", paymentId, {
      memberName: data.memberName,
      phone,
      provider,
      fileName,
      size: bytes.length,
    });
    return { delivery, directUrl };
  }

  const error = result.error ?? "unknown error";
  const delivery = insert("failed", error, null)!;
  recordAudit(db, actor, "PDF_RECEIPT_SEND_FAILED", "payment", paymentId, {
    memberName: data.memberName,
    phone,
    provider,
    error,
  });
  return { delivery, directUrl };
}

function memberIdOf(db: Db, paymentId: string): string | null {
  const row = db.first<{ member_id: string }>("SELECT member_id FROM payments WHERE id = ?", [
    paymentId,
  ]);
  return row?.member_id ?? null;
}

export function listPdfDeliveries(
  db: Db,
  actor: ServiceActor,
  query: { memberId?: string; status?: string; limit?: number } = {},
): PublicPdfDelivery[] {
  requirePermission(actor, "pdf.receipt");
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
    .all<PdfDeliveryRow>(
      `${STATUS_SELECT} ${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit],
    )
    .map(toDelivery);
}

export function assertReceiptSendable(paymentId: unknown): string {
  if (typeof paymentId !== "string" || paymentId.trim() === "") {
    throw errValidation("errors.pdf.paymentIdRequired");
  }
  return paymentId.trim();
}

function memberIdOfSale(db: Db, saleId: string): string | null {
  const row = db.first<{ member_id: string | null }>("SELECT member_id FROM store_sales WHERE id = ?", [saleId]);
  return row?.member_id ?? null;
}

function memberIdOfSubscription(db: Db, subscriptionId: string): string | null {
  const row = db.first<{ member_id: string | null }>("SELECT member_id FROM member_subscriptions WHERE id = ?", [subscriptionId]);
  return row?.member_id ?? null;
}

async function buildStoreReceipt(db: Db, actor: ServiceActor, saleId: string): Promise<{
  data: StoreReceiptData;
  fileName: string;
  bytes: Buffer;
}> {
  const sale = getSale(db, actor, saleId);
  let customerPhone: string | null = null;
  if (sale.memberId) {
    const member = getMemberRowById(db, sale.memberId);
    customerPhone = member?.phone ?? null;
  }
  const cashierRow = db.first<{ full_name: string }>(
    "SELECT full_name FROM users WHERE id = (SELECT seller_id FROM store_sales WHERE id = ?)",
    [saleId],
  );
  const isCredit = sale.isCredit;
  let paymentStatusText = isCredit ? "غير مسدد (بيع بالآجل)" : "مسدد بالكامل";
  let isPaid = !isCredit;
  let debtRemainingMinor: number | undefined;

  if (isCredit) {
    const debt = db.first<{ status: string; original_minor: number; paid_minor: number }>(
      "SELECT status, original_minor, paid_minor FROM store_debts WHERE sale_id = ?",
      [saleId],
    );
    if (debt) {
      const rem = Number(debt.original_minor) - Number(debt.paid_minor);
      debtRemainingMinor = rem;
      if (debt.status === "settled" || rem <= 0) {
        isPaid = true;
        paymentStatusText = "مسدد بالكامل (سداد آجل مديونية)";
      } else {
        isPaid = false;
        paymentStatusText = `غير مسدد (آجل متبقي: ${(rem / 100).toFixed(2)} ج.م)`;
      }
    }
  }

  const settings = getReceiptSettings(db);
  const data: StoreReceiptData = {
    gymName: settings.gymName,
    gymPhone: settings.gymPhone,
    gymAddress: settings.gymAddress,
    saleNo: sale.saleNo,
    soldAt: formatStamp(sale.soldAt),
    branchName: branchName(db),
    customerName: sale.memberName ?? "عميل نقدي",
    customerPhone,
    cashierName: cashierRow?.full_name ?? "الموظف",
    items: sale.items.map((it) => ({
      productName: it.productName,
      qty: it.qty,
      unitPriceMinor: it.unitPriceMinor,
      lineTotalMinor: it.lineTotalMinor,
    })),
    itemsTotalMinor: sale.itemsTotalMinor,
    discountMinor: sale.discountMinor,
    totalMinor: sale.totalMinor,
    methodLabel:
      db.first<{ label_ar: string }>("SELECT label_ar FROM payment_methods WHERE code = ?", [sale.methodCode])?.label_ar ??
      (sale.methodCode === "cash" ? "نقدي" : sale.methodCode === "bank_card" ? "بطاقة بنكية" : sale.methodCode === "instapay" ? "انستاباي" : sale.methodCode === "wallet" ? "محفظة إلكترونية" : sale.methodCode),
    isCredit,
    isPaid,
    paymentStatusText,
    debtRemainingMinor,
    status: sale.status,
    title: settings.receiptTitle ?? docTitle(db, "store_sale_receipt"),
    logoBuffer: settings.logoBuffer,
    logoWidth: settings.logoWidth,
    showQr: settings.showQr,
    footerText: settings.footerText,
  };
  const bytes = await renderStoreReceiptPdf(data);
  return { data, fileName: `sale-${sale.saleNo}.pdf`, bytes };
}

export async function generateStoreSaleReceipt(
  db: Db,
  actor: ServiceActor,
  saleId: string,
): Promise<GeneratedPdf> {
  requirePermission(actor, "store.view");
  const { fileName, bytes } = await buildStoreReceipt(db, actor, saleId);
  return {
    fileName,
    base64: bytes.toString("base64"),
    size: bytes.length,
    hash: sha256(bytes),
  };
}

export async function sendStoreSaleReceipt(
  db: Db,
  actor: ServiceActor,
  saleId: string,
): Promise<{ delivery: PublicPdfDelivery; directUrl?: string | null }> {
  requirePermission(actor, "store.view");
  const { data, fileName, bytes } = await buildStoreReceipt(db, actor, saleId);
  const hash = sha256(bytes);
  const { transport, provider } = resolveTransport(db);
  const phone = data.customerPhone?.trim() ?? "";

  const itemsSummary = data.items.map((it) => `• ${it.productName} (×${it.qty})`).join("\n");
  const paidMinor = data.isCredit ? Math.max(0, data.totalMinor - (data.debtRemainingMinor ?? 0)) : data.totalMinor;
  const directText = [
    `🧾 *فاتورة مبيعات متجر — ${data.gymName}*`,
    `━━━━━━━━━━━━━━━━`,
    `👤 *العميل:* ${data.customerName}`,
    `🔢 *رقم الفاتورة:* ${data.saleNo}`,
    `📦 *الأصناف:*`,
    itemsSummary,
    `━━━━━━━━━━━━━━━━`,
    `💵 *الإجمالي:* ${formatMinor(data.totalMinor)} ج.م`,
    data.discountMinor > 0 ? `🎁 *الخصم:* ${formatMinor(data.discountMinor)} ج.م` : null,
    `💰 *المدفوع:* ${formatMinor(paidMinor)} ج.م`,
    data.debtRemainingMinor && data.debtRemainingMinor > 0 ? `⚠️ *المتبقي بالآجل:* ${formatMinor(data.debtRemainingMinor)} ج.م` : null,
    `📅 *التاريخ:* ${data.soldAt.slice(0, 10)}`,
    `━━━━━━━━━━━━━━━━`,
    `شكراً لتسوقكم معنا! ✨`,
  ].filter(Boolean).join("\n");
  const directUrl = phone ? buildWhatsAppDirectUrl(phone, directText) : null;

  const insert = (status: PdfDeliveryStatus, error: string | null, sentAt: string | null) => {
    const id = `pdfd_${randomUUID()}`;
    db.run(
      "INSERT INTO pdf_deliveries (id, doc_type, ref_table, ref_id, member_id, member_name, phone, channel, status, error, file_name, file_size, file_hash, sent_at, created_by, created_at)\n" +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        "store_sale_receipt",
        "store_sales",
        saleId,
        memberIdOfSale(db, saleId),
        data.customerName,
        phone || null,
        provider,
        status,
        error,
        fileName,
        bytes.length,
        hash,
        sentAt,
        actor.userId,
        nowStamp(),
      ],
    );
    const row = db.first<PdfDeliveryRow>(`${STATUS_SELECT} WHERE id = ?`, [id]);
    return row ? toDelivery(row) : null;
  };

  if (phone === "") return { delivery: insert("no_phone", null, null)!, directUrl: null };
  if (!transport) return { delivery: insert("not_configured", null, null)!, directUrl };

  const caption = `فاتورة مبيعات - ${data.gymName} - ${data.saleNo}`;
  const result = await transport(phone, caption, {
    base64: bytes.toString("base64"),
    mime: "application/pdf",
    caption,
  });

  if (result.ok) {
    const delivery = insert("sent", null, nowStamp())!;
    recordAudit(db, actor, "PDF_RECEIPT_SENT", "store_sale", saleId, {
      customerName: data.customerName,
      phone,
      provider,
      fileName,
      size: bytes.length,
    });
    return { delivery, directUrl };
  }

  const error = result.error ?? "unknown error";
  const delivery = insert("failed", error, null)!;
  recordAudit(db, actor, "PDF_RECEIPT_SEND_FAILED", "store_sale", saleId, {
    customerName: data.customerName,
    phone,
    provider,
    error,
  });
  return { delivery, directUrl };
}

async function buildSubscriptionContract(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): Promise<{
  data: SubscriptionContractData;
  fileName: string;
  bytes: Buffer;
}> {
  const sub = getSubscriptionRow(db, subscriptionId);
  if (!sub) throw errNotFound("errors.subscriptionNotFound");
  const member = getMemberRowById(db, sub.member_id);
  if (!member) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, member.department);

  const plan = getPlanRow(db, sub.plan_id);
  if (!plan) throw errNotFound("errors.planNotFound");
  const contractNo = `CTR-${sub.start_date.replace(/-/g, "").slice(0, 4)}-${sub.id.slice(0, 6).toUpperCase()}`;

  const payments = db.all<{ paid_amount_minor: number; discount_amount_minor: number }>(
    "SELECT paid_amount_minor, discount_amount_minor FROM payments WHERE subscription_id = ? AND status != 'voided'",
    [subscriptionId],
  );
  const paidMinor = payments.reduce((sum, p) => sum + Number(p.paid_amount_minor || 0), 0);
  const discountMinor = payments.reduce((sum, p) => sum + Number(p.discount_amount_minor || 0), 0);
  const priceMinor = Number(plan.price_minor);
  const netMinor = Math.max(0, priceMinor - discountMinor);
  const remainingMinor = Math.max(0, netMinor - paidMinor);

  const kindLabels: Record<string, string> = {
    time: "مدة زمنية",
    sessions: "عدد حصص",
    open: "مفتوح",
  };

  const settings = getReceiptSettings(db);
  const data: SubscriptionContractData = {
    gymName: settings.gymName,
    gymPhone: settings.gymPhone,
    gymAddress: settings.gymAddress,
    contractNo,
    issuedAt: formatStamp(sub.created_at),
    branchName: branchName(db),
    memberName: member.full_name,
    memberCode: member.member_code,
    memberPhone: member.phone ?? null,
    planName: plan.name,
    kindLabel: kindLabels[plan.kind ?? "time"] ?? "عضوية عامة",
    startDate: sub.start_date,
    endDate: sub.end_date,
    sessionsLimit: plan.sessions_limit != null ? Number(plan.sessions_limit) : null,
    freezeDaysLimit: Number(plan.freeze_days_limit ?? 0),
    freezeMaxCount: Number(plan.freeze_max_count ?? 0),
    priceMinor,
    discountMinor,
    netMinor,
    paidMinor,
    remainingMinor,
    terms: settings.terms,
    title: settings.receiptTitle ?? docTitle(db, "subscription_contract"),
    logoBuffer: settings.logoBuffer,
    showQr: settings.showQr,
    footerText: settings.footerText,
  };

  const bytes = await renderSubscriptionContractPdf(data);
  return { data, fileName: `contract-${member.member_code}.pdf`, bytes };
}

export async function generateSubscriptionContract(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): Promise<GeneratedPdf> {
  requirePermission(actor, "subscriptions.view");
  const { fileName, bytes } = await buildSubscriptionContract(db, actor, subscriptionId);
  return {
    fileName,
    base64: bytes.toString("base64"),
    size: bytes.length,
    hash: sha256(bytes),
  };
}

export async function sendSubscriptionContract(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): Promise<{ delivery: PublicPdfDelivery; directUrl?: string | null }> {
  requirePermission(actor, "subscriptions.view");
  const { data, fileName, bytes } = await buildSubscriptionContract(db, actor, subscriptionId);
  const hash = sha256(bytes);
  const { transport, provider } = resolveTransport(db);
  const phone = data.memberPhone?.trim() ?? "";

  const directText = [
    `📋 *عقد اشتراك عضوية — ${data.gymName}*`,
    `━━━━━━━━━━━━━━━━`,
    `👤 *العضو:* ${data.memberName}`,
    `🆔 *كود العضوية:* ${data.memberCode}`,
    `🏋️ *الباقة:* ${data.planName}`,
    `📅 *الفترة:* من ${data.startDate} إلى ${data.endDate}`,
    `💵 *قيمة الاشتراك:* ${formatMinor(data.netMinor)} ج.م`,
    data.remainingMinor > 0 ? `⚠️ *المتبقي:* ${formatMinor(data.remainingMinor)} ج.م` : null,
    `━━━━━━━━━━━━━━━━`,
    `نتمنى لكم تجربة رياضية مميزة ومليئة بالنشاط! 💪✨`,
  ].filter(Boolean).join("\n");
  const directUrl = phone ? buildWhatsAppDirectUrl(phone, directText) : null;

  const insert = (status: PdfDeliveryStatus, error: string | null, sentAt: string | null) => {
    const id = `pdfd_${randomUUID()}`;
    db.run(
      "INSERT INTO pdf_deliveries (id, doc_type, ref_table, ref_id, member_id, member_name, phone, channel, status, error, file_name, file_size, file_hash, sent_at, created_by, created_at)\n" +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        "subscription_contract",
        "member_subscriptions",
        subscriptionId,
        memberIdOfSubscription(db, subscriptionId),
        data.memberName,
        phone || null,
        provider,
        status,
        error,
        fileName,
        bytes.length,
        hash,
        sentAt,
        actor.userId,
        nowStamp(),
      ],
    );
    const row = db.first<PdfDeliveryRow>(`${STATUS_SELECT} WHERE id = ?`, [id]);
    return row ? toDelivery(row) : null;
  };

  if (phone === "") return { delivery: insert("no_phone", null, null)!, directUrl: null };
  if (!transport) return { delivery: insert("not_configured", null, null)!, directUrl };

  const caption = `عقد اشتراك العضوية - ${data.gymName} - ${data.memberName}`;
  const result = await transport(phone, caption, {
    base64: bytes.toString("base64"),
    mime: "application/pdf",
    caption,
  });

  if (result.ok) {
    const delivery = insert("sent", null, nowStamp())!;
    recordAudit(db, actor, "PDF_RECEIPT_SENT", "subscription", subscriptionId, {
      memberName: data.memberName,
      phone,
      provider,
      fileName,
      size: bytes.length,
    });
    return { delivery, directUrl };
  }

  const error = result.error ?? "unknown error";
  const delivery = insert("failed", error, null)!;
  recordAudit(db, actor, "PDF_RECEIPT_SEND_FAILED", "subscription", subscriptionId, {
    memberName: data.memberName,
    phone,
    provider,
    error,
  });
  return { delivery, directUrl };
}

export async function generatePayslipPdf(
  db: Db,
  actor: ServiceActor,
  salaryId: string,
): Promise<{ base64: string; fileName: string; slipNo: string }> {
  requirePermission(actor, "salaries.view");

  const row = db.first<Row>(
    `SELECT s.*, e.full_name AS employee_name, e.phone AS employee_phone, e.role_title, e.department, e.salary_type
     FROM salaries s JOIN employees e ON e.id = s.employee_id
     WHERE s.id = ?`,
    [salaryId],
  );
  if (!row) throw errNotFound("errors.salaryNotFound");

  const employeeId = String(row.employee_id);
  const periodMonth = String(row.period_month);

  // Slices & details
  const gymName = readSetting(db, SETTING_KEYS.gymName) ?? "نظام إدارة الجيم";
  const branchName = readSetting(db, "branch.name") ?? null;
  const slipNo = `PS-${periodMonth.replace("-", "")}-${salaryId.slice(0, 8).toUpperCase()}`;

  // Advances for this month
  const advancesMinor = Number(
    db.scalar(
      "SELECT COALESCE(SUM(repaid_minor), 0) FROM employee_advances WHERE employee_id = ? AND deduction_month = ? AND status = 'settled'",
      [employeeId, periodMonth],
    ) ||
    db.scalar(
      "SELECT COALESCE(SUM(amount_minor), 0) FROM employee_advances WHERE employee_id = ? AND deduction_month = ?",
      [employeeId, periodMonth],
    ) || 0,
  );

  const baseAmountMinor = Number(row.base_amount_minor || 0);
  const bonusMinor = Number(row.bonus_minor || 0);
  const totalDeduction = Number(row.deduction_minor || 0);
  const netAmountMinor = Number(row.net_amount_minor || 0);

  const regularDeductions = Math.max(0, totalDeduction - advancesMinor);

  const payslipData: PayslipData = {
    gymName,
    slipNo,
    issuedAt: String(row.created_at || nowStamp()),
    periodMonth,
    employeeName: String(row.employee_name),
    roleTitle: row.role_title ? String(row.role_title) : null,
    department: row.department ? String(row.department) : null,
    phone: row.employee_phone ? String(row.employee_phone) : null,
    salaryType: String(row.salary_type || "monthly"),
    baseAmountMinor,
    incentivesMinor: bonusMinor,
    deductionsMinor: regularDeductions,
    advancesMinor,
    unpaidLeaveImpactMinor: 0,
    netAmountMinor,
    status: String(row.status) as "pending" | "paid",
    paidAt: row.paid_at ? String(row.paid_at) : null,
    paymentMethod: String(row.method_code || "cash"),
    notes: row.notes ? String(row.notes) : null,
    branchName,
  };

  const bytes = await renderPayslipPdf(payslipData);
  const fileName = `payslip-${slipNo}.pdf`;

  return {
    base64: bytes.toString("base64"),
    fileName,
    slipNo,
  };
}

export interface ReceiptPreviewInput {
  gymName?: string;
  gymPhone?: string;
  gymAddress?: string;
  receiptTitle?: string;
  showLogo?: boolean;
  logoData?: string;
  logoWidth?: number;
  showTax?: boolean;
  taxPercent?: number;
  showQr?: boolean;
  footerText?: string;
  terms?: string;
  docKind?: "subscription" | "store";
}

/**
 * Generates an exact live sample PDF using the official backend PDF engine,
 * taking the current on-screen unsaved/saved settings into account.
 */
export async function previewReceiptTemplate(
  db: Db,
  actor: ServiceActor,
  input: ReceiptPreviewInput = {},
): Promise<GeneratedPdf> {
  requirePermission(actor, "settings.view");

  const gymName = input.gymName?.trim() || readSetting(db, SETTING_KEYS.gymName) || "صالة اللياقة الرياضية";
  const gymPhone = input.gymPhone !== undefined ? (input.gymPhone.trim() || null) : (readSetting(db, SETTING_KEYS.gymPhone)?.trim() || null);
  const gymAddress = input.gymAddress !== undefined ? (input.gymAddress.trim() || null) : (readSetting(db, SETTING_KEYS.gymAddress)?.trim() || null);
  const title = input.receiptTitle?.trim() || readSetting(db, SETTING_KEYS.receiptTitle)?.trim() || "إيصال سداد واشتراك";

  const showLogo = input.showLogo !== undefined ? input.showLogo : ((readSetting(db, SETTING_KEYS.receiptShowLogo) ?? "1") === "1");
  const rawLogo = input.logoData !== undefined ? input.logoData : (readSetting(db, SETTING_KEYS.receiptLogoData) || "");
  const logoWidth = Math.max(40, Math.min(240, input.logoWidth ?? (parseInt(readSetting(db, SETTING_KEYS.receiptLogoWidth) ?? "100", 10) || 100)));

  let logoBuffer: Buffer | null = null;
  if (showLogo && rawLogo) {
    const match = rawLogo.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
    if (match && match[1]) {
      try {
        logoBuffer = Buffer.from(match[1], "base64");
      } catch {
        logoBuffer = null;
      }
    }
  }
  if (showLogo && !logoBuffer) {
    logoBuffer = getDefaultBrandLogo();
  }

  const showTax = input.showTax !== undefined ? input.showTax : (readSetting(db, SETTING_KEYS.receiptShowTax) === "1");
  const taxPercent = Math.max(0, Math.min(100, input.taxPercent ?? (parseInt(readSetting(db, SETTING_KEYS.receiptTaxPercent) ?? "0", 10) || 0)));
  const showQr = input.showQr !== undefined ? input.showQr : ((readSetting(db, SETTING_KEYS.receiptShowQr) ?? "1") === "1");

  const footerText = input.footerText !== undefined ? (input.footerText.trim() || null) : (readSetting(db, SETTING_KEYS.receiptFooterText)?.trim() || null);
  const rawTerms = input.terms !== undefined ? input.terms : (readSetting(db, SETTING_KEYS.receiptTerms)?.trim() || "");
  const terms = rawTerms ? rawTerms.split("\n").map((l) => l.trim()).filter(Boolean) : [];

  const bName = branchName(db) ?? "الفرع الرئيسي (B1)";
  const now = formatStamp(nowStamp());

  if (input.docKind === "store") {
    const sampleItems = [
      { productName: "مشروب بروتين جولد ستاندرد 500 مل", qty: 2, unitPriceMinor: 6500, lineTotalMinor: 13000 },
      { productName: "لوح شوكولاتة كيتو بروتين 60 جم", qty: 3, unitPriceMinor: 4000, lineTotalMinor: 12000 },
    ];
    const itemsTotalMinor = 25000;
    const discountMinor = 2000;
    const totalMinor = itemsTotalMinor - discountMinor;

    const storeData: StoreReceiptData = {
      gymName,
      gymPhone,
      gymAddress,
      saleNo: "B1-U1-SLE-2026-000088",
      soldAt: now,
      branchName: bName,
      customerName: "كابتن / محمد أحمد محمود",
      customerPhone: "01098765432",
      cashierName: actor.username || "أحمد محمود (كاشير)",
      items: sampleItems,
      itemsTotalMinor,
      discountMinor,
      totalMinor,
      methodLabel: "نقداً (خزينة الجيم)",
      isCredit: false,
      isPaid: true,
      paymentStatusText: "مسدد بالكامل",
      status: "completed",
      title,
      logoBuffer,
      logoWidth,
      showQr,
      footerText,
    };

    const bytes = await renderStoreReceiptPdf(storeData);
    return {
      fileName: `preview-store-receipt.pdf`,
      base64: bytes.toString("base64"),
      size: bytes.length,
      hash: sha256(bytes),
    };
  }

  // Subscription receipt preview
  const baseAmountMinor = 75000;
  const discountAmountMinor = 5000;
  const netAmountMinor = baseAmountMinor - discountAmountMinor;
  const taxAmountMinor = showTax && taxPercent > 0 ? Math.round((netAmountMinor * taxPercent) / 100) : 0;
  const paidAmountMinor = netAmountMinor + taxAmountMinor;

  const data: ReceiptData = {
    gymName,
    gymPhone,
    gymAddress,
    title,
    logoBuffer,
    logoWidth,
    showQr,
    showTax,
    taxPercent,
    taxAmountMinor,
    footerText,
    terms,
    receiptNo: "B1-U1-RCP-2026-000124",
    issuedAt: now,
    memberCode: "B1-MEM-000124",
    memberName: "كابتن / محمد أحمد محمود",
    memberPhone: "01098765432",
    planName: "اشتراك لياقة وبناء أجسام شامل",
    baseAmountMinor,
    discountAmountMinor,
    netAmountMinor,
    paidAmountMinor,
    remainingAmountMinor: 0,
    refundedAmountMinor: 0,
    methodLabel: "نقداً (الخزينة الرئيسية)",
    status: "paid",
    referenceNo: null,
    notes: "معاينة تجريبية لشكل وتنسيق الفاتورة الرسمية",
    createdByName: actor.username || "أحمد محمود (كاشير)",
    branchName: bName,
  };

  const bytes = await renderReceiptPdf(data);
  return {
    fileName: `preview-receipt.pdf`,
    base64: bytes.toString("base64"),
    size: bytes.length,
    hash: sha256(bytes),
  };
}
