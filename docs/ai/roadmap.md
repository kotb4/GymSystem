# Yassen Mohamed Kotb | 01288536381 Roadmap

## Completed

- Core member management (CRUD, status, trash/restore/purge, photos)
- Membership plans (time/sessions/open kinds)
- Subscriptions (create, renew, cancel, freeze/unfreeze, purge)
- Barcode cards (register, assign, unassign, lost, blocked, bulk register)
- Check-in/check-out with duplicate window
- Payments (record, partial, discount, refund, void) + financial ledger
- Expenses (+BLOB attachments, categories, void)
- Dual cash boxes (gym/store) with close discrepancy
- Financial reports & dashboard (revenue, refunds, expenses, net, by method/plan, daily series)
- Store/POS (products, stock, sales, credit debts, repayments, void, profit)
- Classes (sessions, bookings, capacity, session-consuming plans)
- Trainers & training plans (auto-sweep expired)
- Employees & salaries (monthly/daily/per_class/custom; pay→expense+ledger)
- InBody body assessments + custom fitness tests
- CRM templates/messages (WhatsApp click-to-chat flow)
- Notifications digest
- 4-role permission system (owner/manager/reception/trainer, 72 permissions, DB-backed editable grants)
- Department isolation (men/women/general scoping)
- Hard-delete for members, employees, products, cash sessions, subscriptions
- Financial outstanding display across check-in, member profile, payment modal
- Subscription modal with 3-mode payment (full/partial/later)
- Revenue-refund accounting fix (dashboard + reports correctly handle refunds)
- Backup/restore with integrity verification
- Legacy IndexedDB import
- Full Arabic RTL UI with dark premium theme
- 205+ unit tests across 20 files
- AI development infrastructure (AGENTS.md, docs/ai/*, .ai/*, .opencode/*)

## Current

- Production readiness stabilization
- Edge case coverage in financial reports
- E2E test coverage expansion

## Next

- Production EXE installer / packaging
- Demo mode with synthetic data for marketing
- Automated backup scheduling (background)
- Notification delivery (beyond digest)
- Barcode printer integration (if requested)

## Future (Planned, NOT Implemented)

- License system (offline signing, GymLicenseManager) — PLANNED PART 5
- Thermal receipt printing — NOT IMPLEMENTED, no code exists
- Member card printing — NOT IMPLEMENTED, no code exists
- Cloud sync — NOT IMPLEMENTED (offline-first by design)
- Multi-gym support — NOT IMPLEMENTED
- WhatsApp API integration (beyond click-to-chat) — NOT IMPLEMENTED
- Advanced analytics / AI insights — NOT IMPLEMENTED
