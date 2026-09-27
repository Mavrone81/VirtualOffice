import { describe, it, expect } from "vitest";
import { rankByCommissionReceived, RANK_BANDS, type RankInput } from "./rank-band";

const inputs = (received: number[]): RankInput[] =>
  received.map((r, i) => ({ associateId: `a${i + 1}`, received: r }));

const bandIds = (results: ReturnType<typeof rankByCommissionReceived>) =>
  results.map((r) => r.band.id);

describe("rankByCommissionReceived — band edges", () => {
  it("exactly at the 10% cutoff lands in top10, not top25 (inclusive boundary)", () => {
    // 10 associates, all distinct amounts descending — rank 1's percentile is
    // exactly 1/10 = 0.10, the top10 band's maxPercentile.
    const results = rankByCommissionReceived(inputs([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]));
    expect(results[0].percentile).toBe(0.10);
    expect(results[0].band.id).toBe("top10");
  });

  it("just past a cutoff falls to the next band (exclusive on the far side)", () => {
    // 100 associates: rank 1 -> 0.01 (top1); rank 2 -> 0.02, past top1's 0.01
    // but within top5's 0.05.
    const received = Array.from({ length: 100 }, (_, i) => 100 - i);
    const results = rankByCommissionReceived(inputs(received));
    expect(results[0].band.id).toBe("top1");
    expect(results[1].percentile).toBe(0.02);
    expect(results[1].band.id).toBe("top5");
  });

  it("every RANK_BANDS threshold is reachable at its own exact boundary (100 associates)", () => {
    const received = Array.from({ length: 100 }, (_, i) => 100 - i);
    const results = rankByCommissionReceived(inputs(received));
    // rank N -> percentile N/100 -> exactly matches the Nth-percent cutoffs.
    expect(results[0].band.id).toBe("top1"); // rank 1 -> 0.01
    expect(results[4].band.id).toBe("top5"); // rank 5 -> 0.05
    expect(results[9].band.id).toBe("top10"); // rank 10 -> 0.10
    expect(results[24].band.id).toBe("top25"); // rank 25 -> 0.25
    expect(results[49].band.id).toBe("top50"); // rank 50 -> 0.50
    expect(results[50].band.id).toBe("rest"); // rank 51 -> 0.51
  });
});

describe("rankByCommissionReceived — ties (standard competition ranking, '1224')", () => {
  it("tied associates share the same rank, and the next distinct value skips ahead", () => {
    // 4 associates: two tied at the top, then two more distinct values.
    const results = rankByCommissionReceived(inputs([100, 100, 50, 10]));
    expect(results.map((r) => r.rank)).toEqual([1, 1, 3, 4]); // "1224"-style skip, not 1,1,2,3
  });

  it("tied associates always land in the same band together", () => {
    const results = rankByCommissionReceived(inputs([100, 100, 50, 10]));
    expect(results[0].band.id).toBe(results[1].band.id);
    expect(results[0].percentile).toBe(results[1].percentile);
  });

  it("a 3-way tie for first shares rank 1 and the same percentile", () => {
    const results = rankByCommissionReceived(inputs([50, 50, 50, 10, 5]));
    expect(results.slice(0, 3).every((r) => r.rank === 1)).toBe(true);
    expect(results.slice(0, 3).every((r) => r.percentile === 1 / 5)).toBe(true);
    expect(results[3].rank).toBe(4); // next distinct value skips to position 4
  });
});

describe("rankByCommissionReceived — zero received always lands in the catch-all band", () => {
  it("zero received is 'the rest' even when the raw rank would compute better", () => {
    // A zero-commission associate ranked last of a small population would,
    // by percentile alone, still land in a real band — the override must
    // catch it explicitly, checked before the percentile comparison.
    const results = rankByCommissionReceived(inputs([100, 0]));
    expect(results[1].rank).toBe(2);
    expect(results[1].band.id).toBe("rest");
  });

  it("negative received (bad data) is also always 'the rest', never treated as a top rank", () => {
    const results = rankByCommissionReceived(inputs([100, -5]));
    expect(results[1].band.id).toBe("rest");
  });

  it("all-zero population: everyone lands in 'the rest'", () => {
    const results = rankByCommissionReceived(inputs([0, 0, 0]));
    expect(bandIds(results)).toEqual(["rest", "rest", "rest"]);
  });
});

describe("rankByCommissionReceived — small populations, no special-casing", () => {
  it("3 active associates: ranks land exactly where the spec's worked example says", () => {
    // docs/design/a2-profile-band.md's own worked example.
    const results = rankByCommissionReceived(inputs([300, 200, 100]));
    expect(results[0].percentile).toBeCloseTo(1 / 3);
    expect(results[0].band.id).toBe("top50"); // 0.33 > 0.25, <= 0.50
    expect(results[1].percentile).toBeCloseTo(2 / 3);
    expect(results[1].band.id).toBe("rest"); // 0.67 > 0.50
    expect(results[2].percentile).toBe(1);
    expect(results[2].band.id).toBe("rest");
  });

  it("a single active associate with nonzero received still lands in 'the rest' (percentile 1.0, no special-casing)", () => {
    const results = rankByCommissionReceived(inputs([500]));
    expect(results).toHaveLength(1);
    expect(results[0].rank).toBe(1);
    expect(results[0].percentile).toBe(1);
    expect(results[0].band.id).toBe("rest");
  });

  it("a single active associate with zero received also lands in 'the rest'", () => {
    const results = rankByCommissionReceived(inputs([0]));
    expect(results[0].band.id).toBe("rest");
  });
});

describe("rankByCommissionReceived — empty population", () => {
  it("returns an empty array, doesn't throw", () => {
    expect(rankByCommissionReceived([])).toEqual([]);
  });
});

describe("RANK_BANDS config", () => {
  it("is ordered ascending by maxPercentile, with a single null catch-all at the end", () => {
    const nonNull = RANK_BANDS.filter((b) => b.maxPercentile !== null).map((b) => b.maxPercentile as number);
    expect(nonNull).toEqual([...nonNull].sort((a, b) => a - b));
    expect(RANK_BANDS.filter((b) => b.maxPercentile === null)).toHaveLength(1);
    expect(RANK_BANDS[RANK_BANDS.length - 1].maxPercentile).toBeNull();
  });

  it("every band has a non-empty id (used as the messages key portal.dashboard.band.<id>)", () => {
    for (const b of RANK_BANDS) {
      expect(b.id.length).toBeGreaterThan(0);
    }
  });
});
