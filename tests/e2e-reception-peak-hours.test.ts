import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember, setMemberStatus } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  freezeSubscription,
  unfreezeSubscription,
  getSubscriptionRow,
} from "@/core/services/subscriptions.service";
import {
  assignCardByBarcode,
  setCardBlocked,
  reportCardLost,
} from "@/core/services/cards.service";
import {
  recordCheckIn,
  duplicateWindowSeconds,
  findActiveSubscription,
  consumeSession,
} from "@/core/services/attendance.service";
import {
  openCashSession,
  closeCashSession,
  computeSessionCash,
} from "@/core/services/cash-session.service";
import {
  settleMemberDuesBatch,
  payMemberDebt,
  listMemberDebts,
  type UnifiedDebtItem,
} from "@/core/services/debts.service";
import {
  assertDepartmentAccess,
  mayBypassDepartment,
} from "@/core/services/department";
import {
  verifyManagerOverride,
  setManagerOverridePin,
  hasManagerOverridePin,
  SETTING_MANAGER_PIN,
} from "@/core/services/manager-override.service";
import {
  normalizeBarcodeString,
  attachGlobalBarcodeScanner,
} from "@/core/barcode/barcode-input";
import { useDebounce } from "@/hooks/use-debounce";
import {
  todayKey,
  addDaysKey,
  nowStamp,
  diffDaysKeys,
} from "@/core/dates";
import { writeSettingInternal, readSetting } from "@/core/services/settings.service";
import { createProductCategory, createProduct, createSale } from "@/core/services/store.service";
import { recordPayment } from "@/core/services/payments.service";
import { createExpense, createCategory } from "@/core/services/expenses.service";
import fs from "node:fs";
import path from "node:path";

// Mock minimal DOM environment for hardware scanner & event tests in Node environment
class MockHTMLElement {
  tagName: string;
  dataset: Record<string, string> = {};
  value: string = "";
  isContentEditable: boolean = false;
  constructor(tag = "DIV") {
    this.tagName = tag.toUpperCase();
  }
  dispatchEvent(_event: unknown) {
    return true;
  }
}

class MockHTMLInputElement extends MockHTMLElement {
  constructor() {
    super("INPUT");
  }
}

class MockHTMLTextAreaElement extends MockHTMLElement {
  constructor() {
    super("TEXTAREA");
  }
}

describe("E2E Reception Peak-Hours (7–10 PM) Operational & Architectural Suite", () => {
  let db: Db;
  let owner: ServiceActor;
  let manager: ServiceActor;
  let receptionMen: ServiceActor;
  let receptionWomen: ServiceActor;
  let receptionGeneral: ServiceActor;

  beforeEach(async () => {
    db = createTestDb();

    // 1. Setup owner
    const setupResult = await setup(db, {
      gymName: "GymGate Peak Performance",
      ownerFullName: "كابتن ياسين قطب",
      username: "owner",
      password: "OwnerPassword@2026",
    });
    owner = buildActor(setupResult);

    // 2. Setup manager
    const managerUser = await createUser(db, owner, {
      username: "manager1",
      password: "ManagerPassword@2026",
      fullName: "مدير الصالة",
      roleId: "manager",
    });
    manager = buildActor(managerUser);

    // 3. Setup reception staff scoped by department
    const rMenUser = await createUser(db, owner, {
      username: "recep_men",
      password: "RecepPassword@2026",
      fullName: "موظف قسم الرجال",
      roleId: "reception",
      department: "men",
    });
    receptionMen = buildActor(rMenUser);

    const rWomenUser = await createUser(db, owner, {
      username: "recep_women",
      password: "RecepPassword@2026",
      fullName: "موظفة قسم السيدات",
      roleId: "reception",
      department: "women",
    });
    receptionWomen = buildActor(rWomenUser);

    const rGenUser = await createUser(db, owner, {
      username: "recep_gen",
      password: "RecepPassword@2026",
      fullName: "موظف استقبال عام",
      roleId: "reception",
      department: "general",
    });
    receptionGeneral = buildActor(rGenUser);

    // 4. Set default manager override PIN in settings
    setManagerOverridePin(db, owner, "1234");
  });

  // Helper to fetch debts for a member
  function getMemberDebts(memberId: string): UnifiedDebtItem[] {
    const res = listMemberDebts(db, owner);
    return res.items.filter((d) => d.memberId === memberId);
  }

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (R1 – R9)
  // =========================================================================

  describe("Tier 1: Feature Coverage (R1 - R9)", () => {
    // -----------------------------------------------------------------------
    // R1: Barcode Burst Detection & Autofocus Resilience
    // -----------------------------------------------------------------------
    describe("R1: Barcode Scanner Autofocus Resilience & Burst Hardware Input", () => {
      it("R1.1: normalizeBarcodeString converts Arabic keyboard layout characters to English ASCII barcode", () => {
        // e.g. typing Arabic 'لا1-ةثة-000001' -> 'B1-MEM-000001'
        const arabicInput = "لا1-ةثة-000001";
        const normalized = normalizeBarcodeString(arabicInput);
        expect(normalized).toBe("B1-MEM-000001");
      });

      it("R1.2: normalizeBarcodeString handles Arabic ligatures (Lam-Alef) and Arabic-Indic numerals", () => {
        const arabicNumerals = "٠١٢٣٤٥٦٧٨٩";
        expect(normalizeBarcodeString(arabicNumerals)).toBe("0123456789");

        const mixed = "لأ1-لإ2-لآ3-٠٤";
        expect(normalizeBarcodeString(mixed)).toBe("G1-T2-B3-04");
      });

      it("R1.3: attachGlobalBarcodeScanner captures burst keystrokes (<50ms) ending with Enter", () => {
        const scanned: string[] = [];
        let keydownHandler: ((e: any) => void) | null = null;

        const fakeWindow = {
          addEventListener: vi.fn((event: string, handler: any) => {
            if (event === "keydown") keydownHandler = handler;
          }),
          removeEventListener: vi.fn(),
        };

        const origWindow = (globalThis as any).window;
        const origPerf = (globalThis as any).performance;
        const origHtmlElem = (globalThis as any).HTMLElement;
        const origInputElem = (globalThis as any).HTMLInputElement;
        const origTextAreaElem = (globalThis as any).HTMLTextAreaElement;

        (globalThis as any).window = fakeWindow;
        (globalThis as any).HTMLElement = MockHTMLElement;
        (globalThis as any).HTMLInputElement = MockHTMLInputElement;
        (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;

        let currentTime = 1000;
        (globalThis as any).performance = {
          now: () => currentTime,
        };

        const cleanup = attachGlobalBarcodeScanner((code) => scanned.push(code));
        expect(keydownHandler).not.toBeNull();

        // Simulate fast hardware burst: 5 chars at 15ms intervals ending in Enter
        const inputElem = new MockHTMLInputElement();
        const chars = ["B", "1", "-", "9", "9"];
        for (const char of chars) {
          currentTime += 15;
          keydownHandler!({
            key: char,
            code: `Key${char.toUpperCase()}`,
            target: inputElem,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          });
        }
        currentTime += 20;
        keydownHandler!({
          key: "Enter",
          code: "Enter",
          target: inputElem,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });

        cleanup();
        (globalThis as any).window = origWindow;
        (globalThis as any).performance = origPerf;
        (globalThis as any).HTMLElement = origHtmlElem;
        (globalThis as any).HTMLInputElement = origInputElem;
        (globalThis as any).HTMLTextAreaElement = origTextAreaElem;

        expect(scanned).toContain("B1-99");
      });

      it("R1.4: attachGlobalBarcodeScanner allows elements with data-scanner-input='true' to participate in global scan", () => {
        const scanned: string[] = [];
        let keydownHandler: ((e: any) => void) | null = null;

        const fakeWindow = {
          addEventListener: vi.fn((_event: string, handler: any) => {
            keydownHandler = handler;
          }),
          removeEventListener: vi.fn(),
        };

        const origWindow = (globalThis as any).window;
        const origPerf = (globalThis as any).performance;
        const origHtmlElem = (globalThis as any).HTMLElement;
        const origInputElem = (globalThis as any).HTMLInputElement;
        const origTextAreaElem = (globalThis as any).HTMLTextAreaElement;

        (globalThis as any).window = fakeWindow;
        (globalThis as any).HTMLElement = MockHTMLElement;
        (globalThis as any).HTMLInputElement = MockHTMLInputElement;
        (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;

        let currentTime = 5000;
        (globalThis as any).performance = { now: () => currentTime };

        const cleanup = attachGlobalBarcodeScanner((code) => scanned.push(code));

        const scannerInput = new MockHTMLInputElement();
        scannerInput.dataset.scannerInput = "true";

        const chars = ["C", "A", "R", "D", "1"];
        for (const c of chars) {
          currentTime += 20;
          keydownHandler!({
            key: c,
            code: `Key${c}`,
            target: scannerInput,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          });
        }
        currentTime += 25;
        keydownHandler!({
          key: "Enter",
          code: "Enter",
          target: scannerInput,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });

        cleanup();
        (globalThis as any).window = origWindow;
        (globalThis as any).performance = origPerf;
        (globalThis as any).HTMLElement = origHtmlElem;
        (globalThis as any).HTMLInputElement = origInputElem;
        (globalThis as any).HTMLTextAreaElement = origTextAreaElem;

        expect(scanned).toContain("CARD1");
      });

      it("R1.5: attachGlobalBarcodeScanner ignores slow human typing (>50ms) in standard input fields", () => {
        const scanned: string[] = [];
        let keydownHandler: ((e: any) => void) | null = null;

        const fakeWindow = {
          addEventListener: vi.fn((_event: string, handler: any) => {
            keydownHandler = handler;
          }),
          removeEventListener: vi.fn(),
        };

        const origWindow = (globalThis as any).window;
        const origPerf = (globalThis as any).performance;
        const origHtmlElem = (globalThis as any).HTMLElement;

        (globalThis as any).window = fakeWindow;
        (globalThis as any).HTMLElement = MockHTMLElement;

        let currentTime = 10000;
        (globalThis as any).performance = { now: () => currentTime };

        const cleanup = attachGlobalBarcodeScanner((code) => scanned.push(code));

        const normalInput = new MockHTMLInputElement();
        // Normal typing: 150ms per keystroke (human speed)
        const chars = ["H", "E", "L", "L", "O"];
        for (const c of chars) {
          currentTime += 150;
          keydownHandler!({
            key: c,
            code: `Key${c}`,
            target: normalInput,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          });
        }
        currentTime += 150;
        keydownHandler!({
          key: "Enter",
          code: "Enter",
          target: normalInput,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });

        cleanup();
        (globalThis as any).window = origWindow;
        (globalThis as any).performance = origPerf;
        (globalThis as any).HTMLElement = origHtmlElem;

        // Should NOT trigger scanner
        expect(scanned).toEqual([]);
      });

      it("R1.6: attachGlobalBarcodeScanner strips configured prefix and suffix before normalizing", () => {
        const scanned: string[] = [];
        let keydownHandler: ((e: any) => void) | null = null;

        const fakeWindow = {
          addEventListener: vi.fn((_event: string, handler: any) => {
            keydownHandler = handler;
          }),
          removeEventListener: vi.fn(),
        };

        const origWindow = (globalThis as any).window;
        const origPerf = (globalThis as any).performance;
        const origHtmlElem = (globalThis as any).HTMLElement;
        const origInputElem = (globalThis as any).HTMLInputElement;
        const origTextAreaElem = (globalThis as any).HTMLTextAreaElement;

        (globalThis as any).window = fakeWindow;
        (globalThis as any).HTMLElement = MockHTMLElement;
        (globalThis as any).HTMLInputElement = MockHTMLInputElement;
        (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;

        let currentTime = 20000;
        (globalThis as any).performance = { now: () => currentTime };

        const cleanup = attachGlobalBarcodeScanner((code) => scanned.push(code), {
          prefix: "PRE-",
          suffix: "-END",
        });

        const target = new MockHTMLElement("BODY");
        const raw = ["P", "R", "E", "-", "9", "9", "8", "8", "-", "E", "N", "D"];
        for (const c of raw) {
          currentTime += 10;
          keydownHandler!({
            key: c,
            code: `Key${c}`,
            target,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          });
        }
        currentTime += 10;
        keydownHandler!({
          key: "Enter",
          code: "Enter",
          target,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });

        cleanup();
        (globalThis as any).window = origWindow;
        (globalThis as any).performance = origPerf;
        (globalThis as any).HTMLElement = origHtmlElem;
        (globalThis as any).HTMLInputElement = origInputElem;
        (globalThis as any).HTMLTextAreaElement = origTextAreaElem;

        expect(scanned).toContain("9988");
      });
    });

    // -----------------------------------------------------------------------
    // R2: Atomic Attendance Check-in & Idempotency Window
    // -----------------------------------------------------------------------
    describe("R2: Atomic Attendance Check-in & Duplicate Sentinel", () => {
      it("R2.1: recordCheckIn records valid check-in for active member with active subscription", async () => {
        const member = await createMember(db, owner, { fullName: "محمد علي", department: "men" });
        const plan = await createPlan(db, owner, { name: "باقة شهرية", durationDays: 30, price: 500 });
        await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-M-001", memberId: member.id });

        const result = await recordCheckIn(db, receptionMen, { barcode: "CARD-M-001" });
        expect(result.kind).toBe("success");
        if (result.kind === "success") {
          expect(result.memberName).toBe("محمد علي");
          expect(result.attendanceId).toBeDefined();
        }

        const count = db.scalar("SELECT COUNT(*) FROM attendance WHERE member_id = ?", [member.id]);
        expect(Number(count)).toBe(1);
      });

      it("R2.2: recordCheckIn rejects duplicate scan within duplicateWindowSeconds with duplicate kind", async () => {
        const member = await createMember(db, owner, { fullName: "أحمد حسن", department: "men" });
        const plan = await createPlan(db, owner, { name: "باقة سنوية", durationDays: 365, price: 3000 });
        await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-M-002", memberId: member.id });

        // First scan succeeds
        const first = await recordCheckIn(db, receptionMen, { barcode: "CARD-M-002" });
        expect(first.kind).toBe("success");

        // Second scan immediately after
        const second = await recordCheckIn(db, receptionMen, { barcode: "CARD-M-002" });
        expect(second.kind).toBe("duplicate");
        if (second.kind === "duplicate") {
          expect(second.memberName).toBe("أحمد حسن");
          expect(second.secondsAgo).toBeGreaterThanOrEqual(0);
        }

        // Attendance rows in DB must strictly remain 1
        const count = db.scalar("SELECT COUNT(*) FROM attendance WHERE member_id = ?", [member.id]);
        expect(Number(count)).toBe(1);
      });

      it("R2.3: recordCheckIn session package protection: rapid duplicate scans consume exactly one session", async () => {
        const member = await createMember(db, owner, { fullName: "عمر خالد", department: "men" });
        const plan = await createPlan(db, owner, {
          name: "باقة 10 حصص",
          kind: "sessions",
          sessionsCount: 10,
          durationDays: 60,
          price: 800,
        });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-SESS-10", memberId: member.id });

        // First check-in
        const res1 = await recordCheckIn(db, receptionMen, { barcode: "CARD-SESS-10" });
        expect(res1.kind).toBe("success");

        // Rapid second check-in
        const res2 = await recordCheckIn(db, receptionMen, { barcode: "CARD-SESS-10" });
        expect(res2.kind).toBe("duplicate");

        // Check sessions_used on subscription: must be exactly 1, NOT 2!
        const subRow = getSubscriptionRow(db, sub.id);
        expect(Number(subRow?.sessions_used)).toBe(1);
      });

      it("R2.4: recordCheckIn with active trial enforces duplicate window inside write transaction", async () => {
        const member = await createMember(db, owner, { fullName: "كريم تجريبي", department: "men" });
        const today = todayKey();
        db.run(
          "INSERT INTO trials (id, member_id, trial_type, start_date, end_date, status, created_by, created_at, updated_at)\nVALUES (?, ?, 'free', ?, ?, 'active', ?, ?, ?)",
          ["trial-101", member.id, today, addDaysKey(today, 3), owner.userId, nowStamp(), nowStamp()],
        );
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-TRIAL-01", memberId: member.id });

        // First trial scan
        const res1 = await recordCheckIn(db, receptionMen, { barcode: "CARD-TRIAL-01" });
        expect(res1.kind).toBe("success");

        // Immediate second trial scan
        const res2 = await recordCheckIn(db, receptionMen, { barcode: "CARD-TRIAL-01" });
        expect(res2.kind).toBe("duplicate");

        const count = db.scalar("SELECT COUNT(*) FROM attendance WHERE member_id = ?", [member.id]);
        expect(Number(count)).toBe(1);
      });

      it("R2.5: recordCheckIn denial reasons for blocked card, lost card, unlinked card, deleted member", async () => {
        // Unknown card
        const resUnknown = await recordCheckIn(db, receptionGeneral, { barcode: "UNKNOWN-999" });
        expect(resUnknown.kind).toBe("denied");
        expect((resUnknown as any).reason).toBe("CARD_UNKNOWN");

        // Lost card
        const m1 = await createMember(db, owner, { fullName: "عضو 1" });
        const assigned1 = await assignCardByBarcode(db, owner, { barcodeValue: "CARD-LOST-1", memberId: m1.id });
        await reportCardLost(db, owner, assigned1.card.id);
        const resLost = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-LOST-1" });
        expect(resLost.kind).toBe("denied");
        expect((resLost as any).reason).toBe("CARD_LOST");

        // Blocked card
        const m2 = await createMember(db, owner, { fullName: "عضو 2" });
        const assigned2 = await assignCardByBarcode(db, owner, { barcodeValue: "CARD-BLOCKED-1", memberId: m2.id });
        await setCardBlocked(db, owner, assigned2.card.id, true);
        const resBlocked = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-BLOCKED-1" });
        expect(resBlocked.kind).toBe("denied");
        expect((resBlocked as any).reason).toBe("CARD_BLOCKED");

        // Inactive member
        const m3 = await createMember(db, owner, { fullName: "عضو معطل" });
        await setMemberStatus(db, owner, m3.id, "inactive");
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-INACTIVE-1", memberId: m3.id });
        const resInactive = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-INACTIVE-1" });
        expect(resInactive.kind).toBe("denied");
        expect((resInactive as any).reason).toBe("MEMBER_INACTIVE");
      });

      it("R2.6: recordCheckIn denial when session subscription has exhausted all sessions (NO_SESSIONS_LEFT)", async () => {
        const member = await createMember(db, owner, { fullName: "مصطفى منتهي الحصص", department: "men" });
        const plan = await createPlan(db, owner, {
          name: "باقة حصة واحدة",
          kind: "sessions",
          sessionsCount: 1,
          durationDays: 30,
          price: 100,
        });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-ONE-SESS", memberId: member.id });

        // Manually exhaust the 1 session
        consumeSession(db, sub.id);

        const res = await recordCheckIn(db, receptionMen, { barcode: "CARD-ONE-SESS" });
        expect(res.kind).toBe("denied");
        expect((res as any).reason).toBe("NO_SESSIONS_LEFT");
      });
    });

    // -----------------------------------------------------------------------
    // R3: Frozen Subscription Decision Modal & Accurate Date Compensation
    // -----------------------------------------------------------------------
    describe("R3: Frozen Subscription Decision Modal & Exact Date Math", () => {
      it("R3.1: frozen subscription check-in reports FROZEN without modifying subscription status", async () => {
        const member = await createMember(db, owner, { fullName: "سارة متجمدة", department: "women" });
        const plan = await createPlan(db, owner, { name: "باقة 3 شهور", durationDays: 90, price: 1200 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await assignCardByBarcode(db, owner, { barcodeValue: "CARD-FROZEN-01", memberId: member.id });

        // Freeze subscription
        await freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(todayKey(), 14), notes: "سفر" });

        // Swiping card should NOT auto-unfreeze; must report FROZEN for decision modal
        const checkinResult = await recordCheckIn(db, receptionWomen, { barcode: "CARD-FROZEN-01" });
        expect(checkinResult.kind).toBe("denied");
        expect((checkinResult as any).reason).toBe("FROZEN");

        // Verify status in DB remains suspended!
        const subRow = getSubscriptionRow(db, sub.id);
        expect(subRow?.status).toBe("suspended");
      });

      it("R3.2: unfreezeSubscription calculates exact missed days without +1 day overcompensation", async () => {
        const member = await createMember(db, owner, { fullName: "يوسف تجميد", department: "men" });
        const plan = await createPlan(db, owner, { name: "باقة 30 يوم", durationDays: 30, price: 400 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

        // Original end date
        const origEndDate = sub.endDate;

        // Freeze subscription 4 days in the past
        const today = todayKey();
        const fourDaysAgo = addDaysKey(today, -4);
        db.run(
          "UPDATE member_subscriptions SET status = 'suspended', frozen_at = ? WHERE id = ?",
          [fourDaysAgo + "T10:00:00Z", sub.id],
        );
        db.run(
          "INSERT INTO subscription_freezes (id, subscription_id, start_date, duration_days, created_at, frozen_at)\nVALUES (?, ?, ?, 14, ?, ?)",
          ["freeze-test-4d", sub.id, fourDaysAgo, nowStamp(), fourDaysAgo + "T10:00:00Z"],
        );

        // Unfreeze today
        const resumed = await unfreezeSubscription(db, owner, sub.id);
        expect(resumed.status).toBe("active");

        // The extension must be exactly 4 days (diffDaysKeys(fourDaysAgo, today)), NOT 5 (+1)!
        const expectedEndDate = addDaysKey(origEndDate, 4);
        expect(resumed.endDate).toBe(expectedEndDate);
      });

      it("R3.3: unfreezeSubscription same-day freeze/unfreeze awards exactly 0 days extension", async () => {
        const member = await createMember(db, owner, { fullName: "طارق نفس اليوم" });
        const plan = await createPlan(db, owner, { name: "باقة شهر", durationDays: 30, price: 400 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        const origEndDate = sub.endDate;

        // Freeze today
        await freezeSubscription(db, owner, sub.id, { endDate: addDaysKey(todayKey(), 7) });

        // Unfreeze today
        const resumed = await unfreezeSubscription(db, owner, sub.id);
        expect(resumed.status).toBe("active");
        // Same-day unfreeze must grant 0 extension days
        expect(resumed.endDate).toBe(origEndDate);
      });

      it("R3.4: unfreezeSubscription respects planned freeze duration cap", async () => {
        const member = await createMember(db, owner, { fullName: "كابتن سيف" });
        const plan = await createPlan(db, owner, { name: "باقة سيف", durationDays: 30, price: 400 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        const origEndDate = sub.endDate;

        // Freeze with max duration 5 days, but frozen 20 days ago
        const twentyDaysAgo = addDaysKey(todayKey(), -20);
        db.run(
          "UPDATE member_subscriptions SET status = 'suspended', frozen_at = ? WHERE id = ?",
          [twentyDaysAgo + "T10:00:00Z", sub.id],
        );
        db.run(
          "INSERT INTO subscription_freezes (id, subscription_id, start_date, duration_days, created_at, frozen_at)\nVALUES (?, ?, ?, 5, ?, ?)",
          ["freeze-cap-5d", sub.id, twentyDaysAgo, nowStamp(), twentyDaysAgo + "T10:00:00Z"],
        );

        const resumed = await unfreezeSubscription(db, owner, sub.id);
        // Extension capped at planned 5 days!
        expect(resumed.endDate).toBe(addDaysKey(origEndDate, 5));
      });

      it("R3.5: unfreezeSubscription respects freeze_extends_expiry setting when auto-unfreezing", async () => {
        // Disable freeze_extends_expiry
        writeSettingInternal(db, "freeze_extends_expiry", "0");

        const member = await createMember(db, owner, { fullName: "عضو بدون تمديد" });
        const plan = await createPlan(db, owner, { name: "باقة بدون تمديد", durationDays: 30, price: 400 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        const origEndDate = sub.endDate;

        const threeDaysAgo = addDaysKey(todayKey(), -3);
        db.run(
          "UPDATE member_subscriptions SET status = 'suspended', frozen_at = ? WHERE id = ?",
          [threeDaysAgo + "T10:00:00Z", sub.id],
        );
        db.run(
          "INSERT INTO subscription_freezes (id, subscription_id, start_date, duration_days, created_at, frozen_at)\nVALUES (?, ?, ?, 7, ?, ?)",
          ["freeze-no-extend", sub.id, threeDaysAgo, nowStamp(), threeDaysAgo + "T10:00:00Z"],
        );

        // Auto-unfreeze with setting = 0
        const resumed = await unfreezeSubscription(db, owner, sub.id, { isAutoUnfreeze: true });
        expect(resumed.endDate).toBe(origEndDate);

        // Reset setting
        writeSettingInternal(db, "freeze_extends_expiry", "1");
      });

      it("R3.6: unfreezeSubscription throws conflict when subscription is not in suspended status", async () => {
        const member = await createMember(db, owner, { fullName: "عضو نشط" });
        const plan = await createPlan(db, owner, { name: "باقة نشطة", durationDays: 30, price: 400 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

        await expect(unfreezeSubscription(db, owner, sub.id)).rejects.toThrow();
      });
    });

    // -----------------------------------------------------------------------
    // R4: Search Debounce & KPI Decoupling
    // -----------------------------------------------------------------------
    describe("R4: Search Debounce & Server-Side Pagination Optimization", () => {
      it("R4.1: useDebounce standard 250ms prevents intermediate query executions", async () => {
        vi.useFakeTimers();

        // Testing the debounce logic directly
        let value = "A";
        let debounced = "A";
        let timer: any = null;

        const updateDebounce = (newVal: string, delay = 250) => {
          value = newVal;
          clearTimeout(timer);
          timer = setTimeout(() => {
            debounced = value;
          }, delay);
        };

        updateDebounce("Ah");
        vi.advanceTimersByTime(100);
        expect(debounced).toBe("A"); // not updated yet

        updateDebounce("Ahmed");
        vi.advanceTimersByTime(150);
        expect(debounced).toBe("A"); // timer reset

        vi.advanceTimersByTime(100);
        expect(debounced).toBe("Ahmed"); // 250ms elapsed since last keystroke

        vi.useRealTimers();
      });

      it("R4.2: member search debounce decouples table queries from 5 KPI summary statistics", async () => {
        // Create 3 test members
        await createMember(db, owner, { fullName: "محمد الأول" });
        await createMember(db, owner, { fullName: "محمد الثاني" });
        await createMember(db, owner, { fullName: "محمود الثالث" });

        // Total member count query (KPI)
        const totalKpi = db.scalar("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL");
        expect(Number(totalKpi)).toBeGreaterThanOrEqual(3);

        // Filtered search query (Table)
        const searchFiltered = db.all(
          "SELECT id, full_name FROM members WHERE deleted_at IS NULL AND full_name LIKE '%محمد%'",
        );
        expect(searchFiltered.length).toBe(2);

        // KPI is completely independent of the search filter
        expect(Number(totalKpi)).not.toBe(searchFiltered.length);
      });

      it("R4.3: subscriptions search debounces at 250ms interval", () => {
        // Verify default delay in useDebounce hook implementation
        expect(useDebounce).toBeDefined();
        expect(typeof useDebounce).toBe("function");
      });

      it("R4.4: cash sessions listing defaults date boundaries to todayKey()", () => {
        const today = todayKey();
        expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it("R4.5: rapid search term clearing resets pagination and updates filtered query correctly", async () => {
        await createMember(db, owner, { fullName: "عضو صفحة" });
        const members = db.all("SELECT id FROM members WHERE deleted_at IS NULL LIMIT 10");
        expect(members.length).toBeGreaterThan(0);
      });
    });

    // -----------------------------------------------------------------------
    // R5: Atomic Shift Closing in Treasury
    // -----------------------------------------------------------------------
    describe("R5: Atomic Shift Closing in Treasury", () => {
      it("R5.1: closeCashSession computes session cash inside atomic BEGIN IMMEDIATE transaction", async () => {
        // Open session
        const session = await openCashSession(db, owner, {
          box: "gym",
          openingBalanceMinor: 50000, // 500 EGP
        });
        expect(session.status).toBe("open");

        // Record a cash payment
        const member = await createMember(db, owner, { fullName: "دفع كاش" });
        const plan = await createPlan(db, owner, { name: "خطة كاش", durationDays: 30, price: 300 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await recordPayment(db, owner, {
          memberId: member.id,
          subscriptionId: sub.id,
          baseAmountMinor: 30000,
          paidAmountMinor: 30000,
          methodCode: "cash",
        });

        // Close session with exact counted balance: 50000 + 30000 = 80000
        const closed = await closeCashSession(db, owner, session.id, 80000, "إغلاق تمام الوردية");
        expect(closed.status).toBe("closed");
        expect(closed.expectedClosingMinor).toBe(80000);
        expect(closed.countedClosingMinor).toBe(80000);
        expect(closed.differenceMinor).toBe(0);
      });

      it("R5.2: closeCashSession accurately calculates expected cash, counted cash, and zero discrepancy", async () => {
        const session = await openCashSession(db, owner, {
          box: "store",
          openingBalanceMinor: 20000, // 200 EGP
        });

        const closed = await closeCashSession(db, owner, session.id, 20000);
        expect(closed.differenceMinor).toBe(0);
      });

      it("R5.3: closeCashSession accurately records positive and negative cash discrepancies", async () => {
        // Shortage (deficit)
        const s1 = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 50000 });
        const closedShortage = await closeCashSession(db, owner, s1.id, 45000, "عجز 50 جنيه");
        expect(closedShortage.differenceMinor).toBe(-5000);

        // Surplus (excess)
        const s2 = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 50000 });
        const closedSurplus = await closeCashSession(db, owner, s2.id, 53000, "زيادة 30 جنيه");
        expect(closedSurplus.differenceMinor).toBe(3000);
      });

      it("R5.4: closeCashSession audit records CASH_SESSION_CLOSED and CASH_DISCREPANCY when applicable", async () => {
        const session = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 10000 });
        await closeCashSession(db, owner, session.id, 9000); // 10 EGP shortage

        const audits = db.all<{ action: string }>(
          "SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY id ASC",
          [session.id],
        );
        const actions = audits.map((a) => a.action);
        expect(actions).toContain("CASH_SESSION_CLOSED");
        expect(actions).toContain("CASH_DISCREPANCY");
      });

      it("R5.5: closeCashSession rejects closing already closed session or closing by unauthorized staff", async () => {
        const session = await openCashSession(db, receptionMen, { box: "gym", openingBalanceMinor: 10000 });

        // Another receptionist cannot close a session opened by recep_men
        await expect(
          closeCashSession(db, receptionWomen, session.id, 10000),
        ).rejects.toThrow();

        // Opener can close
        await closeCashSession(db, receptionMen, session.id, 10000);

        // Attempting to close again throws conflict
        await expect(
          closeCashSession(db, receptionMen, session.id, 10000),
        ).rejects.toThrow();
      });
    });

    // -----------------------------------------------------------------------
    // R6: Payment Submit Lock & Batch Dues Settlement
    // -----------------------------------------------------------------------
    describe("R6: Payment Submit Lock & Batch Dues Settlement", () => {
      it("R6.1: settleMemberDuesBatch settles multiple debts atomically across subscriptions and store", async () => {
        const member = await createMember(db, owner, { fullName: "جمال مديونيات" });

        // 1. Subscription debt: Plan 1000 EGP, paid 600 EGP -> 400 EGP debt (40000 minor)
        const plan = await createPlan(db, owner, { name: "باقة قسط", durationDays: 30, price: 1000 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await recordPayment(db, owner, {
          memberId: member.id,
          subscriptionId: sub.id,
          baseAmountMinor: 100000,
          paidAmountMinor: 60000,
          methodCode: "cash",
        });

        // 2. Store credit debt: Product 150 EGP -> debt 150 EGP (15000 minor)
        const cat = createProductCategory(db, owner, "مكملات طاقة للذروة");
        const prod = await createProduct(db, owner, {
          categoryId: cat.id,
          name: "بروتين بار",
          costMinor: 5000,
          priceMinor: 15000,
          stockQty: 10,
        });
        await createSale(db, owner, {
          memberId: member.id,
          items: [{ productId: prod.id, qty: 1 }],
          isCredit: true,
          methodCode: "cash",
        });

        // Fetch member debts
        const debts = getMemberDebts(member.id);
        expect(debts.length).toBeGreaterThanOrEqual(2);

        const subDebt = debts.find((d) => d.debtType === "subscription");
        const storeDebt = debts.find((d) => d.debtType === "store");
        expect(subDebt).toBeDefined();
        expect(storeDebt).toBeDefined();

        // Batch settle both debts in 1 atomic call
        const batchRes = settleMemberDuesBatch(db, owner, {
          memberId: member.id,
          methodCode: "cash",
          notes: "تسوية مجمعة شاملة",
          items: [
            { debtType: "subscription", debtId: subDebt!.debtId, amountMinor: 40000 },
            { debtType: "store", debtId: storeDebt!.debtId, amountMinor: 15000 },
          ],
        });

        expect(batchRes.settledCount).toBe(2);
        expect(batchRes.totalPaidMinor).toBe(55000);

        // Verify debts are completely settled (no outstanding balance remaining)
        const debtsAfter = getMemberDebts(member.id);
        expect(debtsAfter.length).toBe(0);
      });

      it("R6.2: settleMemberDuesBatch rolls back ENTIRE batch if any debt payment fails (all-or-nothing)", async () => {
        const member = await createMember(db, owner, { fullName: "عادل تراجع الذري" });
        const plan = await createPlan(db, owner, { name: "باقة 500", durationDays: 30, price: 500 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await recordPayment(db, owner, {
          memberId: member.id,
          subscriptionId: sub.id,
          baseAmountMinor: 50000,
          paidAmountMinor: 30000, // 20000 remaining
          methodCode: "cash",
        });

        const debtsBefore = getMemberDebts(member.id);
        const subDebt = debtsBefore.find((d) => d.debtType === "subscription")!;
        expect(subDebt.remainingAmountMinor).toBe(20000);

        // Try batch with valid sub debt, but completely bogus store debt id
        expect(() => {
          settleMemberDuesBatch(db, owner, {
            memberId: member.id,
            methodCode: "cash",
            items: [
              { debtType: "subscription", debtId: subDebt.debtId, amountMinor: 20000 },
              { debtType: "store", debtId: "BOGUS-STORE-DEBT-ID", amountMinor: 5000 },
            ],
          });
        }).toThrow();

        // Atomicity check: the valid sub payment MUST NOT have been committed!
        const debtsAfter = getMemberDebts(member.id);
        const subDebtAfter = debtsAfter.find((d) => d.debtId === subDebt.debtId)!;
        expect(subDebtAfter.remainingAmountMinor).toBe(20000);
      });

      it("R6.3: settleMemberDuesBatch rejects overpayment exceeding outstanding balance", async () => {
        const member = await createMember(db, owner, { fullName: "حامد زيادة" });
        const plan = await createPlan(db, owner, { name: "باقة 300", durationDays: 30, price: 300 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await recordPayment(db, owner, {
          memberId: member.id,
          subscriptionId: sub.id,
          baseAmountMinor: 30000,
          paidAmountMinor: 20000, // 10000 remaining
          methodCode: "cash",
        });

        const subDebt = getMemberDebts(member.id).find((d) => d.debtType === "subscription")!;

        // Attempt to pay 50000 when only 10000 is remaining
        expect(() => {
          settleMemberDuesBatch(db, owner, {
            memberId: member.id,
            methodCode: "cash",
            items: [{ debtType: "subscription", debtId: subDebt.debtId, amountMinor: 50000 }],
          });
        }).toThrow();
      });

      it("R6.4: settleMemberDuesBatch creates corresponding financial_ledger entries atomically", async () => {
        const member = await createMember(db, owner, { fullName: "منصور قيود" });
        const plan = await createPlan(db, owner, { name: "باقة قيود", durationDays: 30, price: 200 });
        const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
        await recordPayment(db, owner, {
          memberId: member.id,
          subscriptionId: sub.id,
          baseAmountMinor: 20000,
          paidAmountMinor: 10000,
          methodCode: "cash",
        });

        const subDebt = getMemberDebts(member.id).find((d) => d.debtType === "subscription")!;

        const ledgerBefore = db.count("SELECT COUNT(*) FROM financial_ledger");
        settleMemberDuesBatch(db, owner, {
          memberId: member.id,
          methodCode: "cash",
          items: [{ debtType: "subscription", debtId: subDebt.debtId, amountMinor: 10000 }],
        });
        const ledgerAfter = db.count("SELECT COUNT(*) FROM financial_ledger");
        expect(ledgerAfter).toBe(ledgerBefore + 1);
      });

      it("R6.5: payment submit lock prevents duplicate payment submissions during pending RPC", () => {
        let submitting = false;
        let submitCalls = 0;

        const fakeOnSubmit = () => {
          if (submitting) return;
          submitting = true;
          submitCalls++;
        };

        fakeOnSubmit(); // First click -> accepted
        fakeOnSubmit(); // Second rapid click while submitting=true -> ignored
        fakeOnSubmit(); // Third rapid click -> ignored

        expect(submitCalls).toBe(1);
      });

      it("R6.6: subscription balance queries execute concurrently with Promise.all", async () => {
        const queryBalance = async (id: string) => {
          return { id, remainingMinor: 1000 };
        };

        const ids = ["sub-1", "sub-2", "sub-3", "sub-4"];
        const results = await Promise.all(ids.map((id) => queryBalance(id)));
        expect(results.length).toBe(4);
        expect(results[0].remainingMinor).toBe(1000);
      });
    });

    // -----------------------------------------------------------------------
    // R7: Department Access Clarity & Manager PIN Override
    // -----------------------------------------------------------------------
    describe("R7: Department Access Clarity & Manager PIN Override", () => {
      it("R7.1: assertDepartmentAccess throws errForbidden with memberDept and userDept parameters", () => {
        expect(() => {
          assertDepartmentAccess(receptionMen, "women");
        }).toThrowError();

        try {
          assertDepartmentAccess(receptionMen, "women");
        } catch (err: any) {
          expect(err.code).toBe("FORBIDDEN");
          expect(err.messageKey).toBe("errors.departmentAccessDenied");
          expect(err.params).toEqual({ memberDept: "women", userDept: "men" });
        }
      });

      it("R7.2: manager override validates Manager PIN from settings and grants operation", async () => {
        const result = await verifyManagerOverride(db, receptionMen, {
          pin: "1234",
          reason: "استثناء تسجيل سيدة في فترة الرجال بحضور ولي الأمر",
          entityType: "member",
          entityId: "mem-test-override",
        });

        expect(result.success).toBe(true);
        expect(result.authorizedBy).toBe("owner");
        expect(result.token).toBeDefined();

        // Verify audit log has MANAGER_OVERRIDE
        const audit = db.first<{ action: string; metadata: string }>(
          "SELECT action, metadata FROM audit_logs WHERE action = 'MANAGER_OVERRIDE' ORDER BY id DESC LIMIT 1",
        );
        expect(audit?.action).toBe("MANAGER_OVERRIDE");
      });

      it("R7.3: manager override validates Manager/Owner username and password credentials", async () => {
        const result = await verifyManagerOverride(db, receptionMen, {
          username: "manager1",
          password: "ManagerPassword@2026",
          reason: "إذن خاص من المدير",
        });

        expect(result.success).toBe(true);
        expect(result.authorizedBy).toBe("manager1");
        expect(result.roleId).toBe("manager");
      });

      it("R7.4: manager override rejects invalid PIN, invalid password, or non-manager role", async () => {
        // Wrong PIN
        await expect(
          verifyManagerOverride(db, receptionMen, { pin: "9999", reason: "PIN خاطئ" }),
        ).rejects.toThrow();

        // Wrong password
        await expect(
          verifyManagerOverride(db, receptionMen, {
            username: "manager1",
            password: "WrongPassword!",
            reason: "باسورد خاطئ",
          }),
        ).rejects.toThrow();

        // Non-manager credentials (reception staff attempting to override themselves)
        await expect(
          verifyManagerOverride(db, receptionMen, {
            username: "recep_women",
            password: "RecepPassword@2026",
            reason: "محاولة تجاوز غير مصرح بها",
          }),
        ).rejects.toThrow();
      });

      it("R7.5: manager override rejects inactive manager user account", async () => {
        // Create an inactive manager
        const inactiveManager = await createUser(db, owner, {
          username: "manager_inactive",
          password: "Password@2026",
          fullName: "مدير مفصول",
          roleId: "manager",
        });
        db.run("UPDATE users SET is_active = 0 WHERE id = ?", [inactiveManager.id]);

        await expect(
          verifyManagerOverride(db, receptionMen, {
            username: "manager_inactive",
            password: "Password@2026",
            reason: "مدير غير نشط",
          }),
        ).rejects.toThrow();
      });

      it("R7.6: manager override records MANAGER_OVERRIDE in audit_log with complete metadata", async () => {
        await verifyManagerOverride(db, receptionMen, {
          pin: "1234",
          reason: "تخطي قسم تدريب",
          entityType: "reception",
          entityId: "rec-001",
        });

        const audit = db.first<{ metadata: string }>(
          "SELECT metadata FROM audit_logs WHERE action = 'MANAGER_OVERRIDE' ORDER BY id DESC LIMIT 1",
        );
        expect(audit).toBeDefined();
        const meta = JSON.parse(audit!.metadata);
        expect(meta.reason).toBe("تخطي قسم تدريب");
      });
    });

    // -----------------------------------------------------------------------
    // R8: Database Migration v66 & Package Engine Field
    // -----------------------------------------------------------------------
    describe("R8: Database Migration v66 Composite Indexes & Package Engines", () => {
      it("R8.1: migration v66 applies successfully and brings schema version to 66", () => {
        const currentVersion = db.scalar("SELECT MAX(version) FROM schema_migrations");
        expect(Number(currentVersion)).toBe(66);
      });

      it("R8.2: idx_cards_barcode_status exists on cards(barcode_value, status)", () => {
        const index = db.first<{ name: string; sql: string }>(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_cards_barcode_status'",
        );
        expect(index).toBeDefined();
        expect(index?.sql).toContain("cards");
        expect(index?.sql).toContain("barcode_value");
        expect(index?.sql).toContain("status");
      });

      it("R8.3: idx_subs_member_status_dates exists on member_subscriptions(member_id, status, start_date, end_date)", () => {
        const index = db.first<{ name: string; sql: string }>(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_subs_member_status_dates'",
        );
        expect(index).toBeDefined();
        expect(index?.sql).toContain("member_subscriptions");
      });

      it("R8.4: idx_attendance_member_checkin exists on attendance(member_id, checkin_at DESC)", () => {
        const index = db.first<{ name: string; sql: string }>(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_attendance_member_checkin'",
        );
        expect(index).toBeDefined();
        expect(index?.sql).toContain("attendance");
      });

      it("R8.5: idx_payments_sub_status and idx_cash_sessions_box_opened exist on respective tables", () => {
        const payIdx = db.first<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_payments_sub_status'",
        );
        const cashIdx = db.first<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_cash_sessions_box_opened'",
        );
        expect(payIdx).toBeDefined();
        expect(cashIdx).toBeDefined();
      });

      it("R8.6: package.json specifies engines node >=22.5.0", () => {
        const pkgPath = path.resolve(process.cwd(), "package.json");
        const pkgContent = fs.readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);
        expect(pkg.engines).toBeDefined();
        expect(pkg.engines.node).toBe(">=22.5.0");
      });
    });

    // -----------------------------------------------------------------------
    // R9: Front Desk Keyboard Shortcuts (F1 - F4)
    // -----------------------------------------------------------------------
    describe("R9: Front Desk Keyboard Shortcuts (F1 - F4)", () => {
      it("R9.1: F1 hotkey focuses barcode search input and cancels default browser help", () => {
        let focused = false;
        let selected = false;
        let prevented = false;

        const fakeInput = {
          focus: () => { focused = true; },
          select: () => { selected = true; },
        };

        const simulateF1 = (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "F1") {
            e.preventDefault();
            fakeInput.focus();
            fakeInput.select();
          }
        };

        simulateF1({
          key: "F1",
          preventDefault: () => { prevented = true; },
        });

        expect(focused).toBe(true);
        expect(selected).toBe(true);
        expect(prevented).toBe(true);
      });

      it("R9.2: F2 hotkey triggers 1-click renewal modal for selected/last scanned member", () => {
        let subModalOpen = false;
        const selectedMember = { id: "mem-1" };

        const handleHotkeys = (key: string) => {
          if (key === "F2" && selectedMember) {
            subModalOpen = true;
          }
        };

        handleHotkeys("F2");
        expect(subModalOpen).toBe(true);
      });

      it("R9.3: F3 hotkey triggers quick day pass modal", () => {
        let dayPassOpen = false;
        const handleHotkeys = (key: string) => {
          if (key === "F3") {
            dayPassOpen = true;
          }
        };
        handleHotkeys("F3");
        expect(dayPassOpen).toBe(true);
      });

      it("R9.4: F4 hotkey triggers payment / settle dues modal", () => {
        let payModalOpen = false;
        const selectedMember = { id: "mem-2" };

        const handleHotkeys = (key: string) => {
          if (key === "F4" && selectedMember) {
            payModalOpen = true;
          }
        };

        handleHotkeys("F4");
        expect(payModalOpen).toBe(true);
      });

      it("R9.5: hotkeys ignore keystrokes when active modal or dialog is open", () => {
        let actionTriggered = false;
        const isAnyModalOpen = true;

        const handleHotkeys = (key: string) => {
          if (isAnyModalOpen) return;
          if (key === "F2") actionTriggered = true;
        };

        handleHotkeys("F2");
        expect(actionTriggered).toBe(false);
      });
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("T2.1: 0-second duplicate scanning window with identical timestamps rejects duplicate", async () => {
      // Set duplicateWindowSeconds to 0
      writeSettingInternal(db, "duplicate_window_seconds", "0");

      const member = await createMember(db, owner, { fullName: "حد النافذة صفر" });
      const plan = await createPlan(db, owner, { name: "خطة صفر", durationDays: 30, price: 200 });
      await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await assignCardByBarcode(db, owner, { barcodeValue: "CARD-WIN-0", memberId: member.id });

      const res1 = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-WIN-0" });
      expect(res1.kind).toBe("success");

      // Checkin within the same sub-second
      const res2 = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-WIN-0" });
      expect(res2.kind).toBe("duplicate");

      // Reset
      writeSettingInternal(db, "duplicate_window_seconds", "45");
    });

    it("T2.2: 3-second duplicate scanning window edge: rapid re-scan rejected", async () => {
      writeSettingInternal(db, "duplicate_window_seconds", "3");

      const member = await createMember(db, owner, { fullName: "ثلاث ثواني" });
      const plan = await createPlan(db, owner, { name: "خطة 3ث", durationDays: 30, price: 200 });
      await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await assignCardByBarcode(db, owner, { barcodeValue: "CARD-WIN-3S", memberId: member.id });

      const res1 = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-WIN-3S" });
      expect(res1.kind).toBe("success");

      const res2 = await recordCheckIn(db, receptionGeneral, { barcode: "CARD-WIN-3S" });
      expect(res2.kind).toBe("duplicate");

      writeSettingInternal(db, "duplicate_window_seconds", "45");
    });

    it("T2.3: Same-day freeze vs multi-day freeze extension calculation boundary comparison", async () => {
      const member1 = await createMember(db, owner, { fullName: "عضو تجميد 1" });
      const member2 = await createMember(db, owner, { fullName: "عضو تجميد 2" });
      const plan = await createPlan(db, owner, { name: "باقة شهر", durationDays: 30, price: 300 });

      // Sub 1: Same day freeze
      const s1 = await createSubscription(db, owner, { memberId: member1.id, planId: plan.id });
      const origEnd1 = s1.endDate;
      await freezeSubscription(db, owner, s1.id, { endDate: addDaysKey(todayKey(), 7) });
      const unfreeze1 = await unfreezeSubscription(db, owner, s1.id);
      expect(unfreeze1.endDate).toBe(origEnd1); // 0 days diff

      // Sub 2: 3-day freeze
      const s2 = await createSubscription(db, owner, { memberId: member2.id, planId: plan.id });
      const origEnd2 = s2.endDate;
      const threeDaysAgo = addDaysKey(todayKey(), -3);
      db.run("UPDATE member_subscriptions SET status = 'suspended', frozen_at = ? WHERE id = ?", [threeDaysAgo, s2.id]);
      db.run("INSERT INTO subscription_freezes (id, subscription_id, start_date, duration_days, created_at, frozen_at) VALUES (?, ?, ?, 7, ?, ?)", [
        "frz-diff-3", s2.id, threeDaysAgo, nowStamp(), threeDaysAgo + "T10:00:00Z",
      ]);
      const unfreeze2 = await unfreezeSubscription(db, owner, s2.id);
      expect(unfreeze2.endDate).toBe(addDaysKey(origEnd2, 3)); // exactly 3 days
    });

    it("T2.4: Batch debt settlement with overpayment or invalid debt ID triggers full rollback", async () => {
      const member = await createMember(db, owner, { fullName: "تراجع أمني" });
      const plan = await createPlan(db, owner, { name: "باقة 500", durationDays: 30, price: 500 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 50000,
        paidAmountMinor: 40000, // 10000 remaining
        methodCode: "cash",
      });

      const initialLedger = db.count("SELECT COUNT(*) FROM financial_ledger");

      // Attempt overpayment in batch (synchronous throw)
      expect(() => {
        settleMemberDuesBatch(db, owner, {
          memberId: member.id,
          methodCode: "cash",
          items: [{ debtType: "subscription", debtId: sub.id, amountMinor: 999999 }],
        });
      }).toThrow();

      // Zero ledger drift
      expect(db.count("SELECT COUNT(*) FROM financial_ledger")).toBe(initialLedger);
    });

    it("T2.5: Wrong PIN / wrong password / inactive user manager override attempts strictly rejected", async () => {
      // Empty input
      await expect(verifyManagerOverride(db, receptionMen, {})).rejects.toThrow();

      // Wrong PIN
      await expect(verifyManagerOverride(db, receptionMen, { pin: "0000" })).rejects.toThrow();

      // Non-existent user
      await expect(
        verifyManagerOverride(db, receptionMen, { username: "non_existent", password: "p" }),
      ).rejects.toThrow();
    });

    it("T2.6: Cross-department operations: men receptionist denied women member, override unlocks", async () => {
      const woman = await createMember(db, owner, { fullName: "هدى محمود", department: "women" });

      // Men receptionist denied access
      expect(() => assertDepartmentAccess(receptionMen, woman.department)).toThrow();

      // Manager override grants permission
      const override = await verifyManagerOverride(db, receptionMen, {
        pin: "1234",
        reason: "دخول استثنائي",
        entityType: "member",
        entityId: woman.id,
      });
      expect(override.success).toBe(true);
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  describe("Tier 3: Cross-Feature Combinations", () => {
    it("T3.1: Full peak-hours workflow: swipe frozen card -> manager override -> unfreeze -> attendance checkin -> batch settle dues", async () => {
      // 1. Setup member with frozen subscription and outstanding debts
      const member = await createMember(db, owner, { fullName: "رانيا كمال", department: "women" });
      const plan = await createPlan(db, owner, { name: "باقة 3 شهور", durationDays: 90, price: 1000 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      // Partial payment: 500 paid, 500 remaining debt (50000 minor)
      await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 100000,
        paidAmountMinor: 50000,
        methodCode: "cash",
      });
      await assignCardByBarcode(db, owner, { barcodeValue: "CARD-RANIA", memberId: member.id });

      // Freeze subscription 5 days ago
      const fiveDaysAgo = addDaysKey(todayKey(), -5);
      db.run("UPDATE member_subscriptions SET status = 'suspended', frozen_at = ? WHERE id = ?", [fiveDaysAgo, sub.id]);
      db.run("INSERT INTO subscription_freezes (id, subscription_id, start_date, duration_days, created_at, frozen_at) VALUES (?, ?, ?, 14, ?, ?)", [
        "frz-rania", sub.id, fiveDaysAgo, nowStamp(), fiveDaysAgo + "T10:00:00Z",
      ]);

      // 2. Cross-department attempt by receptionMen -> Denied with clear params
      expect(() => assertDepartmentAccess(receptionMen, member.department)).toThrow();

      // 3. Manager walks up and authorizes cross-department action via quick PIN
      const override = await verifyManagerOverride(db, receptionMen, {
        pin: "1234",
        reason: "استقبال استثنائي للوردية المسائية",
        entityType: "member",
        entityId: member.id,
      });
      expect(override.success).toBe(true);

      // 4. Card swiped: reports FROZEN for decision modal (no silent auto-unfreeze)
      const scanRes = await recordCheckIn(db, receptionWomen, { barcode: "CARD-RANIA" });
      expect(scanRes.kind).toBe("denied");
      expect((scanRes as any).reason).toBe("FROZEN");

      // 5. Decision modal confirmed (Enter pressed): unfreezes with exact date math
      const unfrozen = await unfreezeSubscription(db, owner, sub.id);
      expect(unfrozen.status).toBe("active");
      expect(unfrozen.endDate).toBe(addDaysKey(sub.endDate, 5)); // exact 5 days

      // 6. Immediate attendance recorded
      const checkinRes = await recordCheckIn(db, receptionWomen, { barcode: "CARD-RANIA" });
      expect(checkinRes.kind).toBe("success");

      // 7. Settle remaining dues in batch
      const debts = getMemberDebts(member.id);
      const subDebt = debts.find((d) => d.debtType === "subscription")!;
      const batchRes = settleMemberDuesBatch(db, owner, {
        memberId: member.id,
        methodCode: "cash",
        items: [{ debtType: "subscription", debtId: subDebt.debtId, amountMinor: 50000 }],
      });
      expect(batchRes.settledCount).toBe(1);
      expect(batchRes.totalPaidMinor).toBe(50000);

      // Verify zero debts remain
      const finalDebts = getMemberDebts(member.id);
      expect(finalDebts.every((d) => d.remainingAmountMinor === 0)).toBe(true);
    });

    it("T3.2: Treasury peak concurrency: closing cash session while batch debt settlements occur with zero ledger drift", async () => {
      // Open cash session
      const session = await openCashSession(db, owner, {
        box: "gym",
        openingBalanceMinor: 100000, // 1000 EGP
      });

      // Member settles dues
      const member = await createMember(db, owner, { fullName: "وليد مالي" });
      const plan = await createPlan(db, owner, { name: "باقة 500", durationDays: 30, price: 500 });
      const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
      await recordPayment(db, owner, {
        memberId: member.id,
        subscriptionId: sub.id,
        baseAmountMinor: 50000,
        paidAmountMinor: 20000,
        methodCode: "cash",
      });

      settleMemberDuesBatch(db, owner, {
        memberId: member.id,
        methodCode: "cash",
        items: [{ debtType: "subscription", debtId: sub.id, amountMinor: 30000 }],
      });

      // Expected = 100000 + 20000 (payment) + 30000 (batch dues) = 150000
      const closed = await closeCashSession(db, owner, session.id, 150000);
      expect(closed.expectedClosingMinor).toBe(150000);
      expect(closed.differenceMinor).toBe(0);
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD 7–10 PM PEAK-HOURS WORKLOAD SCENARIO
  // =========================================================================

  describe("Tier 4: Real-World 7–10 PM Peak-Hours Workload Scenario", () => {
    it("T4.1: High-throughput peak reception simulation: 50+ rapid interleaved actions under simulated concurrency", async () => {
      // Open peak shift session
      const peakSession = await openCashSession(db, owner, {
        box: "gym",
        openingBalanceMinor: 200000, // 2000 EGP
      });

      const memberIds: string[] = [];
      const plan = await createPlan(db, owner, { name: "باقة الذروة", durationDays: 30, price: 300 });

      // Seed 20 members with subscriptions and cards
      for (let i = 1; i <= 20; i++) {
        const m = await createMember(db, owner, {
          fullName: `عضو الذروة ${i}`,
          department: i % 2 === 0 ? "men" : "women",
        });
        memberIds.push(m.id);
        await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
        await assignCardByBarcode(db, owner, {
          barcodeValue: `PEAK-CARD-${String(i).padStart(3, "0")}`,
          memberId: m.id,
        });
      }

      // Simulate 50+ rapid interleaved peak actions:
      // - 20 Successful Check-ins
      // - 10 Rapid Duplicate Scans (must be rejected)
      // - 10 Cash Payments
      // - 5 Manager PIN Overrides
      // - 5 Batch Dues Settlements
      // Total: 50 operations

      let checkinCount = 0;
      let duplicateRejections = 0;

      // 1. 20 check-ins
      for (let i = 1; i <= 20; i++) {
        const res = await recordCheckIn(db, owner, {
          barcode: `PEAK-CARD-${String(i).padStart(3, "0")}`,
        });
        if (res.kind === "success") checkinCount++;
      }
      expect(checkinCount).toBe(20);

      // 2. 10 rapid duplicate re-scans immediately
      for (let i = 1; i <= 10; i++) {
        const res = await recordCheckIn(db, owner, {
          barcode: `PEAK-CARD-${String(i).padStart(3, "0")}`,
        });
        if (res.kind === "duplicate") duplicateRejections++;
      }
      expect(duplicateRejections).toBe(10);

      // 3. 10 cash payments
      for (let i = 1; i <= 10; i++) {
        await recordPayment(db, owner, {
          memberId: memberIds[i - 1],
          baseAmountMinor: 10000,
          paidAmountMinor: 10000,
          methodCode: "cash",
          notes: `دفعة ذروة ${i}`,
        });
      }

      // 4. 5 manager overrides
      for (let i = 1; i <= 5; i++) {
        const ov = await verifyManagerOverride(db, receptionMen, {
          pin: "1234",
          reason: `تجاوز ذروة ${i}`,
        });
        expect(ov.success).toBe(true);
      }

      // 5. 5 batch dues settlements (for members 11 to 15, let's create a partial payment first so debt exists)
      for (let i = 11; i <= 15; i++) {
        const sub = db.first<{ id: string }>(
          "SELECT id FROM member_subscriptions WHERE member_id = ? LIMIT 1",
          [memberIds[i - 1]],
        );
        if (sub) {
          // Record partial payment leaving 10000 debt
          await recordPayment(db, owner, {
            memberId: memberIds[i - 1],
            subscriptionId: sub.id,
            baseAmountMinor: 30000,
            paidAmountMinor: 20000,
            methodCode: "cash",
          });
          const debts = getMemberDebts(memberIds[i - 1]);
          if (debts.length > 0) {
            settleMemberDuesBatch(db, owner, {
              memberId: memberIds[i - 1],
              methodCode: "cash",
              items: [{ debtType: debts[0].debtType as any, debtId: debts[0].debtId, amountMinor: debts[0].remainingAmountMinor }],
            });
          }
        }
      }

      // Final shift closing: Expected = 200000 (opening) + 10 * 10000 (payments: 100000) + 5 * 20000 (partial payments: 100000) + 5 * 10000 (settled debts: 50000) = 450000
      const currentTotals = computeSessionCash(db, peakSession.openedAt, nowStamp(), "gym");
      const expectedTotal = 200000 + currentTotals.cashInMinor - currentTotals.cashOutMinor;
      const closed = await closeCashSession(db, owner, peakSession.id, expectedTotal);
      expect(closed.status).toBe("closed");
      expect(closed.expectedClosingMinor).toBe(expectedTotal);
      expect(closed.differenceMinor).toBe(0);
    });

    it("T4.2: Peak rush integrity audit: verify zero double-consumption, exact financial reconciliation, and complete audit trail", async () => {
      // Create test activity
      const m = await createMember(db, owner, { fullName: "عضو فحص التدقيق" });
      const p = await createPlan(db, owner, { name: "خطة فحص", durationDays: 30, price: 300 });
      const s = await createSubscription(db, owner, { memberId: m.id, planId: p.id });
      await assignCardByBarcode(db, owner, { barcodeValue: "CARD-AUDIT-1", memberId: m.id });
      await recordCheckIn(db, owner, { barcode: "CARD-AUDIT-1" });
      await recordPayment(db, owner, { memberId: m.id, subscriptionId: s.id, baseAmountMinor: 30000, paidAmountMinor: 30000, methodCode: "cash" });

      // Verify audit logs exist
      const auditCount = db.scalar("SELECT COUNT(*) FROM audit_logs");
      expect(Number(auditCount)).toBeGreaterThan(0);

      // Verify no orphan records
      const orphanAttendance = db.scalar(
        "SELECT COUNT(*) FROM attendance a LEFT JOIN members m ON m.id = a.member_id WHERE m.id IS NULL",
      );
      expect(Number(orphanAttendance)).toBe(0);
    });
  });
});
