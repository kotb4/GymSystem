---
description: Run project tests and analyze results honestly
agent: tester
---
Run and analyze Yassen Mohamed Kotb | 01288536381 tests. Scope: $ARGUMENTS (a specific suite name, or empty = full suite).

Use ONLY these verified commands from AGENTS.md §2:
- Full unit suite: npm test
- Single suite: npx vitest run tests/<file>.test.ts  (available suites live in tests/)
- Type gates: npm run typecheck && npm run typecheck:server
- Broad-change gate: npm run build
- E2E (only if explicitly requested): npm run e2e

Report exactly per your agent format: Tests Executed (commands), Passed (counts), Failed (names + failure analysis), Unverified (could not run + why), Missing Coverage (behaviors without tests), Recommended Tests (concrete cases using createTestDb()/buildActor() style). Never claim success without executed output.
