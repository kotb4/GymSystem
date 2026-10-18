# GymGate Subsystems Modernization — Test Infrastructure & Architecture

## 1. Test Architecture Overview

The end-to-end (E2E) test suite for the GymGate 7-Subsystem Modernization initiative is built upon a deterministic, opaque-box, requirement-driven verification architecture.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Vitest E2E Test Suite                          │
│             (tests/e2e-subsystems-modernization.test.ts)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Backend Service Layer (RPC)                       │
│ cash-session · store · classes · subscriptions · reception · audit ... │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                In-Memory Node SQLite Driver (WAL Mode)                 │
│              Full Append-Only Migrations v1..v63 Applied               │
│               Role Permissions Grants Cache Initialized                │
└────────────────────────────────────────────────────────────────────────┘
```

### Core Design Principles:
1. **Zero Facade / Strict Opaque-Box Execution**: Tests exercise actual production business logic, database transactions (`db.transaction`), financial ledger integrity rules, and permission checks (`requirePermission`).
2. **Absolute State Isolation**: Every single test initializes a fresh in-memory SQLite database instance via `createTestDb()`, running all 63 migrations (`v1..v63`) from scratch. Tests never share mutable state or depend on run order.
3. **Role & Permission Fidelity**: Realistic `ServiceActor` profiles (`owner`, `manager`, `reception`, `trainer`) are provisioned via `setup()` and `createUser()`. The in-memory role-permissions grant cache is populated via `loadPermissionsCache(db)`.
4. **Append-Only Migration Compliance**: Zero alterations to schema migrations `v1..v63`.
5. **Deterministic Monetary & Time Standards**: All money computations operate in integer minor units (piastres, 100 = 1 EGP). Time formatting is tested against the Arabic 12-hour AM/PM standard (`formatTime12`).

---

## 2. Feature Inventory to Test Mapping

The test suite thoroughly maps and validates all 7 modernized subsystems specified in `ORIGINAL_REQUEST.md` and `PROJECT.md`:

| Subsystem # | Subsystem Name | Covered Features & Requirements | Test Suite Group in E2E Suite |
|-------------|----------------|---------------------------------|-------------------------------|
| **Subsystem 1** | **المالية والخزينة الموحدة**<br>(Financial & Treasury Hub) | - F1.1 Treasury Hub Telemetry & Drawer Float<br>- F1.2 1-Click End of Shift / Daily Z-Report<br>- F1.3 Payment Recording & Ledger Uniqueness<br>- F1.4 Payment Refund & Voiding Double-Reversal Guard<br>- F1.5 Expense Categories & Cash Outflows<br>- F1.6 Finance Overview Collections & Net Cash<br>- F1.7 12-Hour AM/PM Treasury Time Formatting | `Tier 1.1: Financial & Treasury Hub Modernization`<br>(Tests: `F1.1` to `F1.7`) |
| **Subsystem 2** | **المتجر ونقاط البيع السريعة والمخزون**<br>(Store, POS & Inventory) | - F2.1 Product Catalog & Low-Stock Alerts<br>- F2.2 Rapid POS Cash Sales & Stock Movements<br>- F2.3 Member Credit Sales & Open Debt Creation<br>- F2.4 Store Sales Returns & Restock Ledger Reversals<br>- F2.5 Supplier Purchase Restock Invoices<br>- F2.6 Store Telemetry, Stock Valuation & Best-Sellers | `Tier 1.2: Store, POS & Inventory Modernization`<br>(Tests: `F2.1` to `F2.6`) |
| **Subsystem 3** | **الحصص والمدربون والتدريب الخاص**<br>(Classes, Trainers & Private Training) | - F3.1 Combat & Fitness Class Creation<br>- F3.2 Class Session Scheduling & Duplicate Guards<br>- F3.3 Session Booking & Capacity Ceiling Enforcement<br>- F3.4 Attendance Check-In with Session Consumption<br>- F3.5 Private Training (PT) Packages & Contracts<br>- F3.6 PT Session Countdown & Auto-Completion<br>- F3.7 Trainer Attendance Check-In/Check-Out Tracking | `Tier 1.3: Classes, Trainers & Private Training Hub`<br>(Tests: `F3.1` to `F3.7`) |
| **Subsystem 4** | **الأعضاء والملف الرياضي الشامل**<br>(Members & Profile 360) | - F4.1 Member Roster & Department Filtering<br>- F4.2 Quick Status Toggle in Roster<br>- F4.3 Profile 360 Subscription Freeze<br>- F4.4 Unfreeze with Automatic Expiry Extension<br>- F4.5 Profile 360 1-Click Subscription Renewal<br>- F4.6 InBody Assessment History & BMI Math | `Tier 1.4: Members & Comprehensive Profile 360`<br>(Tests: `F4.1` to `F4.6`) |
| **Subsystem 5** | **شاشة الاستقبال والحضور المباشر**<br>(Reception & Live Occupancy) | - F5.1 Barcode Check-In Happy Path & Verification<br>- F5.2 Check-In Denial Matrix (Unknown, Blocked, Inactive)<br>- F5.3 Duplicate Scan Window Prevention<br>- F5.4 Real-Time Live Occupancy Tracking<br>- F5.5 Front-Desk Check-Out Flow<br>- F5.6 Guest Quick Session / Day Pass Issuance | `Tier 1.5: Reception & Live Occupancy Hub`<br>(Tests: `F5.1` to `F5.6`) |
| **Subsystem 6** | **المستخدمون والصلاحيات**<br>(Staff, Users & Permissions Matrix) | - F6.1 User Provisioning & Department Scoping<br>- F6.2 Department Security Isolation Enforcement<br>- F6.3 Role-Permissions Matrix Dynamic Updates<br>- F6.4 Owner Immutability & Self-Escalation Guard<br>- F6.5 Role Boundaries & `errForbidden` Rejection<br>- F6.6 Full 116 Permissions Matrix Inventory | `Tier 1.6: Staff, Users & Permissions Matrix`<br>(Tests: `F6.1` to `F6.6`) |
| **Subsystem 7** | **التقارير وسجل العمليات الشامل**<br>(Reports & 211-Action Audit Log) | - F7.1 Executive Dashboard 5-Stream Revenue Aggregation<br>- F7.2 Income Statement (Gross Profit, COGS, Net Margin)<br>- F7.3 Receivables Summary & Aging Debts<br>- F7.4 211-Action Audit Trail Logging with Actors<br>- F7.5 Multi-Parameter Audit Search & Filtering<br>- F7.6 UTF-8 BOM CSV Export & Parsing Fidelity | `Tier 1.7: Reports & 211-Action Audit Log Hub`<br>(Tests: `F7.1` to `F7.6`) |

---

## 3. Tier Breakdown and Coverage Metrics

The test suite is structured into four progressive tiers totaling **60 automated test cases**:

```
=============================================================================
                  TEST SUITE TIER BREAKDOWN (60 TESTS TOTAL)
=============================================================================
Tier 1: Feature Coverage (7 Subsystems)               -->  44 Tests (100% Pass)
  - Subsystem 1: Financial & Treasury Hub             -->   7 Tests
  - Subsystem 2: Store, POS & Inventory               -->   6 Tests
  - Subsystem 3: Classes, Trainers & PT               -->   7 Tests
  - Subsystem 4: Members & Profile 360                -->   6 Tests
  - Subsystem 5: Reception & Live Occupancy           -->   6 Tests
  - Subsystem 6: Staff & Permissions Matrix           -->   6 Tests
  - Subsystem 7: Reports & Audit Log                  -->   6 Tests

Tier 2: Boundary & Corner Cases                       -->   8 Tests (100% Pass)
  - Empty Cash Drawers (0 Float / 0 Sales)            -->   1 Test
  - Zero Amount / 100% Free Promotional Sale          -->   1 Test
  - Negative Discrepancy in Cash Closing              -->   1 Test
  - Strict Class Capacity Overflow                    -->   1 Test
  - Zero Subscription Sessions Exhaustion             -->   1 Test
  - Zero PT Package Sessions Exhaustion               -->   1 Test
  - Empty Department Filter Response                  -->   1 Test
  - Administrative Action Role Denial                 -->   1 Test

Tier 3: Cross-Feature Combinations                    -->   5 Tests (100% Pass)
  - Store Credit Sale -> Repayment -> Cash Ledger     -->   1 Test
  - Session Subscription -> Class Attend -> Deduct    -->   1 Test
  - Renewal -> Payment -> Financial Telemetry         -->   1 Test
  - Frozen Subscription -> Check-In Auto-Unfreeze     -->   1 Test
  - Supplier Restock -> Inventory Up -> POS Sale      -->   1 Test

Tier 4: Real-World Workloads                          -->   3 Tests (100% Pass)
  - Complete End-of-Day Shift Close Reconciliation    -->   1 Test
  - Full New Member Lifecycle Journey                 -->   1 Test
  - Complete Weekly Class Schedule Cycle              -->   1 Test
=============================================================================
Total Tests: 60  |  Passed: 60  |  Failed: 0  |  Pass Rate: 100.0%
=============================================================================
```

---

## 4. How to Run the Tests

### Single-File Suite Execution:
```bash
npx vitest run tests/e2e-subsystems-modernization.test.ts
```

### Full Project Test Suite Execution:
```bash
npm test
```

### Backend Typecheck:
```bash
npm run typecheck:server
```
