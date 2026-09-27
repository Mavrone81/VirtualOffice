import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  associate: { findMany: vi.fn() },
  commissionLedger: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { myRankResult } from "./rank";

const grouped = (rows: Array<{ associateId: string; sum: string | number }>) =>
  rows.map((r) => ({ associateId: r.associateId, _sum: { amount: r.sum } }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.associate.findMany.mockResolvedValue([]);
  prismaMock.commissionLedger.groupBy.mockResolvedValue([]);
});

describe("myRankResult — the A-0/R-6 'received' derivation, aggregated in Postgres", () => {
  it("groups by associateId, summing in the DB (not fetching every line into Node)", async () => {
    await myRankResult("a1");
    const call = prismaMock.commissionLedger.groupBy.mock.calls[0][0];
    expect(call.by).toEqual(["associateId"]);
    expect(call._sum).toEqual({ amount: true });
  });

  it("filters on the SETTLING PAYOUT's payoutMonth/status, not the ledger line's own payoutMonth", async () => {
    await myRankResult("a1");
    const call = prismaMock.commissionLedger.groupBy.mock.calls[0][0];
    const thisYear = String(new Date().getFullYear());
    expect(call.where.payout.payoutStatus).toBe("Paid");
    expect(call.where.payout.payoutMonth.startsWith).toBe(`${thisYear}-`);
    expect(call.where.status.not).toBe("Cancelled");
    // The filter must be nested under `payout`, not applied to the ledger
    // line's own payoutMonth field directly — a December-earned line paid
    // out in January belongs to the NEW year (the settlement year), which
    // only the nested payout.payoutMonth filter gets right.
    expect(call.where.payoutMonth).toBeUndefined();
  });

  it("ranks active associates by summed received and returns the requested one's band (spec's 3-associate worked example)", async () => {
    prismaMock.associate.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
    prismaMock.commissionLedger.groupBy.mockResolvedValue(
      grouped([{ associateId: "a1", sum: "300" }, { associateId: "a2", sum: "200" }, { associateId: "a3", sum: "100" }]),
    );
    const r = await myRankResult("a1");
    expect(r?.rank).toBe(1);
    expect(r?.percentile).toBeCloseTo(1 / 3);
    expect(r?.band.id).toBe("top50");
  });

  it("an active associate with no grouped row this year is treated as zero received (the rest)", async () => {
    prismaMock.associate.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    prismaMock.commissionLedger.groupBy.mockResolvedValue(grouped([{ associateId: "a2", sum: "500" }]));
    const r = await myRankResult("a1");
    expect(r?.band.id).toBe("rest");
  });

  it("two associates with equal received tie and share a band", async () => {
    prismaMock.associate.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }]);
    prismaMock.commissionLedger.groupBy.mockResolvedValue(
      grouped([
        { associateId: "a1", sum: "100" },
        { associateId: "a2", sum: "100" },
        { associateId: "a3", sum: "50" },
        { associateId: "a4", sum: "10" },
      ]),
    );
    const r1 = await myRankResult("a1");
    const r2 = await myRankResult("a2");
    expect(r1?.rank).toBe(r2?.rank);
    expect(r1?.band.id).toBe(r2?.band.id);
  });

  it("returns null when the associate isn't in the active population", async () => {
    prismaMock.associate.findMany.mockResolvedValue([{ id: "a2" }]);
    expect(await myRankResult("a1")).toBeNull();
  });

  it("a null Decimal sum from Postgres (shouldn't happen for a grouped row, but don't crash) is treated as zero", async () => {
    prismaMock.associate.findMany.mockResolvedValue([{ id: "a1" }]);
    prismaMock.commissionLedger.groupBy.mockResolvedValue([{ associateId: "a1", _sum: { amount: null } }]);
    const r = await myRankResult("a1");
    expect(r?.band.id).toBe("rest");
  });
});
