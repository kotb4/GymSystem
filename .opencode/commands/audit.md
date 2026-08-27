---
description: Comprehensive read-only project audit; writes report to .ai/audits/latest.md
---
Perform a comprehensive audit of Yassen Mohamed Kotb | 01288536381. Focus area (optional): $ARGUMENTS

Scope — inspect the actual code for each area and rate findings CRITICAL/HIGH/MEDIUM/LOW:
1. Architecture consistency (AGENTS.md §3 vs reality; fetch boundaries, service layer purity)
2. Database (migrations integrity, transactions around invariants, CHECK/UNIQUE/FK usage, ledger rules, FK-safe purge order)
3. Backend routes & RPC whitelist (server/index.ts, server/rpc.ts)
4. Frontend structure (pages/components, api wrappers, routes/permissions gating)
5. Authentication & sessions (auth.service, server/sessions.ts)
6. Authorization (requirePermission coverage across all services; department scoping assertDepartmentAccess)
7. Business logic vs .ai/business-rules.md (subscriptions/freeze/renew/cancel, payments/refund/void ledger guards, store debts, classes capacity)
8. Validation & error handling (AppError + i18n keys coverage; tests/i18n-coverage.test.ts green?)
9. Security (IDOR, injection, path traversal, secrets) — apply the security agent checklist
10. Performance hotspots (N+1 loops, unbounded queries)
11. Dependencies & build health (package.json scripts; run npm run typecheck && npm run typecheck:server && npm test and record real results)
12. Dead/duplicate code, API consistency between services ↔ rpc.ts ↔ src/api/index.ts
13. Data integrity risks

Hard rules: do NOT modify application source code. The ONLY file you may write is the report.

Write the full report to .ai/audits/latest.md with sections: Executive Summary · Methodology · Findings ([SEVERITY] + Location + Evidence + Impact + Fix) · Verification commands actually executed with results · Not inspected / UNKNOWN. If a previous latest.md exists with content, move it to .ai/audits/history/YYYY-MM-DD-audit.md first.

Finish by replying with the executive summary only.
