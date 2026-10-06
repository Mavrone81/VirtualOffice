import { describe, it, expect } from "vitest";
import { CommissionType, ComValueType, Designation, LedgerLineType } from "@prisma/client";
import { computeProductPreview, isOverAllocated } from "./commission-preview";
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
    // The product form's default rates (B-10, 2026-09-26): closing 100 / cut 10 / direct 3 / second 2.
    const p = computeProductPreview({
      salesAmount: "10000",
      closing: { value: "100", percent: true },
      companyCutPool: { value: "10", percent: true },
      smOverride: { value: "3", percent: true },
      sdOverride: { value: "2", percent: true },
    });
    expect(p.closing).toBe("10000");
    expect(p.companyCutPool).toBe("1000");
    expect(p.netToCloser).toBe("9000");
    expect(p.companyRetained).toBe("500"); // 1000 − 300 − 200
    expect(isOverAllocated(p)).toBe(false);
  });

  it("over-allocated: direct + second overrides exceed the cut pool at 100% closing (B-10 warning)", () => {
    const p = computeProductPreview({
      salesAmount: "10000",
      closing: { value: "100", percent: true },
      companyCutPool: { value: "10", percent: true },
      smOverride: { value: "6", percent: true },
      sdOverride: { value: "5", percent: true },
    });
    expect(p.companyRetained).toBe("-100"); // 1000 − 600 − 500
    expect(isOverAllocated(p)).toBe(true);
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

  // T6 (item 4 brief): the same pin, for EXTERNAL products. This exact class
  // of drift already happened once for internal (the header comment above),
  // where the preview showed -$300 while the engine booked $700 — a preview
  // that disagrees with the engine is worse than no preview, since the admin
  // configures against a number that is not what gets paid. Three cases,
  // including one that goes negative (the owner's own worked example).
  it.each([
    { closing: "10", pool: "2", sm: "5", sd: "3", retained: "5" }, // owner's worked example: company goes negative
    { closing: "100", pool: "10", sm: "2", sd: "1", retained: "20" },
    { closing: "0", pool: "0", sm: "0", sd: "0", retained: "5" },
  ])(
    "EXTERNAL matches the engine's CompanyRetained AND ExternalPayable lines (closing $closing%, retained $retained%)",
    ({ closing, pool, sm, sd, retained }) => {
      const p = computeProductPreview({
        salesAmount: "10000",
        closing: { value: closing, percent: true },
        companyCutPool: { value: pool, percent: true },
        smOverride: { value: sm, percent: true },
        sdOverride: { value: sd, percent: true },
        isExternal: true,
        externalRetainedPct: retained,
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
        isExternal: true,
        externalCompanyRetainedPct: retained,
        comCodes: [],
        closer: { associateId: "c", designation: Designation.SalesAssociate },
        directUpline: upline("u1"),
        secondUpline: upline("u2"),
      });
      const company = r.lines.find((l) => l.lineType === LedgerLineType.CompanyRetained)!;
      const payable = r.lines.find((l) => l.lineType === LedgerLineType.ExternalPayable)!;
      const closerLine = r.lines.find((l) => l.lineType === LedgerLineType.Personal && l.associateId === "c")!;
      expect(r.reconciles).toBe(true);
      // netToCloser agreement is the point of T6 — assert it directly (the
      // closer's own ledger line carries it as basisAmount), not just the
      // two totals it feeds into.
      expect(closerLine.basisAmount.toString()).toBe(p.netToCloser);
      expect(company.amount.toString()).toBe(p.companyRetained);
      expect(payable.amount.toString()).toBe(p.externalPayable);
    },
  );
});
