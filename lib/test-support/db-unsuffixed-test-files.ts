// Shared by vitest.config.ts (routes these paths to the "integration-unsuffixed" project,
// which gets db-preflight.ts's reachability check) and db-mock-naming.test.ts (asserts no
// OTHER file is in the same situation without either this list or the *.integration.test.ts
// suffix covering it). Kept in its own module, not inline in vitest.config.ts, so the
// structural check can import the list without importing a Vite config as a logic dependency.
//
// Found by grepping every `server/**/*.test.ts` and `lib/**/*.test.ts` file for a real,
// unmocked `@/lib/db` import (i.e. no matching `vi.mock("@/lib/db", ...)` in the same file):
// these keep @/lib/db real on purpose (the CI workflow's own comment on the Postgres service
// names lib/rate-limit.test.ts as one reason it exists) but are named like ordinary unit
// tests, so neither "unit"'s exclude nor "integration"'s include (both keyed off
// `*.integration.test.ts`) ever reaches them. Routed to their own project instead of
// renamed, so this stays test-infrastructure-only — reclassifying the naming convention
// itself is a call for the team to make with the inventory in hand, not something to settle
// by quietly renaming 12 files.
export const DB_UNSUFFIXED_TEST_FILES = [
  "lib/rate-limit.test.ts",
  "server/sales/txn-sequence.test.ts",
  "server/quotations/actions.test.ts",
  "server/transactions/amount-collected-backfill-plan.test.ts",
  "server/invoices/b7-ack-routes.test.ts",
  "server/invoices/b7-payment-ack.test.ts",
  "server/invoices/actions.test.ts",
  "server/invoices/settled-check.test.ts",
  "server/commission/eligibility-threshold-cap.test.ts",
  "server/commission/r4-runcommission-race.test.ts",
  "server/vouchers/get-or-create.test.ts",
  "server/vouchers/route.test.ts",
];
