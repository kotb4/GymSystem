import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  freezeSubscription,
  unfreezeSubscription,
} from "@/core/services/subscriptions.service";
import { assignCardByBarcode } from "@/core/services/cards.service";
import {
  recordCheckIn,
  duplicateWindowSeconds,
  consumeSession,
} from "@/core/services/attendance.service";
import {
  attachGlobalBarcodeScanner,
  normalizeBarcodeString,
} from "@/core/barcode/barcode-input";
import { diffDaysKeys, addDaysKey, todayKey } from "@/core/dates";

describe("Adversarial Stress Test: Peak Reception & Scanner Operations", () => {
  let db: Db;
  let admin: ServiceActor;

  beforeEach(async () => {
    db = createTestDb();
    admin = buildActor(
      await setup(db, {
        gymName: "GymGate Stress Test",
        ownerFullName: "Test Admin",
        username: "admin",
        password: "Admin@2026",
      }),
    );
  });

  // =========================================================================
  // SUITE 1: Hardware Barcode Scanner Bursts & Typing Target Isolation
  // =========================================================================
  describe("Suite 1: Hardware Scanner Bursts & Input Leak Cleanup", () => {
    let cleanup: (() => void) | null = null;
    let windowListeners: Record<string, ((e: any) => void)[]> = {};

    class MockInputElement {
      tagName = "INPUT";
      dataset: Record<string, string> = {};
      value = "member-query-";
      isContentEditable = false;
      dispatchEvent = vi.fn();
    }

    beforeEach(() => {
      windowListeners = {};
      (globalThis as any).HTMLElement = MockInputElement;
      (globalThis as any).HTMLInputElement = MockInputElement;
      (globalThis as any).HTMLTextAreaElement = class {};
      (globalThis as any).Event = class {
        constructor(public type: string, public init?: any) {}
      };
      // Mock minimal window & DOM events in node environment
      (globalThis as any).window = {
        addEventListener: (event: string, handler: (e: any) => void) => {
          if (!windowListeners[event]) windowListeners[event] = [];
          windowListeners[event].push(handler);
        },
        removeEventListener: (event: string, handler: (e: any) => void) => {
          if (!windowListeners[event]) return;
          windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
        },
      };
      (globalThis as any).performance = {
        now: vi.fn(() => Date.now()),
      };
    });

    afterEach(() => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    });

    it("captures rapid hardware bursts (<50ms) and cleanses leaked input from regular text inputs", () => {
      const scannedCodes: string[] = [];
      cleanup = attachGlobalBarcodeScanner((code) => {
        scannedCodes.push(code);
      });

      const keydownHandler = windowListeners["keydown"]?.[0];
      expect(keydownHandler).toBeDefined();

      // Create a mock regular HTMLInputElement
      const mockInput = new MockInputElement();

      let simulatedTime = 1000;
      (globalThis as any).performance.now = vi.fn(() => simulatedTime);

      const barcodeToScan = "B1-CRD-00042";

      // Simulate scanner burst: 15ms interval between characters, ending in Enter
      for (let i = 0; i < barcodeToScan.length; i++) {
        const char = barcodeToScan[i];
        simulatedTime += 15;
        // The hardware scanner types characters directly into the focused element
        mockInput.value += char;

        const event = {
          key: char,
          code: char >= "A" && char <= "Z" ? `Key${char}` : char >= "0" && char <= "9" ? `Digit${char}` : "Minus",
          target: mockInput,
          repeat: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        };
        keydownHandler(event);
      }

      // Scanner sends Enter key within 30ms of last character
      simulatedTime += 20;
      const enterEvent = {
        key: "Enter",
        code: "Enter",
        target: mockInput,
        repeat: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      keydownHandler(enterEvent);

      // 1. Enter key must have preventDefault() and stopPropagation() called
      expect(enterEvent.preventDefault).toHaveBeenCalled();
      expect(enterEvent.stopPropagation).toHaveBeenCalled();

      // 2. Barcode callback must have received the scanned code
      expect(scannedCodes).toHaveLength(1);
      expect(scannedCodes[0]).toBe("B1-CRD-00042");

      // 3. Leaked barcode characters must be removed from the normal input!
      expect(mockInput.value).toBe("member-query-");
      expect(mockInput.dispatchEvent).toHaveBeenCalled();
    });

    it("does NOT treat human typing (>50ms interval) as scanner burst", () => {
      const scannedCodes: string[] = [];
      cleanup = attachGlobalBarcodeScanner((code) => {
        scannedCodes.push(code);
      });

      const keydownHandler = windowListeners["keydown"]?.[0];
      const mockInput = new MockInputElement();
      mockInput.value = "user typing";

      let simulatedTime = 2000;
      (globalThis as any).performance.now = vi.fn(() => simulatedTime);

      const userTyped = "ABCDE";
      for (const char of userTyped) {
        simulatedTime += 90; // human interval: 90ms > 50ms threshold
        mockInput.value += char;
        keydownHandler({
          key: char,
          code: `Key${char}`,
          target: mockInput,
          repeat: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });
      }

      simulatedTime += 100;
      const enterEvent = {
        key: "Enter",
        code: "Enter",
        target: mockInput,
        repeat: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      keydownHandler(enterEvent);

      // Human typing must NOT trigger scanner callback
      expect(scannedCodes).toHaveLength(0);
      // Human typing must NOT be wiped from input
      expect(mockInput.value).toBe("user typingABCDE");
    });

    it("normalizes Arabic keyboard layout characters including ligatures and numbers", () => {
      // Arabic layout typing B1-MEM-000001
      // B = 'لا' (Lam-Alef), 1 = '1' or '١', M = 'ة', E = 'ث'
      const arabicBarcode = "لا1-ةثة-٠٠٠٠٠١";
      const normalized = normalizeBarcodeString(arabicBarcode);
      expect(normalized).toBe("B1-MEM-000001");
    });
  });

  // =========================================================================
  // SUITE 2: Double-Swipe Invariants, Concurrency & Session Package Deductions
  // =========================================================================
  describe("Suite 2: Session Package Double-Swipe & Timestamp Edge Invariants", () => {
    async function setupMemberWithSessions(sessionsTotal: number) {
      const member = await createMember(db, admin, {
        fullName: "Test Session Member " + Math.random().toString(36).slice(2, 6),
        phone: "010" + Math.floor(10000000 + Math.random() * 90000000),
      });
      const plan = await createPlan(db, admin, {
        name: "Sessions Plan " + Math.random().toString(36).slice(2, 6),
        kind: "sessions",
        durationDays: 30,
        price: 500,
        sessionsCount: sessionsTotal,
      });
      const sub = await createSubscription(db, admin, {
        memberId: member.id,
        planId: plan.id,
      });
      const barcode = "B1-SESS-" + Math.floor(100000 + Math.random() * 900000);
      const { card } = await assignCardByBarcode(db, admin, {
        barcodeValue: barcode,
        memberId: member.id,
      });
      return { memberId: member.id, subId: sub.id, cardId: card.id, barcode };
    }

    it("strictly deducts exactly 1 session on rapid double-swipe, even under loop stress", async () => {
      const { memberId, subId, barcode } = await setupMemberWithSessions(10);

      // Verify initial state
      let sub = db.first<{ sessions_used: number }>(
        "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
        [subId]
      );
      expect(sub?.sessions_used).toBe(0);

      // 1st scan: must succeed
      const firstRes = await recordCheckIn(db, admin, { barcode });
      expect(firstRes.kind).toBe("success");
      if (firstRes.kind === "success") {
        expect(firstRes.sessionsRemaining).toBe(9);
      }

      // Check DB after 1st scan
      sub = db.first<{ sessions_used: number }>(
        "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
        [subId]
      );
      expect(sub?.sessions_used).toBe(1);

      // 50 rapid sequential scans in a loop (simulating rapid barcode clicks / bounce)
      for (let i = 0; i < 50; i++) {
        const dupRes = await recordCheckIn(db, admin, { barcode });
        expect(dupRes.kind).toBe("duplicate");
      }

      // DB check: sessions_used MUST remain 1, exactly 1 attendance row
      sub = db.first<{ sessions_used: number }>(
        "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
        [subId]
      );
      expect(sub?.sessions_used).toBe(1);

      const attendanceCount = db.scalar(
        "SELECT COUNT(*) FROM attendance WHERE member_id = ? AND deleted_at IS NULL",
        [memberId]
      );
      expect(Number(attendanceCount)).toBe(1);
    });

    it("rejects duplicate scan even when windowSeconds = 0 if check-in timestamp is identical", async () => {
      const { memberId, subId, barcode } = await setupMemberWithSessions(5);

      // Set duplicate window to 0 seconds in settings
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('checkin_duplicate_window_seconds', '0')");
      expect(duplicateWindowSeconds(db)).toBe(0);

      // First check-in
      const res1 = await recordCheckIn(db, admin, { barcode });
      expect(res1.kind).toBe("success");

      // Fetch the timestamp of res1
      const lastAtt = db.first<{ checkin_at: string }>(
        "SELECT checkin_at FROM attendance WHERE member_id = ? ORDER BY checkin_at DESC LIMIT 1",
        [memberId]
      );
      expect(lastAtt).toBeDefined();

      // Second check-in immediately executed. Because nowStamp() within the same millisecond/second
      // yields the identical stamp, it must be flagged as duplicate by `lastVisit.checkin_at === currentTxStamp`
      const res2 = await recordCheckIn(db, admin, { barcode });
      expect(res2.kind).toBe("duplicate");

      // Verify sessions consumed is still 1
      const sub = db.first<{ sessions_used: number }>(
        "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
        [subId]
      );
      expect(sub?.sessions_used).toBe(1);
    });

    it("handles last session exhaustion correctly on duplicate scan", async () => {
      // Member with exactly 1 session left
      const { memberId, subId, barcode } = await setupMemberWithSessions(1);

      // 1st scan consumes the 1 remaining session
      const res1 = await recordCheckIn(db, admin, { barcode });
      expect(res1.kind).toBe("success");
      if (res1.kind === "success") {
        expect(res1.sessionsRemaining).toBe(0);
      }

      // 2nd scan within window: sessionsRemaining is now 0, so recordCheckIn denies entry (NO_SESSIONS_LEFT)
      // or returns duplicate, but under NO circumstances allows an additional session deduction.
      const res2 = await recordCheckIn(db, admin, { barcode });
      expect(["duplicate", "denied"]).toContain(res2.kind);
      if (res2.kind === "denied") {
        expect(res2.reason).toBe("NO_SESSIONS_LEFT");
      }

      // CRITICAL INVARIANT: Ensure sessions_used remains strictly 1 (NOT 2)
      const sub = db.first<{ sessions_used: number }>(
        "SELECT sessions_used FROM member_subscriptions WHERE id = ?",
        [subId]
      );
      expect(sub?.sessions_used).toBe(1);
    });
  });

  // =========================================================================
  // SUITE 3: Frozen Subscriptions & Exact Date Math Oracle
  // =========================================================================
  describe("Suite 3: Frozen Subscription Integrity & Date Compensation Math", () => {
    async function setupFrozenMember(freezeStartDate: string, plannedDurationDays: number) {
      const member = await createMember(db, admin, {
        fullName: "Frozen Member " + Math.random().toString(36).slice(2, 6),
        phone: "011" + Math.floor(10000000 + Math.random() * 90000000),
      });
      const plan = await createPlan(db, admin, {
        name: "Time Plan " + Math.random().toString(36).slice(2, 6),
        kind: "time",
        durationDays: 30,
        price: 500,
      });
      const sub = await createSubscription(db, admin, {
        memberId: member.id,
        planId: plan.id,
      });
      const barcode = "B1-FRZ-" + Math.floor(100000 + Math.random() * 900000);
      const { card } = await assignCardByBarcode(db, admin, {
        barcodeValue: barcode,
        memberId: member.id,
      });
      const freezeEnd = addDaysKey(todayKey(), plannedDurationDays - 1);
      await freezeSubscription(db, admin, sub.id, {
        endDate: freezeEnd,
      });
      if (freezeStartDate !== todayKey()) {
        db.run("UPDATE subscription_freezes SET start_date = ?, duration_days = ? WHERE subscription_id = ?", [
          freezeStartDate,
          plannedDurationDays,
          sub.id,
        ]);
      }
      return { memberId: member.id, subId: sub.id, cardId: card.id, barcode, initialEndDate: sub.endDate };
    }

    it("strictly prevents card swipe from automatically unfreezing subscription", async () => {
      const today = todayKey();
      const { memberId, subId, barcode } = await setupFrozenMember(today, 14);

      // Attempt check-in
      const res = await recordCheckIn(db, admin, { barcode });

      // Invariant: kind must be 'denied', reason must be 'FROZEN'
      expect(res.kind).toBe("denied");
      if (res.kind === "denied") {
        expect(res.reason).toBe("FROZEN");
      }

      // Invariant: subscription in DB MUST remain suspended
      const sub = db.first<{ status: string; frozen_at: string | null }>(
        "SELECT status, frozen_at FROM member_subscriptions WHERE id = ?",
        [subId]
      );
      expect(sub?.status).toBe("suspended");
      expect(sub?.frozen_at).not.toBeNull();

      // Invariant: zero attendance records created
      const attCount = db.scalar(
        "SELECT COUNT(*) FROM attendance WHERE member_id = ?",
        [memberId]
      );
      expect(Number(attCount)).toBe(0);
    });

    it("evaluates date math oracle: exact elapsed days without +1 day overcompensation", async () => {
      const today = todayKey();

      // Case 1: Same day freeze and unfreeze (diff = 0)
      const c1 = await setupFrozenMember(today, 10);
      const unfreeze1 = await unfreezeSubscription(db, admin, c1.subId);
      expect(unfreeze1.status).toBe("active");
      // End date must NOT have changed (+0 days)
      expect(unfreeze1.endDate).toBe(c1.initialEndDate);

      // Case 2: Frozen yesterday (diff = 1 day)
      const yesterday = addDaysKey(today, -1);
      const c2 = await setupFrozenMember(yesterday, 10);
      const unfreeze2 = await unfreezeSubscription(db, admin, c2.subId);
      expect(unfreeze2.status).toBe("active");
      // End date must be extended by EXACTLY 1 day (diffDaysKeys(yesterday, today) = 1)
      const expectedEnd2 = addDaysKey(c2.initialEndDate, 1);
      expect(unfreeze2.endDate).toBe(expectedEnd2);

      // Case 3: Frozen 5 days ago (diff = 5 days)
      const fiveDaysAgo = addDaysKey(today, -5);
      const c3 = await setupFrozenMember(fiveDaysAgo, 10);
      const unfreeze3 = await unfreezeSubscription(db, admin, c3.subId);
      expect(unfreeze3.status).toBe("active");
      const expectedEnd3 = addDaysKey(c3.initialEndDate, 5);
      expect(unfreeze3.endDate).toBe(expectedEnd3);

      // Case 4: Capped at planned duration (diff = 15 days, cap = 7 days)
      const fifteenDaysAgo = addDaysKey(today, -15);
      const c4 = await setupFrozenMember(fifteenDaysAgo, 7);
      const unfreeze4 = await unfreezeSubscription(db, admin, c4.subId);
      expect(unfreeze4.status).toBe("active");
      // Must cap extension at 7 days!
      const expectedEnd4 = addDaysKey(c4.initialEndDate, 7);
      expect(unfreeze4.endDate).toBe(expectedEnd4);
    });
  });

  // =========================================================================
  // SUITE 4: Front Desk Keyboard Shortcuts F1–F4 Simulation
  // =========================================================================
  describe("Suite 4: Front Desk Hotkeys F1–F4 Invariants", () => {
    it("handles hotkey actions and honors modal suppression", () => {
      let isAnyModalOpen = false;
      let selectedMember: any = null;
      let subModalOpen = false;
      let dayPassOpen = false;
      let payModalOpen = false;
      let inputFocused = false;
      let inputSelected = false;
      const toasts: { type: string; msg: string }[] = [];

      const mockInput = {
        focus: () => { inputFocused = true; },
        select: () => { inputSelected = true; },
      };

      const toast = (type: string, msg: string) => {
        toasts.push({ type, msg });
      };

      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === "F1") {
          e.preventDefault();
          if (!isAnyModalOpen) {
            mockInput.focus();
            mockInput.select();
          }
          return;
        }

        if (isAnyModalOpen) return;

        if (e.key === "F2") {
          e.preventDefault();
          if (selectedMember) {
            subModalOpen = true;
          } else {
            toast("info", "يرجى تحديد أو مسح عضو أولاً لتجديد الاشتراك");
          }
        } else if (e.key === "F3") {
          e.preventDefault();
          dayPassOpen = true;
        } else if (e.key === "F4") {
          e.preventDefault();
          if (selectedMember) {
            payModalOpen = true;
          } else {
            toast("info", "يرجى تحديد أو مسح عضو أولاً لتسجيل دفعة أو تسوية مستحقات");
          }
        }
      };

      // Test F1 without modal: focuses and selects input
      const p1 = vi.fn();
      handleKeyDown({ key: "F1", preventDefault: p1 });
      expect(p1).toHaveBeenCalled();
      expect(inputFocused).toBe(true);
      expect(inputSelected).toBe(true);

      // Test F2, F3, F4 without selected member
      handleKeyDown({ key: "F2", preventDefault: vi.fn() });
      expect(subModalOpen).toBe(false);
      expect(toasts.some(t => t.msg.includes("لتجديد الاشتراك"))).toBe(true);

      handleKeyDown({ key: "F3", preventDefault: vi.fn() });
      expect(dayPassOpen).toBe(true);

      handleKeyDown({ key: "F4", preventDefault: vi.fn() });
      expect(payModalOpen).toBe(false);
      expect(toasts.some(t => t.msg.includes("لتسجيل دفعة"))).toBe(true);

      // Select member and test F2 and F4
      selectedMember = { id: "mem-1", name: "Ahmed" };
      handleKeyDown({ key: "F2", preventDefault: vi.fn() });
      expect(subModalOpen).toBe(true);

      handleKeyDown({ key: "F4", preventDefault: vi.fn() });
      expect(payModalOpen).toBe(true);

      // Now set isAnyModalOpen = true and verify F1..F4 are suppressed
      isAnyModalOpen = true;
      inputFocused = false;
      subModalOpen = false;
      dayPassOpen = false;
      payModalOpen = false;

      handleKeyDown({ key: "F1", preventDefault: vi.fn() });
      expect(inputFocused).toBe(false);

      handleKeyDown({ key: "F2", preventDefault: vi.fn() });
      expect(subModalOpen).toBe(false);

      handleKeyDown({ key: "F3", preventDefault: vi.fn() });
      expect(dayPassOpen).toBe(false);

      handleKeyDown({ key: "F4", preventDefault: vi.fn() });
      expect(payModalOpen).toBe(false);
    });
  });
});
