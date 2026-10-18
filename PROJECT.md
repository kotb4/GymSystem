# Project: GymGate 7 Subsystems Modernization & Overhaul

## Architecture
GymGate (جيم جيت) is an RTL-first, offline-first gym management application for Windows.
- **Frontend**: React 18 SPA (Vite, Tailwind v4 design tokens, Lucide icons, glass capsule pills, neon glow accents, 12-hour AM/PM Arabic formatting).
- **Backend**: Local Node.js HTTP + synchronous SQLite (`node:sqlite`) server on `127.0.0.1:8890`. Whitelisted RPC registry (`server/rpc.ts`) over backend-only domain services (`src/core/services/*.service.ts`).
- **Data Integrity**: Local SQLite at `%LOCALAPPDATA%\GymSystem\Database\gym.db` with WAL mode. Append-only migrations (`v1..v63`). Atomic transactions for financial ledger integrity. Strict `requirePermission` authorization.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1.1 | Treasury Hub Telemetry | Add Expected vs Counted discrepancy card, live drawer balance, daily collections & expenses, net flow, and debts in `FinanceHubHeader` | M1 | Survey 1 |
| F1.2 | 1-Click Z-Report Shift Close | Modal for shift closing directly from header with denomination calculator and discrepancy warnings | M1 | Survey 1 |
| F1.3 | Treasury 12h Time Formatting | Replace raw 24h slices (`slice(0, 16)`) in `cash-page.tsx`, payments, expenses with `formatTime12` / `formatDateShort` | M1 | Survey 1 |
| F1.4 | Finance Glass Capsule Tabs | Modern glass capsule pills for Sessions, Ledger, Payments, Expenses, Debts with live counter badges | M1 | Survey 1 |
| F2.1 | Store Top Telemetry Strip | Add Today's Sales, Inventory Value, Low-Stock items, and Today's Best Seller ("الأكثر مبيعاً اليوم") | M1 | Survey 1 |
| F2.2 | POS Rapid Register & Steppers | Touch-friendly product cards, quantity steppers, member credit sales, and audio feedback | M1 | Survey 1 |
| F2.3 | Restock Orders Integration | Direct "طلب توريد 🚚" shortcut from low-stock product cards to `PurchasesPage` | M1 | Survey 1 |
| F2.4 | Store 12h Time Formatting | Standardize SalesTab date/time column, Returns table, and Movements table to 12-hour AM/PM | M1 | Survey 1 |
| F3.1 | Weekly Class Schedule Hub | Interactive weekly schedule visualizer with capacity bars, session status, and attendance rosters | M2 | Survey 2 |
| F3.2 | PT Packages & Attendance | Private training session countdown, remaining balance, and live trainer check-in/out logging | M2 | Survey 2 |
| F3.3 | Classes & Trainer 12h Time | Standardize time display in `classes-page.tsx`, `private-training-page.tsx`, and `trainer-attendance-page.tsx` | M2 | Survey 2 |
| F3.4 | Member Profile PT Classes Tab | Query real `private_trainings` records and join class names for bookings | M2 | Survey 2 |
| F4.1 | Members Roster Telemetry Strip | Top KPI strip (Total Members, Active, Inactive, Expiring Soon, Archived) on `members-page.tsx` | M2 | Survey 2 |
| F4.2 | Department Capsule Filter | Glass capsule pills for `[الكل]` • `[عام]` • `[رجال]` • `[سيدات]` with security scoping | M2 | Survey 2 |
| F4.3 | Quick Status Toggle in Roster | Direct status change toggle in members table invoking `api.members.setStatus` | M2 | Survey 2 |
| F4.4 | Member Profile 360 Quick Actions | Wire 1-click Freeze to `FreezeSubscriptionModal` (zero restrictive settings) and Renew to `RenewModal` | M2 | Survey 2 |
| F4.5 | Profile 360 Assessment History | Maintain robust assessment history while respecting user configuration | M2 | Survey 2 |
| F5.1 | Reception Top Telemetry Hub | 5 live KPI cards (Live Occupants, Today's Attendance, Expiring Today, Day Passes, Pending Debts) | M3 | Survey 3 |
| F5.2 | High-Performance Check-In & Chimes | Barcode scanner integration with audio chimes and remaining sessions countdown | M3 | Survey 3 |
| F5.3 | Fullscreen Self-Check-In Kiosk | Fullscreen Kiosk mode toggle via Native Fullscreen API for front desk tablet/kiosk | M3 | Survey 3 |
| F5.4 | Reception 12h Time Formatting | Replace 24h slices in `live-occupants-panel.tsx:165` and attendance tables with 12h Arabic format | M3 | Survey 3 |
| F6.1 | Staff & Permissions Telemetry | Top KPI strip for staff count, active roles, online sessions, and security status | M3 | Survey 3 |
| F6.2 | Role-Permission Toggle Matrix | Modern interactive matrix covering all 126 permissions across system roles with category filtering | M3 | Survey 3 |
| F6.3 | User Account Provisioning | User creation/editing with role assignments and department scoping (`general`, `men`, `women`) | M3 | Survey 3 |
| F7.1 | Executive Dashboard Hub | Top executive strip on `reports-page.tsx` with 5 revenue streams, member growth, and retention | M3 | Survey 3 |
| F7.2 | Unified Glass Capsule Report Tabs | Modern glass capsule pills for reports navigation replacing legacy 3-row stacked tabs | M3 | Survey 3 |
| F7.3 | 211-Action Audit Log & CSV Export | Filterable audit log with UTF-8 BOM CSV export and category quick filters | M3 | Survey 3 |
| F7.4 | Reports & Audit 12h Time | Standardize all 8 raw time slices in reports and audit page timestamps to 12-hour AM/PM | M3 | Survey 3 |
| F8.1 | E2E Test Suite Infrastructure | Comprehensive opaque-box test suite across Tiers 1-4 verifying all 7 subsystems | E2E Track | Survey 1-3 |
| F8.2 | Final System Acceptance & Build | Full verification (`npm test`, `typecheck`, `typecheck:server`, `sync:docs`, `build:exe`) | M4 | Survey 1-3 |

## Milestones
| # | Name | Scope | Dependencies | Status | Key Outputs |
|---|------|-------|-------------|--------|-------------|
| M1 | Financial & Store Modernization | Subsystems 1 & 2: Finance & Treasury Hub, Payments, Expenses, Debts, Cash Sessions, Store & POS, Purchases | none | DONE | `ZReportModal`, `FinanceHubHeader` expected-vs-counted telemetry, Best Seller card, 12h formatting, 96 tests pass |
| M2 | Classes, Trainers & Members Hub | Subsystems 3 & 4: Classes, Private Training, Trainer Attendance, Members Roster, Profile 360 | none | DONE | Members KPI strip & department capsule pills, Profile 360 freeze/renew/PT wiring, schedule visualizer 12h, 80 tests pass |
| M3 | Reception, Staff & Reports Hub | Subsystems 5, 6 & 7: Reception & Kiosk, Live Occupancy, Staff & Permissions Matrix, Reports Hub & Audit Log | none | DONE | Reception 5-card telemetry & fullscreen kiosk, 126-permission toggle matrix, Executive Dashboard Hub, 75 tests pass |
| E2E | E2E Test Suite Track | Independent requirement-driven opaque-box test suite covering all 7 subsystems (Tiers 1-4) | none | DONE | `tests/e2e-subsystems-modernization.test.ts` (60/60 tests pass), `TEST_INFRA.md`, `TEST_READY.md` published |
| M4 | Final Acceptance & Production Build | Pass 100% of E2E test suite + full automated verification (`npm test`, `typecheck`, `sync:docs`, `build:exe`) | M1, M2, M3, E2E | DONE | CLEAN Forensic Audit, APPROVE Reviews, 836/836 tests passing, Windows EXE `dist-exe/GymSystem.exe` compiled |

## Interface Contracts
### Common Formatting & UX Contract
- **Time Standard**: All timestamps and time displays use `formatTime12(dateOrTimeStr)` / `formatTime(dateOrTimeStr)` formatted as `hh:mm ص/م` (12-hour Arabic AM/PM). Zero raw 24-hour slices remain in any overhauled page.
- **Glass Capsule Pills**: Tabs and filter pills use `.rounded-full .bg-panel/60 .backdrop-blur .border .border-panel-border/50` with active neon glow (`border-primary shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]`).
- **Telemetry KPI Strips**: Top KPI cards are interactive with count badges and filter triggers.
- **Department Scope**: `general`, `men`, `women`. Department filter in members roster respects `assertDepartmentAccess`.

### Database & Backend Contracts
- Zero changes to migrations `v1..v63`.
- All financial mutations execute inside `db.transaction()` and maintain `financial_ledger` uniqueness.
- Permissions: Every service mutation calls `requirePermission(actor, perm)`.
- RPC Registry: Strictly whitelisted in `server/rpc.ts`.
