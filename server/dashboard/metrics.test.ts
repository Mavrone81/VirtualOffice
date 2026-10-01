import { describe, it, expect, vi } from "vitest";

// A fake table: findMany actually applies the where-clause's payoutStatus
// filter, so a regression that widens or drops the filter shows up here
// rather than only in the arguments the mock was called with. Uses the raw
// enum strings (not the @prisma/client import) so vi.hoisted has no TDZ.
const { findMany, ledgerFindMany, transactionFindMany } = vi.hoisted(() => {
  const rows = [
    { totalPayable: "1200.50", payoutStatus: "Paid" },
    { totalPayable: "300", payoutStatus: "Paid" },
    { totalPayable: "9999", payoutStatus: "Approved" },
    { totalPayable: "500", payoutStatus: "Pending" },
  ];
  // CommissionLedger fake, shared by dashboardMetrics.grossReceived and
  // receivedInYear — no application path can produce a real Cancelled row
  // (the engine only ever creates Pending/Eligible), so this is a HAND-BUILT
  // row, not something a flow test could seed. r2 is deliberately "Paid
  // payout" AND "Cancelled" at once: it must be excluded from a "received"
  // aggregate for the Cancelled reason specifically, not because the payout
  // wasn't paid — r3 covers the "payout not Paid" exclusion separately, so
  // the two reasons can't be confused with each other.
  const ledgerRows = [
    { id: "r1", associateId: "a1", amount: "100.00", status: "Eligible", payoutId: "p1" },
    { id: "r2", associateId: "a1", amount: "50.00", status: "Cancelled", payoutId: "p1" },
    { id: "r3", associateId: "a2", amount: "75.00", status: "Eligible", payoutId: "p2" },
  ];
  const payouts: Record<string, { payoutStatus: string; payoutMonth: string }> = {
    p1: { payoutStatus: "Paid", payoutMonth: "2099-07" },
    p2: { payoutStatus: "Pending", payoutMonth: "2099-07" },
  };
  type LedgerWhere = {
    associateId?: string | { in: string[] };
    status?: string | { not: string };
    payout?: { payoutStatus?: string; payoutMonth?: { startsWith: string } };
  };
  function matches(row: (typeof ledgerRows)[number], where: LedgerWhere): boolean {
    const payout = payouts[row.payoutId];
    if (where.associateId) {
      if (typeof where.associateId === "string") { if (row.associateId !== where.associateId) return false; }
      else if (!where.associateId.in.includes(row.associateId)) return false;
    }
    if (where.status) {
      if (typeof where.status === "string") { if (row.status !== where.status) return false; }
      else if (row.status === where.status.not) return false;
    }
    if (where.payout) {
      if (where.payout.payoutStatus && payout.payoutStatus !== where.payout.payoutStatus) return false;
      if (where.payout.payoutMonth && !payout.payoutMonth.startsWith(where.payout.payoutMonth.startsWith)) return false;
    }
    return true;
  }
  // SalesTransaction fake for totalAmountCollected (B-1) — deliberately a
  // DIFFERENT total from the Paid-payouts sum above (1500.50), so a test
  // asserting against this fixture fails on the pre-fix code, which read
  // monthlyPayout (money paid OUT to associates) instead of amountCollected
  // (money collected FROM customers — owner's ruling, 02 Oct).
  const transactionRows = [
    { saleAmount: "1000.00", amountCollected: "400.25" },
    { saleAmount: "2000.00", amountCollected: "600.00" },
    { saleAmount: "500.00", amountCollected: "0" }, // nothing collected yet — counts as 0, not excluded
  ];
  return {
    findMany: vi.fn(async ({ where }: { where: { payoutStatus: string } }) =>
      rows.filter((r) => r.payoutStatus === where.payoutStatus).map((r) => ({ totalPayable: r.totalPayable })),
    ),
    ledgerFindMany: vi.fn(async ({ where }: { where: LedgerWhere }) =>
      ledgerRows.filter((r) => matches(r, where)).map((r) => ({ amount: r.amount, status: r.status, payout: payouts[r.payoutId] })),
    ),
    transactionFindMany: vi.fn<(args?: { where?: unknown }) => Promise<typeof transactionRows>>(async () => transactionRows),
  };
});
vi.mock("@/lib/db", () => ({
  prisma: { monthlyPayout: { findMany }, commissionLedger: { findMany: ledgerFindMany }, salesTransaction: { findMany: transactionFindMany } },
}));

import { totalAmountCollected, dashboardMetrics, receivedInYear } from "./metrics";

describe("totalAmountCollected — B-1 admin dashboard tile (owner's ruling, 02 Oct: 'Paid' = collected from customers)", () => {
  it("sums amountCollected across SalesTransaction, org-wide — NOT Paid payouts", async () => {
    const total = await totalAmountCollected();
    // 400.25 + 600.00 + 0 = 1000.25. The old code (summed Paid MonthlyPayouts)
    // would return 1500.50 against this same fixture — a different source
    // entirely, which is exactly the bug this test exists to catch.
    expect(total.toString()).toBe("1000.25");
  });

  it("CONTROL: the query carries no amountCollected filter — the zero row reaches the sum unfiltered, rather than being excluded at the DB layer where this test couldn't see it", async () => {
    transactionFindMany.mockClear();
    await totalAmountCollected();
    const [arg] = transactionFindMany.mock.calls.at(-1)!;
    expect(arg?.where).toBeUndefined();
    // Liveness: the exact call still returns all 3 rows including the
    // 0-amountCollected one — without this, a fixture that silently dropped
    // it would make the "no where" assertion above pass for the wrong reason.
    const rows = await transactionFindMany(arg);
    expect(rows).toHaveLength(3);
  });

  it("no transactions at all → zero", async () => {
    transactionFindMany.mockImplementationOnce(async () => []);
    const total = await totalAmountCollected();
    expect(total.toString()).toBe("0");
  });

  it("CONTROL: the Paid-payouts total (what the old code read) differs from amountCollected's total — proves the two sources are genuinely different, not coincidentally equal", async () => {
    const payoutTotal = await findMany({ where: { payoutStatus: "Paid" } });
    const payoutSum = payoutTotal.reduce((s: number, r: { totalPayable: string }) => s + Number(r.totalPayable), 0);
    expect(payoutSum).toBe(1500.5);
    expect((await totalAmountCollected()).toString()).not.toBe(String(payoutSum));
  });
});

// Consistency fix (2026-10-01): grossReceived and receivedInYear must exclude
// Cancelled, matching rank.ts/my-commissions.ts/my-share.ts — see the comment
// at LedgerStatus in prisma/schema.prisma. Dormant today (nothing creates a
// Cancelled row), which is exactly why r2 above is hand-built into the fake
// table rather than produced by a real flow.
describe("dashboardMetrics.grossReceived — excludes Cancelled even when its payout is Paid", () => {
  it("sums only the Eligible+Paid row — the Cancelled+Paid row (r2, same payout) is excluded for its OWN reason, not because its payout wasn't paid", async () => {
    const m = await dashboardMetrics(null);
    // r1 (Eligible, Paid) = 100.00. r2 (Cancelled, Paid) = 50.00 must NOT be
    // added — if the status filter were removed, this would read 150.
    expect(m.grossReceived.toString()).toBe("100");
  });

  it("CONTROL: the Cancelled row reaches grossReceived's input unfiltered — the ledger query itself carries no status predicate, so dashboardMetrics fetches r2 and excludes it in code, not via the DB query excluding it first", async () => {
    ledgerFindMany.mockClear();
    await dashboardMetrics(["a1"]);
    const [{ where }] = ledgerFindMany.mock.calls.at(-1)!;
    expect(where).not.toHaveProperty("status");
    // Liveness: the exact where the real call used still returns BOTH r1 and
    // r2 — without this, a fixture that silently lost r2 would make the
    // "no status key" assertion above pass AND the primary test's "100"
    // pass, for the wrong reason (nothing to exclude, not a working filter).
    const rows = await ledgerFindMany({ where });
    expect(rows).toHaveLength(2);
  });
});

describe("receivedInYear — excludes Cancelled even when its payout is Paid and in the right year", () => {
  it("returns only r1 — r2 matches associateId/payout status/payout month exactly like r1, differing ONLY in status", async () => {
    const lines = await receivedInYear("a1", "2099");
    expect(lines).toEqual([{ amount: "100.00", payoutMonth: "2099-07" }]);
  });

  it("CONTROL: r2 passes every OTHER predicate the real query uses — the REAL where receivedInYear sent, with only the status clause removed, returns BOTH rows, so status is the one thing keeping r2 out, not associateId/payout/month incidentally doing the job", async () => {
    ledgerFindMany.mockClear();
    await receivedInYear("a1", "2099");
    const [{ where }] = ledgerFindMany.mock.calls.at(-1)!;
    // Taken from the real call, not hand-reconstructed — if production's
    // where shape ever changes, this control changes with it instead of
    // silently testing a predicate nothing uses anymore. `delete` rather
    // than destructure-to-omit: `status` is optional on LedgerWhere, so this
    // needs no unused binding at all (no `_status`), not just a quieted one.
    const withoutStatus = { ...where };
    delete withoutStatus.status;
    const rows = await ledgerFindMany({ where: withoutStatus });
    expect(rows).toHaveLength(2);
  });
});
