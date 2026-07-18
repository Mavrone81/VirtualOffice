import { describe, it, expect } from "vitest";
import { computeProductPreview } from "./commission-preview";

// Mirrors VO_System_Workflows_v7 §6A.2 — every % computes on the Sales Amount.
describe("computeProductPreview", () => {
  it("worked example: $10,000 @ 10% / 2% / 5% / 3% → net 800, retained 8200", () => {
    const p = computeProductPreview({
      salesAmount: "10000",
      closing: { value: "10", percent: true },
      companyCutPool: { value: "2", percent: true },
      smOverride: { value: "5", percent: true },
      sdOverride: { value: "3", percent: true },
    });
    expect(p.closing).toBe("1000");
    expect(p.companyCutPool).toBe("200");
    expect(p.smOverride).toBe("500");
    expect(p.sdOverride).toBe("300");
    expect(p.netToCloser).toBe("800"); // closing − cut pool
    expect(p.companyRetained).toBe("8200"); // sale − closing − sm − sd
    // everything balances to the sale
    const total = ["netToCloser", "companyCutPool", "smOverride", "sdOverride", "companyRetained"]
      .reduce((s, k) => s + Number(p[k as keyof typeof p]), 0);
    expect(total).toBe(10000);
  });

  it("absolute amounts are used as-is (not multiplied by the sale)", () => {
    const p = computeProductPreview({
      salesAmount: "10000",
      closing: { value: "1200", percent: false },
      companyCutPool: { value: "200", percent: false },
      smOverride: { value: "5", percent: true },
      sdOverride: { value: "300", percent: false },
    });
    expect(p.closing).toBe("1200");
    expect(p.companyCutPool).toBe("200");
    expect(p.smOverride).toBe("500"); // 5% of 10000
    expect(p.sdOverride).toBe("300");
    expect(p.netToCloser).toBe("1000"); // 1200 − 200
    expect(p.companyRetained).toBe("8000"); // 10000 − 1200 − 500 − 300
  });
});
