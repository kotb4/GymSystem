# Architecture Decision Log

## ADR-001: Member hard-purge intentionally cascades all history
- Date: 2026-08-25
- Status: accepted (product-owner request during UAT)
- Context: The original design refused hard-delete whenever any financial/attendance record referenced a member, leaving trashed members undeletable forever. Owner explicitly requested full deletion from the trash.
- Decision: `purgeMember` (requires `members.purge`) cascades all 17 related tables in FK-safe order inside one transaction — including payments, refunds, financial_ledger rows, attendance, subscriptions/freezes, cards, store sales/items/debts/repayments, CRM messages, bookings, training plans, assessments, fitness results — then deletes the member and audits `MEMBER_PURGED` with the cascade count.
- Consequences: Financial/cash-trail rows for that member are permanently destroyed; reports reflect their absence. Supersedes the refuse-on-history guard and its docstring. Known follow-up (audit F-05): `files` registry rows/disk bytes for member photos are not yet cleaned by the cascade.

## ADR-002: RPC authorization policy for plain reads
- Date: 2026-08-25
- Status: accepted
- Context: Several RPC entries were registered `p()` (no actor) and could not enforce permissions; audit trail, settings dumps, and a state-mutating sweep were callable by every authenticated role.
- Decision: Actor-gated (`a()` + first-statement `requirePermission`): `audit.listAuditLogs`→`audit.view`, `settings.readAllSettings`/`getBackupConfig`→`settings.view`, `trainingPlans.sweepExpiredPlans`→`training.manage`, `permissions.getRolePermissions`/`getAllPermissions`→`users.view`. Deliberately left open to all staff (catalog/config reads with no sensitive payload): payment methods list, expense categories, product categories, scanner/sound/working-days/inactive-days/checkout/freeze-extenders flags, subscriptions counters, barcode preview, `auth.needsSetup`. Dead exposure removed outright (no frontend caller): `settings.getWhatsAppConfig`, `settings.getExpiryThresholds` (remain internal service helpers).
- Consequences: Unknown-RPC behavior unchanged for whitelisted callers; frontend wrappers untouched (server injects actor). Any future `p()` registration must be justified in this log.

## ADR-003: Cash-box tagging and per-box sessions
- Date: 2026-08-25
- Status: accepted
- Context: Migration v4 introduced `cash_sessions.box` / `financial_ledger.box` with a per-box unique-open index, but services ignored the column: all ledger rows defaulted to 'gym', a second (store) session could open while arithmetic mixed both drawers.
- Decision: `insertLedgerEntry` persists `box` (default 'gym'); store sale payments, credit-sale reversals, and store-debt installments are tagged `'store'`. Sessions accept optional `box` (default 'gym'), uniqueness is enforced per box, and expected-closing math filters the ledger by the session's own box. Existing historical rows remain 'gym'.
- Consequences: Gym drawer counts no longer include store revenue. UI drawer selection is not built yet — the cash page operates on the gym box via defaults; exposing the store drawer is future UI work.

## ADR-004: Department isolation enforced across all member-scoped services
- Date: 2026-08-25
- Status: accepted
- Context: First audit (F-04) showed men/women section isolation existed only inside members.service; every other member-scoped operation accepted arbitrary member IDs (cross-section IDOR between staff).
- Decision: Shared module `src/core/services/department.ts` (`assertDepartmentAccess`, `departmentScopeCondition`, `memberDepartmentById`, bypass = owner OR `members.view_all_departments` OR staff dept 'general'). Wired into: subscriptions (create/update/status/freeze/unfreeze/renew + per-member reads + list filter), payments (record/refund/void + list filter), attendance check-in/out, store credit sale/debt repay/totals/list, classes book/cancel/status/member-lists, InBody create/delete/list/progress/results, training plans create/update/end/cancel/list (EXISTS form keeps COUNT join-free), CRM queue. Club-level aggregates gated by `reports.view`/`diagnostics.view` remain intentionally unscoped.
- Consequences: Scoped staff can no longer touch other sections via any service path; lists shrink accordingly. Financial reports stay club-wide for their existing roles.

## ADR-005: Secure cookie flag is an explicit opt-in
- Date: 2026-08-25
- Status: accepted
- Context: Audit F-11 noted the session cookie lacks `Secure`. Setting it unconditionally breaks plain-HTTP LAN deployments (cookie would be dropped), while loopback localhost works either way.
- Decision: `GYMSYSTEM_SECURE_COOKIES=1` appends `Secure` to session cookies (set + clear). Default stays off until an HTTPS terminator exists.
- Consequences: Deployment docs must mention the flag when introducing HTTPS/LAN support.

## ADR-008: Hard-delete surfaces for previously non-deletable entities
- Date: 2026-08-25
- Status: accepted (product-owner request)
- Context: "Delete anything" was untrue for employees, store products and cash sessions — they only had activate/deactivate or open/close toggles.
- Decision: Three new permissions (`employees.purge`, `store.purge`, `cash.purge`; migration v8 registers the codes, unseeded for non-owner roles → grantable from the Permissions page):
  1. **Employees** — hard delete cascades the employee's salaries and their treasury ledger rows (keyed by salary id); generated expense documents remain as historical paperwork (no structural link exists).
  2. **Products** — hard delete removes the product, its stock-movement log, AND its lines inside historical sale documents (amended same day per owner request after the initial refuse-if-sold guard felt blocking). Sale headers/totals survive; only referenced line items are detached. The PRODUCT_PURGED audit entry records movementsRemoved / saleLinesRemoved / salesAffected.
  3. **Cash sessions** — OPEN sessions may be deleted (mistaken open/abort; ledger money truth untouched). CLOSED sessions are permanently locked because their counted-vs-expected discrepancy record must never be hidden.
  4. **Subscriptions** (`subscriptions.purge`, migration v9) — hard delete removes the subscription with its payments, refunds, their treasury ledger rows and freeze history; attendance rows and class bookings SURVIVE with the subscription reference detached to NULL so visit history is never lost. Department-scoped + audited `SUBSCRIPTION_PURGED` with paymentsRemoved count.
- Consequences: Payroll purges alter historical cash totals by design (same semantics as member purge). Sold-product removal requires deactivation. Closed-session discrepancies remain permanently visible.

## ADR-007: Anwar account as second owner; manager gains the permission editor
- Date: 2026-08-25
- Status: accepted (product-owner request)
- Context: Owner wants an "Anwar" account that can literally do everything, including every destructive delete, with the ability to hand those capabilities to other accounts, and to delegate permission control over subordinate roles to the manager.
- Decision:
  1. The Anwar account is created through Users → role **owner**. Owner short-circuits every `roleHasPermission` check and cannot be locked out of the Permissions page, satisfying "anything, literally". Multiple owner accounts are supported; last-active-owner protections remain.
  2. "Delete anything" maps to the existing destructive set (`members.delete/restore/purge`, `payments.refund/void`, `expenses` void, `store.void_sale`, `subscriptions.cancel`, `users.manage`) — all inherently held by owner and grantable per-role from the Permissions page. No new backend deletion surface was invented.
  3. Migration v7 grants `settings.edit` to the manager role (idempotent, ON CONFLICT DO NOTHING) so a manager can open `/permissions` (already gated by `users.view`, which manager holds) and edit any non-owner role — i.e., control permissions for the people under them.
- Consequences: An empowered manager can escalate any role except owner (owner row is immutable by service contract). Permissions are role-scoped; true per-user overrides would require a new table + migration and are explicitly deferred. Client-side `hasPermission` uses static defaults for cosmetics only — the server cache is authoritative after boot/commit refresh.

## ADR-006: Restore request size limits are route-scoped
- Date: 2026-08-25
- Status: accepted
- Context: Every POST buffered up to 256 MB before validation (audit F-13).
- Decision: `readBody(req, limit)` defaults to 8 MB; `/api/system/restore|import-legacy` explicitly opts into the 256 MB DB-transfer limit AFTER the `backup.restore` permission check; file uploads cap at 3 MB envelope around the 2 MB stored limit.
- Consequences: Oversized bodies on ordinary routes fail fast with the standard validation error instead of consuming memory.

## ADR-010: LAN bind on 0.0.0.0 (default) + value-level auto doc sync
- Date: 2026-08-27
- Status: accepted (product-owner request)
- Context: The backend defaulted to loopback-only (`127.0.0.1`), so it was unreachable from other LAN devices / Tailscale IPs. Separately, the AI documentation (`AGENTS.md`, `.ai/*`, `docs/ai/*`) repeatedly drifted from the code (e.g. migrations "v1..v6" while code has v1..v11), because nothing kept counts/versions in sync after edits.
- Decision:
  1. `server/index.ts` default `HOST` changed from `127.0.0.1` to `0.0.0.0` (`GYMSYSTEM_HOST` override retained), enabling LAN/Tailscale reachability out of the box.
  2. New `scripts/sync-docs.mjs` recomputes machine-checkable facts from source every run (PERMS count, AUDIT_ACTIONS count, migration max version, host default, service/page/test counts) and refreshes only those value patterns in `AGENTS.md`, `.ai/project.md`, `docs/ai/architecture.md`, `docs/ai/database.md`. It never rewrites narrative/business rules — those remain the `/docs` agent's job.
  3. Auto-run: npm `sync:docs` script for manual/agent use, plus a `.git/hooks/pre-commit` (sh, LF) that re-syncs before every commit.
- Consequences: The app is now reachable on the LAN by default (bind 0.0.0.0) — a security-relevant change; operators should keep the network trusted or re-set `GYMSYSTEM_HOST` to loopback. Document counts/versions update automatically on commit; narrative/rule drift still needs `/docs` or a human. Secure-cookie note (ADR-005) becomes more relevant now that LAN exposure is on.

## ADR-012: Single shared cross-agent memory under `.ai/` (no parallel systems)
- Date: 2026-08-29
- Status: accepted
- Context: The AI workflow was implicitly OpenCode-centric (AGENTS.md + `.opencode/` agents/commands). Switching to Cursor, Claude Code, or another agent meant the next agent lost the prior chat context and had to re-derive the live state by re-reading code. There was a temptation to spawn multiple parallel memory systems (STATE.md, TASKS.md, CHANGELOG.md, .cursor/rules/, separate Claude memory) — that would have caused drift.
- Decision:
  1. **One coherent shared memory under `.ai/`** with clear roles:
     - `.ai/project.md` — long-form project profile (idempotent, value-level auto-synced by `scripts/sync-docs.mjs`).
     - `.ai/architecture.md`, `.ai/business-rules.md` — quick-reference for AI agents (short, not narrative; full versions live in `docs/ai/`).
     - `.ai/tasks.md` — task history & roadmap (active / completed / blocked / discovered-followup).
     - `.ai/decisions.md` — Architecture Decision Record (this file).
     - `.ai/current-state.md` — live dev-state handoff. Concise, agent-maintained, **never machine-generated**. Answers: "What was the previous agent doing? Where did it stop? What should the next agent do?"
  2. **AGENTS.md is the single repository-wide entry point.** It mandates the reading order (`AGENTS.md` → `.ai/project.md` → `.ai/current-state.md` → `.ai/tasks.md` → `.ai/decisions.md` → inspect source) and explicitly states: "The repository files are the persistent memory shared between coding agents. Chat history is NOT part of the project's source of truth."
  3. **No duplicate system**: no STATE.md, no TASKS.md, no CHANGELOG.md, no `.claude/`, no separate memory schema. The existing `.ai/architecture.md` and `.ai/business-rules.md` are kept as short quick-reference; their full counterparts in `docs/ai/` are kept as human-readable long-form. They are NOT duplicates — they serve different audiences.
  4. **OpenCode agents and commands** are updated to read and write the SAME `.ai/` files (no OpenCode-only memory). `.opencode/agents/{planner,tester,reviewer,security,docs,analyze,audit}.md` and `.opencode/commands/{feature,review,test,docs,analyze,audit}.md` must reference `.ai/current-state.md` as the live-state source.
  5. **Cursor rule (`.cursor/rules/gym-assistant.md`)** is minimal and points to the shared state without duplicating AGENTS.md content.
  6. **`scripts/sync-docs.mjs`** continues to update only machine-verifiable facts (counts, versions) — it must NEVER touch `.ai/current-state.md` because that file is the agent's live context and would lose its meaning if auto-generated.
- Consequences: any future agent (Cursor, Claude Code, OpenCode) can resume the project from repository files alone. The reading order and update discipline become the contract. The workflow becomes portable.

## ADR-011: GitHub hosting (private) for version control & collaboration
- Date: 2026-08-27
- Status: accepted (product-owner request)
- Context: The repo had a single initial commit, no remote, and the app was offline-only on one machine. Owner wants a private GitHub repo for version control, history and controlled collaboration.
- Decision:
  1. Default branch renamed `master` → `main`.
  2. Remote `origin` = `https://github.com/kotb4/GymSystem` (PRIVATE), created via `gh repo create`.
  3. All work committed in one clean history commit (36a4c7d) after a security scan confirmed no DB dumps, `.env*`, logs, `.gymbak` or secrets are tracked (`.gitignore` excludes them).
  4. Collaboration stays private: collaborators added individually via GitHub repo Settings → Collaborators (invite-only) or `gh api repos/kotb4/GymSystem/collaborators/<username> -X PUT`; repo never made public.
- Consequences: Source is now version-controlled off-machine; runtime data (SQLite DB, files, backups, sealed env) remains local under `%LOCALAPPDATA%\GymSystem` and is intentionally never committed. LAN/0.0.0.0 default (ADR-010) plus private-collab means the hosted code is code only, never the live database.

## ADR-013: Migration FK toggle at connection level
- Date: 2026-08-31
- Status: accepted (code health / correctness)
- Context: Migration v21 rebuilds `products` + `stock_movements` (DROP/RENAME of tables referenced by other tables) and attempted `PRAGMA foreign_keys = OFF` inside the migration transaction. SQLite ignores `PRAGMA foreign_keys` inside a transaction, so any existing v20 DB with store data crashed with `FOREIGN KEY constraint failed` on upgrade. The migration runner (`applyMigration`) already wraps migrations in `db.transaction()` (BEGIN IMMEDIATE), making the pragma a no-op.
- Decision: Add a connection-level FK toggle (`Db.setForeignKeys(enabled)`) and a migration flag (`Migration.fkOff: boolean`). In `applyMigration`, if `fkOff` is true, disable FK at the connection level, run the migration transaction, then re-enable FK in a `finally` block. Mark migration v21 with `fkOff: true`. Keeps migrations append-only (never mutate an old migration) while fixing the upgrade path.
- Consequences: Existing v20 DBs with store data can now upgrade to v21+v22 without FK errors. The pragma is truly off during the DDL, ensuring the rebuild succeeds. FK re-enabled after each migration preserves data integrity. No schema change — only the migration runner logic changed.

## ADR-014: Privilege escalation guards (setRolePermissions, createUser, updateUser)
- Date: 2026-08-31
- Status: accepted (security hardening)
- Context: Two escalation paths: (1) a manager with `settings.edit` could call `setRolePermissions` to grant their own role `users.manage`, then promote to owner via `updateUser`; (2) `createUser`/`updateUser` allowed a non-owner with `users.manage` to create or set `role_id = 'owner'`. The owner role is supposed to be absolute and immutable except by the owner.
- Decision:
  - `setRolePermissions` retains `requirePermission(actor, "settings.edit")`, refuses to edit the `owner` role (silent no-op), and refuses to edit the actor's own role unless `actor.roleId === "owner"` (blocks self-escalation). Manager can still edit subordinate roles (reception/trainer) per ADR-007.
  - `createUser` and `updateUser` reject `roleId === "owner"` when `actor.roleId !== "owner"`.
- Consequences: The manager permission-control feature (ADR-007) is preserved — managers edit subordinate roles but cannot escalate to owner; the owner role's absolutism is preserved. Regression tests added in `tests/manager-permissions.test.ts`.

## ADR-015: Store reads department-scoped; return reports fixed
- Date: 2026-08-31
- Status: accepted (correctness + security)
- Context: `getSale`, `listSales`, `getStoreReturn`, `listStoreReturns` lacked department scoping (cross-section read). `getStoreStats` / `getDailySalesReport` aggregated returns from sales that could later be voided, overstating revenue. `store_returns` has no `member_id` column, so scoping must go through the sale's member.
- Decision:
  - `getSale`, `listSales`: `assertDepartmentAccess` (getter) / list-condition via `departmentScopeCondition` on `store_sales.member_id`; null-member (walk-in) stays visible to every section (`m.department IN (?, 'general') OR m.id IS NULL`).
  - `getStoreReturn`: post-fetch `assertDepartmentAccess` via the sale's `member_id` (selected as `s.member_id` in `RETURN_SELECT`).
  - `listStoreReturns`: list-condition via `departmentScopeCondition` on the sale's member (same null-member rule).
  - `getStoreStats` / `getDailySalesReport`: JOIN `store_returns r` to `store_sales s`, filter `s.status = 'completed'` when aggregating returns.
  - Fixed the missing `store_return_items.line_cost_minor` bug (compute cost as `unit_cost_minor * qty`).
- Consequences: Store reads respect the actor's department (walk-in always visible); return analytics only count returns from still-completed sales. No regression; coverage added in `tests/manager-permissions.test.ts` and `tests/migration-upgrade.test.ts`.
