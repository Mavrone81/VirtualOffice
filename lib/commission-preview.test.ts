import { describe, it, expect } from "vitest";
import { CommissionType, ComValueType, Designation, LedgerLineType } from "@prisma/client";
import { computeProductPreview } from "./commission-preview";
import { computeLineCommission } from "@/server/commission/engine";

// Mirrors VO_System_Workflows_v7 §6A.2 — every % computes on the Sales Amount.
describe("computeProductPreview", () => {
  it("worked example: $10,000 @ 10% / 2% / 5% / 3% → net 800, retained 8400", () => {
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
    expect(p.companyRetained).toBe("8400"); // sale − net to closer − sm − sd (company's total take)
    // everything balances to the sale (the cut pool sits inside company retained)
    const total = ["netToCloser", "smOverride", "sdOverride", "companyRetained"]
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
    expect(p.companyRetained).toBe("8200"); // 10000 − 1000 − 500 − 300
  });

  it("100% closing: company retained = cut pool − overrides (never negative from the pool)", () => {
    // The case that showed −$300 on the product form (2026-09-21).
    const p = computeProductPreview({
      salesAmount: "10000",
      closing: { value: "100", percent: true },
      companyCutPool: { value: "10", percent: true },
      smOverride: { value: "2", percent: true },
      sdOverride: { value: "1", percent: true },
    });
    expect(p.closing).toBe("10000");
    expect(p.companyCutPool).toBe("1000");
    expect(p.netToCloser).toBe("9000");
    expect(p.companyRetained).toBe("700"); // 1000 − 200 − 100
  });

  // The preview exists to show what the engine will book. Pin them together so
  // the "Company retained" figure can never drift from the ledger again.
  it.each([
    { closing: "100", pool: "10", sm: "2", sd: "1" },
    { closing: "10", pool: "2", sm: "5", sd: "3" },
    { closing: "35", pool: "5", sm: "3", sd: "1.5" },
  ])("matches the engine's CompanyRetained line (closing $closing%)", ({ closing, pool, sm, sd }) => {
    const p = computeProductPreview({
      salesAmount: "10000",
      closing: { value: closing, percent: true },
      companyCutPool: { value: pool, percent: true },
      smOverride: { value: sm, percent: true },
      sdOverride: { value: sd, percent: true },
    });
    const upline = (id: string) => ({ associateId: id, designation: Designation.SalesManager, eligible: true });
    const r = computeLineCommission({
      lineItemId: "l1",
      commissionType: CommissionType.Percentage,
      lineSaleAmount: "10000",
      closingCommPct: closing,
      companyCutPct: pool, companyCutType: ComValueType.Percentage,
      smOverridePct: sm, smOverrideType: ComValueType.Percentage,
      sdOverridePct: sd, sdOverrideType: ComValueType.Percentage,
      isExternal: false,
      comCodes: [],
      closer: { associateId: "c", designation: Designation.SalesAssociate },
      directUpline: upline("u1"),
      secondUpline: upline("u2"),
    });
    const company = r.lines.find((l) => l.lineType === LedgerLineType.CompanyRetained)!;
    expect(r.reconciles).toBe(true);
    expect(company.amount.toString()).toBe(p.companyRetained);
  });
});
