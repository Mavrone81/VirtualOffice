import { describe, it, expect } from "vitest";
import { CommissionType, ComValueType, Designation } from "@prisma/client";
import { computeProductBreakdown, type BreakdownProduct } from "./product-breakdown";
import { computeLineCommission } from "./engine";

const base: BreakdownProduct = {
  productCode: "P1", productName: "Product One", isExternal: false, externalCompanyRetainedPct: null,
  commissionType: CommissionType.Percentage, closingCommPct: "100", closingCommFixed: null,
  companyCutPct: "10", companyCutType: ComValueType.Percentage,
  smOverridePct: "3", smOverrideType: ComValueType.Percentage,
  sdOverridePct: "2", sdOverrideType: ComValueType.Percentage,
};

describe("computeProductBreakdown — B-6 per-product breakdown table", () => {
  it("pure-percentage: shows the configured split as rates (base-100 of computeProductPreview, no new formula)", () => {
    const row = computeProductBreakdown(base);
    expect(row).toEqual({
      productCode: "P1", productName: "Product One", kind: "uniform",
      netToCloser: "90%", directOverride: "3%", secondOverride: "2%", companyRetained: "5%",
    });
  });

  it("pure-percentage: keeps all 4dp of a Decimal(7,4) rate, not rounded to 2dp (Architect review)", () => {
    const product: BreakdownProduct = {
      ...base, productCode: "P1B", productName: "Product One B",
      closingCommPct: "100", companyCutPct: "10.1234",
      smOverridePct: "3.5678", sdOverridePct: "2.1111",
    };
    const row = computeProductBreakdown(product);
    expect(row).toEqual({
      productCode: "P1B", productName: "Product One B", kind: "uniform",
      netToCloser: "89.8766%", // 100 - 10.1234
      directOverride: "3.5678%",
      secondOverride: "2.1111%",
      companyRetained: "4.4445%", // 100 - 89.8766 - 3.5678 - 2.1111
    });
  });

  it("pure-Fixed/Absolute: net to closer / overrides are $ constants; Company retained is the 'Sale − X' expression", () => {
    const product: BreakdownProduct = {
      ...base, productCode: "P2", productName: "Product Two",
      commissionType: CommissionType.Fixed, closingCommFixed: "550", closingCommPct: null,
      companyCutPct: "50", companyCutType: ComValueType.Absolute,
      smOverridePct: "30", smOverrideType: ComValueType.Absolute,
      sdOverridePct: "20", sdOverrideType: ComValueType.Absolute,
    };
    const row = computeProductBreakdown(product);
    expect(row).toEqual({
      productCode: "P2", productName: "Product Two", kind: "uniform",
      netToCloser: "S$500.00", directOverride: "S$30.00", secondOverride: "S$20.00",
      companyRetained: "S$550.00", companyRetainedIsExpression: true,
    });
  });

  it("the pure-Fixed row's X equals the engine's (sale − CompanyRetained) at two different sale amounts", () => {
    const rates = {
      commissionType: CommissionType.Fixed, closingCommFixed: "550",
      companyCutPct: "50", companyCutType: ComValueType.Absolute,
      smOverridePct: "30", smOverrideType: ComValueType.Absolute,
      sdOverridePct: "20", sdOverrideType: ComValueType.Absolute,
      isExternal: false, comCodes: [],
      closer: { associateId: "c", designation: Designation.SalesAssociate },
      directUpline: { associateId: "u1", designation: Designation.SalesManager, eligible: true },
      secondUpline: { associateId: "u2", designation: Designation.SalesDirector, eligible: true },
    };
    const expectedX = 550; // netToCloser(500) + direct(30) + second(20), sale-independent

    for (const sale of ["1000", "5000"]) {
      const r = computeLineCommission({ lineItemId: "l1", lineSaleAmount: sale, ...rates });
      const companyTake = r.lines.find((l) => l.lineType === "CompanyRetained")!.amount;
      expect(Number(sale) - companyTake.toNumber()).toBe(expectedX);
    }
  });

  it("mixed: some fields % and others $ — overrides shown in their own unit, no derived net/retained", () => {
    const product: BreakdownProduct = {
      ...base, productCode: "P3", productName: "Product Three",
      commissionType: CommissionType.Fixed, closingCommFixed: "550", closingCommPct: null,
      companyCutPct: "10", companyCutType: ComValueType.Percentage, // mixed with a Fixed closing
      smOverridePct: "30", smOverrideType: ComValueType.Absolute,
      sdOverridePct: "2", sdOverrideType: ComValueType.Percentage,
    };
    const row = computeProductBreakdown(product);
    expect(row).toEqual({
      productCode: "P3", productName: "Product Three", kind: "mixed",
      directOverride: "S$30.00", secondOverride: "2%",
    });
  });

  it("external: doesn't run through the engine — shows a flat provider/company split", () => {
    const product: BreakdownProduct = { ...base, productCode: "P4", productName: "Product Four", isExternal: true, externalCompanyRetainedPct: "5" };
    const row = computeProductBreakdown(product);
    expect(row).toEqual({
      productCode: "P4", productName: "Product Four", kind: "external",
      providerKeepsPct: "95%", companyRetainedPct: "5%",
    });
  });
});
