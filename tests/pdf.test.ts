import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import {
  DOC_TYPE_TITLES,
  generatePaymentReceipt,
  generateStoreSaleReceipt,
  generateSubscriptionContract,
  listPdfDeliveries,
  previewReceiptTemplate,
  sendPaymentReceipt,
  sendStoreSaleReceipt,
  sendSubscriptionContract,
} from "@/core/services/pdf.service";
import { createProduct, createSale } from "@/core/services/store.service";
import { renderReceiptPdf } from "@/core/pdf/receipt";
import { drawDeveloperCredit } from "@/core/pdf/credit";
import { drawText, isRtlText, measureText, splitBiDiRuns, toAsciiDigits } from "@/core/pdf/arabic";
import { errForbidden } from "@/core/errors";
import { writeSettingInternal as writeSetting, SETTING_KEYS } from "@/core/services/settings.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;

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
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
});

async function paymentWithPhone(phone: string | null) {
  const member = await createMember(db, owner, { fullName: "أحمد محمد", phone: phone ?? undefined });
  const plan = await createPlan(db, owner, { name: "باقة ذهبي", durationDays: 30, price: 1500 });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  const payment = await recordPayment(db, owner, {
    memberId: member.id,
    subscriptionId: sub.id,
    baseAmountMinor: 150000,
    paidAmountMinor: 135000,
    methodCode: "cash",
  });
  return { member, payment };
}

/** Shared receipt fixture used by the rendering tests. */
const SAMPLE = {
  gymName: "جيم النوردة",
  receiptNo: "RCP-1",
  issuedAt: "2026-09-28 10:00",
  memberCode: "B1-MEM-1",
  memberName: "أحمد محمد",
  memberPhone: "01000000000",
  planName: "باقة ذهبي",
  baseAmountMinor: 150000,
  discountAmountMinor: 15000,
  netAmountMinor: 135000,
  paidAmountMinor: 135000,
  remainingAmountMinor: 0,
  refundedAmountMinor: 0,
  methodLabel: "نقد",
  status: "paid",
  referenceNo: null,
  notes: null,
  createdByName: "أحمد الموظف",
  branchName: "الفرع الرئيسي",
};

describe("pdf arabic helpers", () => {
  it("detects RTL text and treats pure numbers as neutral", () => {
    expect(isRtlText("إيصال قبض")).toBe(true);
    expect(isRtlText("1,350.00")).toBe(false);
    expect(isRtlText("B1-MEM-000042")).toBe(false);
  });

  it("normalizes Arabic-Indic digits to ASCII so amounts read LTR", () => {
    expect(toAsciiDigits("١٢٣٤")).toBe("1234");
    expect(toAsciiDigits("٤٥٦")).toBe("456");
    expect(toAsciiDigits("1350")).toBe("1350");
  });

  it("splits mixed Arabic/LTR strings into directional BiDi runs", () => {
    const runs = splitBiDiRuns("باقة 12 جلسة VIP");
    expect(runs).toEqual([
      { text: "باقة ", isRtl: true },
      { text: "12", isRtl: false },
      { text: " جلسة ", isRtl: true },
      { text: "VIP", isRtl: false },
    ]);

    const pure = splitBiDiRuns("قيمة الاشتراك");
    expect(pure).toEqual([{ text: "قيمة الاشتراك", isRtl: true }]);
  });
});

describe("receipt PDF rendering", () => {
  const base = SAMPLE;

  it("centers the developer credit on the page width", () => {
    // Regression guard: the credit must be centred on the PAGE (595pt A4), not on
    // the content column, and must be split into the lighter `System by :` label
    // plus the smaller/darker name.
    const xs: number[] = [];
    let fills = 0;
    const stub = {
      page: { width: 595 },
      moveTo: (x: number) => {
        xs.push(x);
      },
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      closePath: () => {},
      fill: () => {
        fills += 1;
      },
      font: () => {},
      registerFont: () => {},
      text: () => {},
      widthOfString: () => 0,
    };

    drawDeveloperCredit(stub as never, 740);

    // Two parts => two fill operations (one per colour).
    expect(fills).toBe(2);
    expect(xs.length).toBeGreaterThan(10);

    // Advance boxes, so allow a little slack for side bearings.
    const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(centre - 595 / 2)).toBeLessThan(6);
  });

  it("fills an Arabic line as ONE path so cursive joins have no seams", () => {
    // Regression guard: filling each glyph separately left hairline anti-aliasing
    // seams wherever two cursive glyphs touch, which sliced joined letters into
    // separate pieces. All contours of a line must go into a single fill().
    let fills = 0;
    let moves = 0;
    const stub = {
      page: { width: 595 },
      moveTo: () => {
        moves += 1;
      },
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      closePath: () => {},
      fill: () => {
        fills += 1;
      },
      // unused by the RTL vector branch
      font: () => {},
      registerFont: () => {},
      text: () => {},
      widthOfString: () => 0,
    };

    drawText(stub as never, "شهر", 40, 60, 515, { size: 14, align: "right" });

    // Many contours (moveTo) must collapse into exactly one fill operation.
    expect(moves).toBeGreaterThan(3);
    expect(fills).toBe(1);
  });

  it("lays out Arabic cursively, with no tracking gap between glyphs", async () => {
    // Regression guard for two separate bugs:
    //  1. letter tracking severs Arabic cursive joins ("شهر"/"الرئيسي" came
    //     apart letter by letter);
    //  2. measureText must agree with drawRtlVector, otherwise headers/columns
    //     drift and the right-most glyph is pushed past its box (which clipped
    //     the first letter of every right-aligned label).
    // Tracking is added per glyph, so measuring a multi-glyph word MUST cost more
    // than a single glyph of the same size. If this ever becomes equal again,
    // someone re-introduced inter-glyph tracking and broke the joins.
    const single = measureText("س", { size: 10 });
    const multi = measureText("شهر", { size: 10 });
    const longWord = measureText("الرئيسي", { size: 10 });

    expect(single).toBeGreaterThan(0);
    // A cursive word is wider than one letter (it is several glyphs).
    expect(multi).toBeGreaterThan(single);
    expect(longWord).toBeGreaterThan(multi);

    // Word separation must still be applied between words...
    const spaced = measureText("شهر الرئيسي", { size: 10 });
    expect(spaced).toBeGreaterThan(multi + longWord);

    // ...and it must come from the FONT's real space advance, not a hand-picked
    // multiplier. The old `size * 0.3` was ~35% wider than Cairo's actual space
    // and made every multi-word label diverge from how the app renders the same
    // string in the browser. Cairo's space is ~0.22em, so the gap must be
    // positive yet strictly below 0.3 * size.
    const gap = spaced - multi - longWord;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(10 * 0.3);

    // ...and NOT inside a word: a single word is strictly narrower than the same
    // glyphs laid out with word gaps between them.
    expect(multi).toBeLessThan(measureText("شه ر", { size: 10 }));
  });

  it("matches the browser's shaping width for a multi-word label", async () => {
    // Ground truth: Chrome/HarfBuzz shapes "قيمة الاشتراك" at 100px to 565px of
    // INK. measureText returns the ADVANCE sum, which is slightly wider (side
    // bearings). The real point of this guard is the UPPER bound: the old
    // hand-picked `size * 0.3` word gap produced ~588 here, i.e. visibly wider
    // than the browser and inconsistent with the on-screen rendering.
    const at100 = measureText("قيمة الاشتراك", { size: 100 });
    expect(at100).toBeGreaterThan(565);
    expect(at100).toBeLessThan(585);
  });

  it("keeps the title inside the page right margin", async () => {
    const bytes = await renderReceiptPdf({ ...base, title: "فاتورة دفع" });
    // A long title must still produce a valid single page (no overflow page).
    const pages = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBe(1);
  });

  it("produces a valid single-page PDF with an embedded font", async () => {
    const bytes = await renderReceiptPdf(base);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
    // /Type /Page must appear exactly once -> single page receipt.
    const pages = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBe(1);
    // An embedded TrueType font program must be present.
    expect(bytes.toString("latin1")).toContain("/FontFile2");
  });

  it("renders a zero-total receipt without overflowing to a second page", async () => {
    const bytes = await renderReceiptPdf({
      ...base,
      baseAmountMinor: 0,
      discountAmountMinor: 0,
      netAmountMinor: 0,
      paidAmountMinor: 0,
      planName: null,
      referenceNo: null,
    });
    const pages = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBe(1);
  });

  it("renders a long notes/receipt without breaking the single page", async () => {
    const bytes = await renderReceiptPdf({
      ...base,
      notes: "ملاحظة طويلة جداً ".repeat(6),
      referenceNo: "REF-1234567890",
    });
    const pages = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBe(1);
  });
});

describe("generatePaymentReceipt", () => {
  it("uses a per-type default title when no override is configured", async () => {
    const { payment } = await paymentWithPhone("01000000000");
    const data = await generatePaymentReceipt(db, owner, payment.id);
    expect(data.fileName).toMatch(/^receipt-(?:[A-Z0-9]{1,6}-)+RCP-/);
    // Arabic is drawn as vector glyphs, so assert on the service-level default
    // rather than the PDF text layer.
    expect(DOC_TYPE_TITLES.payment_receipt).toBe("فاتورة دفع");
  });

  it("lets the Settings value override the per-type default", async () => {
    const { payment } = await paymentWithPhone("01000000000");
    writeSetting(db, SETTING_KEYS.receiptTitle, "إيصال اشتراك شهري");
    const data = await generatePaymentReceipt(db, owner, payment.id);
    expect(data.fileName).toMatch(/^receipt-(?:[A-Z0-9]{1,6}-)+RCP-/);
  });

  it("treats a blank Settings value as unset and keeps the default", async () => {
    const { payment } = await paymentWithPhone("01000000000");
    writeSetting(db, SETTING_KEYS.receiptTitle, "   ");
    const data = await generatePaymentReceipt(db, owner, payment.id);
    expect(data.fileName).toMatch(/^receipt-(?:[A-Z0-9]{1,6}-)+RCP-/);
  });

  it("renders the title it was given in the PDF template", async () => {
    const bytes = await renderReceiptPdf({
      ...SAMPLE,
      title: "فاتورة مستحقات",
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("renders the default title when none is supplied", async () => {
    const bytes = await renderReceiptPdf({ ...SAMPLE, title: undefined });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("returns base64 PDF bytes and a stable receipt number", async () => {
    const { payment } = await paymentWithPhone("01000000000");
    const a = await generatePaymentReceipt(db, owner, payment.id);
    expect(a.fileName).toMatch(/^receipt-(?:[A-Z0-9]{1,6}-)+RCP-\d{4}-\d{6}\.pdf$/);
    expect(a.size).toBeGreaterThan(2000);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(a.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");

    // The receipt number is assigned once and reused (PDF bytes themselves are
    // not byte-stable because PDFKit stamps a creation date into the file).
    const b = await generatePaymentReceipt(db, owner, payment.id);
    expect(b.fileName).toBe(a.fileName);
    const stored = db.scalar("SELECT receipt_no FROM payments WHERE id = ?", [payment.id]);
    expect(stored).toBe(a.fileName.replace("receipt-", "").replace(".pdf", ""));
  });

  it("does NOT create a delivery row (generation is read-only)", async () => {
    const { payment } = await paymentWithPhone("01000000000");
    await generatePaymentReceipt(db, owner, payment.id);
    expect(listPdfDeliveries(db, owner, {})).toHaveLength(0);
  });

  it("denies a role without pdf.receipt", async () => {
    const trainer = buildActor(
      await createUser(db, owner, {
        username: "trainer",
        password: "Train@2026",
        fullName: "مدرب",
        roleId: "trainer",
      }),
    );
    const { payment } = await paymentWithPhone("01000000000");
    await expect(generatePaymentReceipt(db, trainer, payment.id)).rejects.toThrow(errForbidden());
  });
});

describe("sendPaymentReceipt", () => {
  it("records not_configured when WhatsApp is off (never silently succeeds)", async () => {
    const { payment } = await paymentWithPhone("01000000000");
    const { delivery } = await sendPaymentReceipt(db, owner, payment.id);
    expect(delivery.status).toBe("not_configured");
    const rows = listPdfDeliveries(db, owner, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].fileSize).toBeGreaterThan(2000);
    expect(rows[0].fileName).toMatch(/^receipt-(?:[A-Z0-9]{1,6}-)+RCP-\d{4}-\d{6}\.pdf$/);
  });

  it("records no_phone when the member has no number", async () => {
    const { payment } = await paymentWithPhone(null);
    const { delivery } = await sendPaymentReceipt(db, owner, payment.id);
    expect(delivery.status).toBe("no_phone");
  });

  it("marks sent and audits when the transport succeeds (mock)", async () => {
    process.env.GYM_CRM_MOCK = "1";
    try {
      const { payment } = await paymentWithPhone("01000000000");
      const { delivery } = await sendPaymentReceipt(db, owner, payment.id);
      expect(delivery.status).toBe("sent");
      expect(delivery.sentAt).not.toBeNull();
      const audited = db.count(
        "SELECT COUNT(*) FROM audit_logs WHERE action = 'PDF_RECEIPT_SENT'",
      );
      expect(audited).toBe(1);
    } finally {
      delete process.env.GYM_CRM_MOCK;
    }
  });

  it("lists deliveries newest-first and filters by status", async () => {
    process.env.GYM_CRM_MOCK = "1";
    try {
      const { payment } = await paymentWithPhone("01000000000");
      await sendPaymentReceipt(db, owner, payment.id);
      await sendPaymentReceipt(db, owner, payment.id);
      expect(listPdfDeliveries(db, owner, {})).toHaveLength(2);
      expect(listPdfDeliveries(db, owner, { status: "sent" })).toHaveLength(2);
      expect(listPdfDeliveries(db, owner, { status: "failed" })).toHaveLength(0);
    } finally {
      delete process.env.GYM_CRM_MOCK;
    }
  });

  it("denies sending without pdf.receipt", async () => {
    const trainer = buildActor(
      await createUser(db, owner, {
        username: "trainer",
        password: "Train@2026",
        fullName: "مدرب",
        roleId: "trainer",
      }),
    );
    const { payment } = await paymentWithPhone("01000000000");
    await expect(sendPaymentReceipt(db, trainer, payment.id)).rejects.toThrow(errForbidden());
  });
});

describe("store sale receipt PDF", () => {
  it("generates and sends store sales receipt with line items", async () => {
    const member = await createMember(db, owner, { fullName: "كريم أحمد", phone: "01122334455" });
    const product = await createProduct(db, owner, {
      name: "بروتين واي شوكولاتة",
      priceMinor: 250000,
      costMinor: 180000,
      stockQty: 10,
    });
    const sale = await createSale(db, owner, {
      items: [{ productId: product.id, qty: 2 }],
      discountMinor: 20000,
      methodCode: "cash",
      memberId: member.id,
    });

    const pdf = await generateStoreSaleReceipt(db, owner, sale.id);
    expect(pdf.fileName).toBe(`sale-${sale.saleNo}.pdf`);
    expect(pdf.size).toBeGreaterThan(2000);
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");

    process.env.GYM_CRM_MOCK = "1";
    try {
      const { delivery } = await sendStoreSaleReceipt(db, owner, sale.id);
      expect(delivery.status).toBe("sent");
      expect(delivery.docType).toBe("store_sale_receipt");
      expect(delivery.phone).toBe("01122334455");
    } finally {
      delete process.env.GYM_CRM_MOCK;
    }
  });
});

describe("subscription contract PDF", () => {
  it("generates and sends subscription agreement contract", async () => {
    const member = await createMember(db, owner, { fullName: "سارة محمود", phone: "01099887766" });
    const plan = await createPlan(db, owner, {
      name: "اشتراك نصف سنوي VIP",
      durationDays: 180,
      price: 4500,
      sessionsLimit: 60,
      freezeDaysLimit: 30,
      freezeMaxCount: 2,
    });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 450000,
      paidAmountMinor: 300000,
      methodCode: "cash",
    });

    const pdf = await generateSubscriptionContract(db, owner, sub.id);
    expect(pdf.fileName).toBe(`contract-${member.memberCode}.pdf`);
    expect(pdf.size).toBeGreaterThan(2000);
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");

    process.env.GYM_CRM_MOCK = "1";
    try {
      const { delivery } = await sendSubscriptionContract(db, owner, sub.id);
      expect(delivery.status).toBe("sent");
      expect(delivery.docType).toBe("subscription_contract");
      expect(delivery.phone).toBe("01099887766");
    } finally {
      delete process.env.GYM_CRM_MOCK;
    }
  });
});

describe("previewReceiptTemplate", () => {
  it("generates a live subscription preview PDF matching custom form inputs", async () => {
    const res = await previewReceiptTemplate(db, owner, {
      gymName: "كابتن جيم برو",
      gymPhone: "01099998888",
      receiptTitle: "إيصال سداد مخصص",
      showLogo: true,
      logoWidth: 150,
      showTax: true,
      taxPercent: 14,
      showQr: true,
      footerText: "تعليمات خاصة بالفرع",
      terms: "1. بند تجريبي أول\n2. بند تجريبي ثانٍ",
      docKind: "subscription",
    });

    expect(res.fileName).toBe("preview-receipt.pdf");
    expect(res.size).toBeGreaterThan(2000);
    expect(Buffer.from(res.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("generates a live store sale preview PDF matching custom inputs", async () => {
    const res = await previewReceiptTemplate(db, owner, {
      gymName: "صالة فيتنس متجر",
      gymPhone: "01011112222",
      showLogo: false,
      logoWidth: 180,
      showTax: false,
      docKind: "store",
    });

    expect(res.fileName).toBe("preview-store-receipt.pdf");
    expect(res.size).toBeGreaterThan(2000);
    expect(Buffer.from(res.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });
});
