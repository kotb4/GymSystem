# Current AI Development Tasks

## TASK-001: Full-project review remediation batch
- Status: done (2026-08-25)
- Priority: high
- Goal: Fix all findings from the initial full-project code review (5 bugs + design concerns + minors).
- Outcome:
  - Store-debt second installment UNIQUE crash fixed (ledger refId = repayment row id).
  - Void of partially-repaid credit sale now returns a proper conflict instead of raw FK error.
  - `recordCheckIn` enforces `checkin.create`.
  - Password hashing moved out of transactions (setup/createUser).
  - Open RPC functions gated (ADR-002); dead entries removed.
  - Unfreeze always closes the freeze-history row (date shift still rule-gated).
  - Cash boxes wired end-to-end at service layer (ADR-003).
  - Minors: money integer guard, cookie decode resilience, files-meta permission, employee phone i18n key, dead SQL removed, photo handlers permission-first + transactional, static stream error handler, tmp file deleted, .gitignore hardened.
  - Docs synced: purge docstring/AGENTS/business-rules corrected; permission count corrected to 68.

## TASK-002: Audit F-01 restore authorization
- Status: done (2026-08-25) — `backup.restore` gate inside `importDatabaseBytes`; legacy sentinel stored as NULL in user-FK columns.

## TASK-003: Audit F-02 backup create/download authorization
- Status: done (2026-08-25) — `backup.create` on create, `backup.restore` on download, both service-level.

## TASK-004: Remaining audit findings
- Status: done (2026-08-25, second remediation round)
- Items resolved:
  - F-03 initial git commit created.
  - F-04 department isolation extended to subscriptions/payments/attendance/store/classes/inbody/training-plans/crm (ADR-004) + regression suite tests/department-scope.test.ts.
  - F-05 purge now removes the member photo registry row inside the transaction and unlinks disk bytes in the RPC layer.
  - F-06 README synced (test count, current limitations).
  - F-09 rpc-consistency checker recognizes inline `{fn, actor}` registry entries.
  - F-10 auth-context uses api.auth.me() (no raw fetch outside src/api).
  - F-11 Secure cookie via GYMSYSTEM_SECURE_COOKIES opt-in (ADR-005).
  - F-13 route-scoped body limits (ADR-006); restore permission gate now precedes large-body buffering.
- Wontfix/documented: getBackupConfig RPC kept (gated, wrapper ready for future UI); getAllPermissions keeps unused db param by injection convention.
