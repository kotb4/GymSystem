---
description: Read-only analysis of a feature, module or problem against the real codebase
agent: planner
---
Perform a read-only analysis for: $ARGUMENTS

Rules:
- Read AGENTS.md first, then .ai/architecture.md and .ai/business-rules.md.
- Inspect the actual code (services, rpc registry, migrations schema, pages, api wrappers) and the tests covering the area.
- Trace database relationships and constraints touched by the topic.
- Identify dependencies, edge cases, and risks with severity ratings.
- Do NOT modify any application source file. This is analysis only.

Deliver:
1. Current state (with file:line references)
2. How it works today (data flow)
3. Dependencies and related modules
4. Edge cases and risks (CRITICAL/HIGH/MEDIUM/LOW)
5. Open questions / UNKNOWN items requiring human confirmation
