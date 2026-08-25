---
description: Implement a feature end-to-end following the GymSystem AI workflow
---
Implement this feature in GymSystem: $ARGUMENTS

Follow AGENTS.md strictly and execute the full workflow in order:

1. Read AGENTS.md at repo root.
2. Restate the requirement in one paragraph; ask nothing you can resolve from code.
3. Inspect related code: src/core/services/*, server/rpc.ts, src/db/migrations.ts, src/api/index.ts, relevant pages/components, existing tests.
4. Inspect database relationships (FKs, UNIQUE/CHECK constraints) the change touches.
5. Plan (files, migration version if schema changes, RPC registration via a()/p(), i18n keys under errors.* / perms.* etc., routes/NAV_ROUTES).
6. Implement the smallest correct change following project conventions (requirePermission first in protected functions; db.transaction() around multi-write invariants; AppError + Arabic i18n keys; no new dependencies without approval).
7. Test: npx vitest run <affected suites>, then npm test, then npm run typecheck && npm run typecheck:server; run npm run build for broad changes.
8. Review your own diff against the reviewer checklist (bugs, authz, validation, transactions, ledger integrity, missing tests) and fix findings.
9. Security self-check: permission enforcement backend-only, input validation on all external input, no IDOR (department scoping), no injection, no path traversal.
10. Update .ai/* documentation only if behavior/architecture actually changed.
11. Report per AGENTS.md §9: files changed, database changes (migration version or none), exact commands executed with pass/fail counts, verification performed, remaining risks, anything unverified.

Never claim completion without real verification output.
