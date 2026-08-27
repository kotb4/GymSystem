# Yassen Mohamed Kotb | 01288536381 Testing

## Test Framework

- **Vitest** v4.1.11, node environment
- **20 test files** in `tests/`
- Tests run against in-memory SQLite (`createTestDb()`)
- No external services, no network, no browser

## Running

```bash
npm test                          # All tests
npm run test:watch                # Watch mode
npx vitest run tests/finance.test.ts   # Single file
```

## Test Files

| File | Subject | Key Scenarios |
|------|---------|---------------|
| `foundation.smoke.test.ts` | DB engine, migrations | Core DB operations, migration applies, schema version |
| `auth.users.test.ts` | Auth & user management | Setup, login, lockout, password change, user CRUD, permissions |
| `members.subscriptions.test.ts` | Members & subscriptions | CRUD, overlap detection, freeze/unfreeze, renew, cancel, purge |
| `cards.checkin.test.ts` | Cards & check-in | Register, assign, check-in flow, denied reasons, duplicate window, checkout |
| `finance.test.ts` | Payments & finance | Record payment, discount, void, refund, ledger, reports, overview, outstanding |
| `expenses.test.ts` | Expenses | Create, update, void, categories, attachments |
| `store.test.ts` | Store/POS | Products, stock, sales, credit, repayments, void, debt tracking |
| `classes.test.ts` | Classes & bookings | CRUD, sessions, capacity, booking, cancel, consume session |
| `employees.test.ts` | Employees & salaries | CRUD, salary types, pay salary → expense + ledger |
| `inbody.test.ts` | Body assessments | Create, delete, progress, fitness tests |
| `crm.test.ts` | CRM | Templates, messages, dedup, generation |
| `backup-authz.test.ts` | Backup authorization | Permission checks for backup/restore |
| `part4-backup.test.ts` | Backup operations | Create, verify, file integrity |
| `restore-authz.test.ts` | Restore authorization | Restore permission checks |
| `review-fixes.test.ts` | Regression fixes | Targeted tests for discovered bugs |
| `department-scope.test.ts` | Department isolation | Cross-section access, list scoping, bypass |
| `manager-permissions.test.ts` | Manager permissions | Migration v7, settings.edit, owner immutability |
| `purge-others.test.ts` | Hard-delete | Employee/product/cash session purge cascades |
| `subscriptions-purge.test.ts` | Subscription purge | Payment/ledger cascade on subscription delete |
| `i18n-coverage.test.ts` | i18n coverage | Ensures all thrown error keys exist in ar.ts, all permissions translated |

## Test Helpers

| File | Purpose |
|------|---------|
| `tests/helpers/test-db.ts` | `createTestDb()` — creates in-memory SQLite, runs all migrations |
| `tests/helpers/node.driver.ts` | `NodeSqliteDriver` for `:memory:` SQLite (no WAL, FK enforcement ON) |

## Test Patterns

### Setup

Every test file uses:
```ts
let db: Db;
let owner: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, { gymName: "Yassen Mohamed Kotb | 01288536381", ... });
  owner = buildActor(ownerUser);
});
```

### Testing Permissions

```ts
it("denies trainer from creating classes", () => {
  expect(syncAppError(() => createClass(db, trainer, { name: "Yoga" })).code).toBe("FORBIDDEN");
});
```

### Testing Money

All money is in minor units (piastres). Tests use `25_000` for 250 EGP.

### Testing Transactions

Tests exercise transaction rollback scenarios by verifying side effects are absent when errors occur.

### Testing Financial Ledger

Tests verify: payment creates ledger entry, void creates reversal, refund creates reversal, double-void blocked, double-reversal guard works.

## Verification Checklist

After making changes:

1. `npm run typecheck` — frontend TypeScript
2. `npm run typecheck:server` — backend TypeScript
3. `npm test` — all unit tests
4. `npm run build` — full build (catches type errors + bundling issues)
5. `node scripts/check-rpc-consistency.cjs` — RPC wiring check (if RPCs changed)
