import { describe, it, expect, vi } from "vitest";

// A fake table: findMany actually applies the where-clause's payoutStatus
// filter, so a regression that widens or drops the filter shows up here
// rather than only in the arguments the mock was called with. Uses the raw
// enum strings (not the @prisma/client import) so vi.hoisted has no TDZ.
const { findMany } = vi.hoisted(() => {
  const rows = [
    { totalPayable: "1200.50", payoutStatus: "Paid" },
    { totalPayable: "300", payoutStatus: "Paid" },
    { totalPayable: "9999", payoutStatus: "Approved" },
    { totalPayable: "500", payoutStatus: "Pending" },
  ];
  return {
    findMany: vi.fn(async ({ where }: { where: { payoutStatus: string } }) =>
      rows.filter((r) => r.payoutStatus === where.payoutStatus).map((r) => ({ totalPayable: r.totalPayable })),
    ),
  };
});
vi.mock("@/lib/db", () => ({ prisma: { monthlyPayout: { findMany } } }));

import { totalGrossCommissionPaid } from "./metrics";

describe("totalGrossCommissionPaid — B-1 admin dashboard tile", () => {
  it("sums totalPayable across Paid payouts only, org-wide", async () => {
    const total = await totalGrossCommissionPaid();
    expect(total.toString()).toBe("1500.5"); // 1200.50 + 300 — the Approved and Pending rows are excluded
  });

  it("an Approved-but-unpaid payout is not counted", async () => {
    const total = await totalGrossCommissionPaid();
    // If Approved leaked in, the total would include 9999.
    expect(Number(total)).toBeLessThan(9999);
  });

  it("no Paid payouts at all → zero", async () => {
    findMany.mockImplementationOnce(async () => []);
    const total = await totalGrossCommissionPaid();
    expect(total.toString()).toBe("0");
  });
});
