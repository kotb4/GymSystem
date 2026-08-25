---
description: Synchronize AI docs (.ai/*, AGENTS.md) with actual code
agent: docs
---
Synchronize AI documentation with the real codebase. Target (optional): $ARGUMENTS (a specific .ai file or AGENTS.md).

Process:
1. Re-verify claims against code: package.json scripts, src/core/services/, src/db/migrations.ts schema, server/index.ts + rpc.ts endpoints, tests/ inventory, src/i18n/ar.ts.
2. Update ONLY: AGENTS.md and .ai/** files. Never touch application source, tests, configs, or dependencies.
3. Correct stale facts (e.g., feature lists, test counts, module inventories), keep verified file references, mark anything unverifiable as UNKNOWN — REQUIRES CONFIRMATION or NOT IMPLEMENTED.
4. Append to .ai/decisions.md only decisions that were actually made and communicated; never fabricate history.

Reply with: files updated, corrections made (old claim → new verified fact with reference), items marked UNKNOWN, and anything requiring an application-code change that you refused to make.
