---
description: Read-only code review of current changes
agent: reviewer
---
Review the current changes read-only. Scope: $ARGUMENTS (if empty, review uncommitted changes via git diff).

Checklist (from AGENTS.md): bugs, regressions, architecture violations (fetch outside src/api, logic in frontend), incorrect business behavior vs .ai/business-rules.md, database problems (missing transactions, FK order, schema without migration), security (requirePermission gaps, department scoping/IDOR, validation, injection, path traversal), error handling (AppError + i18n keys), duplicate logic, performance, missing tests.

For every issue output [SEVERITY] CRITICAL/HIGH/MEDIUM/LOW with Location, Problem, Impact, Recommended Fix.

End with verdict: APPROVE / APPROVE WITH FIXES / REQUEST CHANGES, plus a "Not verified" list. Do not modify any files.
