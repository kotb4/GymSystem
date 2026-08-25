# GymSystem Project Audit

- Date: 2026-08-25 (second audit)
- Scope: Full project re-audit following the F-01/F-02 authorization fixes and the full review-remediation batch (store debt installments, void guard, recordCheckIn permission, RPC gating policy ADR-002, unfreeze fix, cash-box wiring ADR-003, hashing placement, minors).
- Verdict: **No CRITICAL and no HIGH code findings remain open.** All quality gates green (typecheck ×2, 182/182 tests). Highest open item is operational (F-03: repository still has zero commits), followed by three MEDIUMs carried from the first audit.

---

## Executive Summary

The two HIGH-severity authorization holes reported in the first audit are closed and regression-tested: database restore now requires `backup.restore` inside `importDatabaseBytes` (with legacy-import's synthetic actor passing by design), and backup create/download require `backup.create`/`backup.restore`. Beyond those, an entire remediation batch landed: the store-debt second-installment UNIQUE crash (verified bug), void-after-partial-repayment raw FK error, missing `checkin.create` enforcement on check-in, password hashing moved out of open transactions, a documented RPC authorization policy converting six over-exposed endpoints to actor-gated calls and deleting two dead exposures, freeze-history closure independent of the extends-expiry setting, and end-to-end cash-box tagging/scoping at the service layer.

This audit confirms the fixes in code, verifies nothing regressed (182/182 unit tests including 14 new authorization/regression tests across three dedicated suites; both typechecks clean; build verified earlier today after all changes), and re-statuses every first-audit finding. The remaining exposure profile is: one HIGH *operational* risk (no version-control history whatsoever), three MEDIUMs (department scoping beyond members service awaiting product decision; purge leaves orphaned file registry rows/disk bytes; user-facing README still describes half the app as unbuilt and cites 107 tests when there are 182), plus four LOWs unchanged by design or pending trivial work. No new CRITICAL/HIGH issues were introduced by the remediation batch itself.

Recommended order: make the initial commit (F-03) immediately — every further change compounds unrecoverable risk — then decide department-scoping scope (F-04), purge file cleanup (F-05), and a README/docs pass (F-06).

---

## Methodology

1. Archived previous report to `.ai/audits/history/2026-08-25-audit.md`.
2. Re-executed verification gates (results below).
3. Code-level confirmation of each fix: gates present in `server/backups.ts:32,78,135`; `recordCheckIn` permission-first (`attendance.service.ts:110`); repayment ledger keyed by installment id (`store.service.ts:709-722` region); void guard pre-transaction; hashing before `db.transaction` in `setup`/`createUser`; unfreeze closes history row unconditionally while date-shift stays rule-gated (`subscriptions.service.ts:531-552`); cash-box column persisted and scoped (`payments.service.ts` LedgerInput, `cash-session.service.ts`, three `box:"store"` tags in `store.service.ts`).
4. Re-statused all 13 first-audit findings against current code (table below).
5. New-issue probes around the changed surfaces: notifications digest guards `getBackupConfig` behind `roleHasPermission(settings.view)` before calling (safe for restricted roles); removed RPC entries confirmed absent from frontend (consistency script silent); e2e scripts contain no store-box-specific assertions that the tagging change could break; remaining `p()` registry entries match exactly the deliberate-open catalog listed in ADR-002.

---

## Status of first-audit findings

| ID | Was | Now | Evidence |
|---|---|---|---|
| F-01 restore authz | CRITICAL | **CLOSED** | `backups.ts:135` gate + legacy synthetic actor passes as owner; 5-test suite `tests/restore-authz.test.ts` |
| F-02 backup create/download | HIGH | **CLOSED** | `backups.ts:32,78` gates; denial-leaves-no-artifact test in `tests/backup-authz.test.ts` |
| F-03 zero git commits | HIGH (ops) | **OPEN** | `git rev-list HEAD` still fails — no commit has ever been made |
| F-04 department scoping beyond members | MEDIUM | OPEN (decision pending) | `assertDepartmentAccess` still 7 call sites, members-only |
| F-05 purge orphaned files rows/disk bytes | MEDIUM | OPEN | purge cascade still does not touch `files`/disk |
| F-06 README drift (features/tests count) | MEDIUM | PARTLY OPEN | `.ai/*` + AGENTS corrected (incl. 68-permission count); `README.md:140,146` still says 107 tests & lists implemented modules as unbuilt |
| F-07 files-meta metadata exposure | LOW | **CLOSED** | route now applies baseline + per-kind permission like byte route |
| F-08 permissions config readable by all roles | LOW | **CLOSED (stricter)** | converted to `a()` + `users.view` |
| F-09 rpc-consistency false negatives | LOW | OPEN | two inline `{fn,actor}` entries still unrecognized by the script (handlers themselves improved: permission-first + transactional) |
| F-10 direct fetch in auth-context | LOW | OPEN | 2 call sites unchanged |
| F-11 cookie lacks Secure | LOW | OPEN (by design on HTTP loopback) | revisit at LAN/HTTPS time |
| F-12 leftover tmp-store-page.txt | LOW | **CLOSED** | file deleted; `.gitignore` hardened (`*.log`, `tmp-*`) |
| F-13 256 MB buffering / per-account-only throttle | LOW | OPEN (loopback mitigations) | pair with future LAN decision |

## Findings this audit (delta)

- **[LOW] `settings.getBackupConfig` RPC appears page-orphaned** — Location: `src/api/index.ts:137` wrapper; no page/component consumer found. Impact: none (entry is now permission-gated); flagging for either UI use or future removal decision alongside ADR-002's dead-exposure policy.
- **[LOW] `getAllPermissions(db, actor)` carries an unused `db` parameter** — Location: `src/core/services/permissions.service.ts:41-45` (`void db`). Impact: cosmetic signature asymmetry required by the uniform `(db, actor)` injection convention; acceptable.
- **[INFO] e2e coverage gap for new behaviors** — dual-box sessions, store-debt multi-installments, and the new permission denials are covered by Vitest suites but not yet by `scripts/e2e-audit.ps1`; scripts were NOT executed during this audit to avoid touching the live `%LOCALAPPDATA%` data dir — recommend a supervised run with an isolated `GYMSYSTEM_DATA_DIR`.

## Verification commands actually executed (this audit)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS (exit 0) |
| `npm run typecheck:server` | PASS (exit 0) |
| `npm test` | PASS — 16 files, 182/182 tests, exit 0 (~22 s) |
| `node scripts/check-rpc-consistency.cjs` | exit 0 — only the two known inline-entry false positives; removed entries raise no client-mismatch |
| `git rev-list --count HEAD` | FAILS — repo still has zero commits (F-03) |
| `npm run build` | PASS earlier today (post-remediation, exit 0) — not re-run this turn |

## Not inspected / UNKNOWN (carried forward)

- Line-by-line review of all 27 services beyond sampled flows.
- Production-scale performance (no load testing).
- Auto-backup scheduler runtime semantics (settings surface only) — UNKNOWN.
- `src/core/barcode/barcode-input.ts` scanner-parsing edge cases.
- E2E PowerShell suites' internal logic and behavior under isolated data dirs.

## Recommended priority

1. **F-03** initial commit (one command; protects everything else).
2. **F-04** product decision → implement shared member-scope guard or document members-only scope.
3. **F-05** purge cascade extension to `files` (+ disk unlink post-commit).
4. **F-06** README sync (or delegate to `/docs`).
5. Supervised `e2e-audit.ps1` run in an isolated data dir to extend confidence beyond unit level.
