# Reception Peak-Hours (7–10 PM) Test Infrastructure & Architecture (TEST_INFRA.md)

## 1. Overview & Objective
This document outlines the testing infrastructure, verification methodology, and contract specifications for the **8 Reception Peak-Hours Operational & Architectural Enhancements (R1–R9)** in GymGate (جيم جيت).

The test suite in `tests/e2e-reception-peak-hours.test.ts` provides an end-to-end, opaque-box verification layer guaranteeing operational stability, data integrity, and sub-millisecond responsiveness during the most demanding gym operational window (7:00 PM – 10:00 PM peak rush).

---

## 2. Architecture Under Test

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Reception & Treasury Frontend Tier                   │
│  - Barcode Burst Detection (<50ms inter-key) & Scanner Autofocus      │
│  - 3-Second Client-Side Scanning Cooldown Lock                        │
│  - Front Desk Keyboard Shortcuts (F1–F4)                              │
│  - Search Debounce (250ms) & KPI Query Decoupling                     │
│  - Frozen Subscription Decision Modal (Enter=Unfreeze, Esc=Inspect)   │
│  - Payment Submit Lock & Fast Parallel Balance Queries                │
│  - In-Place Manager PIN / Credential Override Modal                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ RPC / Service Layer
┌───────────────────────────────────▼────────────────────────────────────┐
│                       Core Services & Business Logic                   │
│  - attendance.service.ts: Atomic checkin + CHECKIN_DUPLICATE_SENTINEL  │
│  - subscriptions.service.ts: Freeze date math (no +1 overcompensation) │
│  - cash-session.service.ts: Atomic shift close inside BEGIN IMMEDIATE   │
│  - debts.service.ts: settleMemberDuesBatch (All-or-Nothing atomicity)   │
│  - department.ts: assertDepartmentAccess with detailed error params    │
│  - manager-override.service.ts: PIN & password verification + audit    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ SQLite Driver (WAL mode)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Database & Platform Infrastructure                  │
│  - Migration v66: 5 Composite Indexes                                  │
│    * idx_cards_barcode_status (barcode_value, status)                  │
│    * idx_subs_member_status_dates (member_id, status, start/end_date)  │
│    * idx_attendance_member_checkin (member_id, checkin_at DESC)        │
│    * idx_payments_sub_status (subscription_id, status)                 │
│    * idx_cash_sessions_box_opened (box, opened_at DESC)               │
│  - Package Engines: Node >= 22.5.0 (node:sqlite DatabaseSync support)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 4-Tier Test Methodology

The test suite is structured into 4 distinct testing tiers:

### Tier 1: Feature Coverage (>=5 test cases per feature area)
1. **R1: Barcode Scanner Autofocus Resilience & Burst Hardware Input**
   - Burst detection (<50ms intervals ending in Enter) captures scans even when focus is in inputs.
   - Input marked with `data-scanner-input="true"` participates in scanner capture.
   - Human slow typing (>50ms) in ordinary inputs does not trigger false barcode submissions.
   - Arabic-to-English keyboard layout normalization maps Arabic keystrokes to ASCII barcodes.
   - Client-side scan cooldown (3s) rejects rapid re-scans of the same barcode.

2. **R2: Atomic Attendance Check-in & Idempotency Window**
   - Enforce duplicate check-in detection inside SQLite transaction with `CHECKIN_DUPLICATE_SENTINEL`.
   - Prevent double-consumption of session packages on rapid double-swipes.
   - Duplicate window configurable (`duplicateWindowSeconds`) with safe defaults.
   - Trial check-in enforces duplicate window inside write transaction.
   - Denials returned with exact denial reasons (e.g. `CARD_UNKNOWN`, `NO_ACTIVE_SUBSCRIPTION`, `NO_SESSIONS_LEFT`).

3. **R3: Frozen Subscription Decision Modal & Accurate Date Compensation**
   - Frozen subscription is not automatically unfrozen without explicit confirmation.
   - Inspection mode leaves subscription safely suspended and returns `FROZEN` status.
   - Date math correction: multi-day freeze calculates exact missed days without `+1` day overcompensation.
   - Same-day freeze and unfreeze awards exactly 0 days extension (anti-gaming safeguard).
   - Planned freeze duration cap is strictly respected.

4. **R4: Search Debounce & KPI Decoupling**
   - Debounce utility standardizes 250ms delay across search inputs.
   - Member search keystrokes do not trigger redundant 5 KPI summary requests.
   - Subscriptions search debounces queries at 250ms.
   - Cash sessions list defaults `fromKey` and `toKey` to `todayKey()`.
   - Clear search restores immediate result set without lag.

5. **R5: Atomic Shift Closing in Treasury**
   - `computeSessionCash` executes inside `BEGIN IMMEDIATE` transaction write lock.
   - Zero ledger drift: transactions committed prior to write lock are accurately reflected.
   - Exact discrepancy calculation (`difference = counted - expected`).
   - Discrepancy audits (`CASH_DISCREPANCY` and `CASH_SESSION_CLOSED`) recorded correctly.
   - Negative expected balance or unclosed session errors handled safely.

6. **R6: Payment Submit Lock & Batch Dues Settlement**
   - Submit lock prevents duplicate payment submissions on rapid double-clicks.
   - Parallel subscription balance fetching resolves balances concurrently.
   - `settleMemberDuesBatch` settles multiple subscription and store debts in a single transaction.
   - Batch dues settlement writes financial ledger entries atomically.
   - Full rollback: if one debt settlement in batch fails, all previous settlements in the batch are rolled back.

7. **R7: Department Access Clarity & Manager PIN Override**
   - `assertDepartmentAccess` throws `errForbidden("errors.departmentAccessDenied", { memberDept, userDept })`.
   - Manager PIN override grants cross-department access in-place.
   - Manager username/password override verifies active user and role permissions.
   - Invalid PIN or non-manager credentials rejected with clear unauthorized/forbidden errors.
   - Every manager override logs `MANAGER_OVERRIDE` in `audit_log` with target details.

8. **R8: Database Migration v66 & Package Engine Field**
   - Migration `v66` applies cleanly to SQLite database.
   - 5 composite indexes created with exact column signatures.
   - `package.json` specifies `"engines": { "node": ">=22.5.0" }`.
   - Query planner confirms index utilization for barcode, subscription, attendance, payment, and cash lookups.
   - Schema migration version counter correctly reaches 66.

9. **R9: Front Desk Keyboard Shortcuts (F1–F4)**
   - F1 triggers search input focus and selects contents.
   - F2 opens 1-click subscription renewal modal.
   - F3 opens Quick Day Pass modal.
   - F4 opens Payment / Settle dues modal.
   - Hotkeys respect open modal state and prevent default browser actions.

---

### Tier 2: Boundary & Corner Cases
1. **Zero & 3-Second Scanning Window**: Identical millisecond timestamp duplicate scans rejected even when `windowSeconds = 0`.
2. **Same-Day vs Multi-Day Freeze Extension**: Precise date boundary math verification.
3. **Batch Debt Overpayment & Invalid Debt ID**: Verifies complete transaction rollback when amount exceeds balance or debt ID is corrupt.
4. **Manager Override Security Extremes**: Wrong PIN, empty PIN, wrong password, inactive manager account, non-manager staff trying to override.
5. **Department Cross-Access Boundaries**: General department staff, men-only staff, women-only staff, and manager overrides across sections.

---

### Tier 3: Cross-Feature Combinations
1. **Frozen Card Swipe + Manager Override + Unfreeze + Immediate Check-in + Debt Settlement**: End-to-end multi-module operational workflow.
2. **Concurrent Cash Closing & Batch Debt Settlement**: Closing cash drawer while dues settlements execute, guaranteeing zero discrepancy drift.

---

### Tier 4: Real-World 7–10 PM Peak-Hours Workload Scenario
- Simulates rapid sequential and interleaved actions across 50+ operations (30 check-ins, 10 store sales, 5 dues settlements, 3 overrides, and final shift close).
- Confirms zero database corruption, zero session double-consumption, and zero cash ledger variance.

---

## 4. Test Execution & Verification Command
```bash
npx vitest run tests/e2e-reception-peak-hours.test.ts
```
