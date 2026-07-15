import { describe, it, expect } from "vitest";
import { saleSchema, comCodeSchema, productSchema, newAssociateSchema, onboardingSchema } from "./schemas";
import { validate } from "./validate";

describe("saleSchema", () => {
  it("rejects empty clientName and empty lines", () => {
    expect(saleSchema.safeParse({ clientName: "", lines: [] }).success).toBe(false);
  });
  it("accepts a valid sale and caps clientName length", () => {
    const ok = saleSchema.safeParse({
      salesDate: "2026-07-01",
      clientName: "Acme",
      paymentPlan: "Full Payment",
      lines: [{ productId: "p1", comCodeIds: ["c1"], lineSaleAmount: 100 }],
    });
    expect(ok.success).toBe(true);
    expect(
      saleSchema.safeParse({
        salesDate: "2026-07-01",
        clientName: "x".repeat(300),
        paymentPlan: "Full Payment",
        lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: 1 }],
      }).success,
    ).toBe(false);
  });
  it("requires at least one line and rejects a non-numeric/negative lineSaleAmount", () => {
    expect(
      saleSchema.safeParse({
        salesDate: "2026-07-01",
        clientName: "Acme",
        paymentPlan: "Full Payment",
        lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: -5 }],
      }).success,
    ).toBe(false);
  });
  it("rejects an unknown paymentPlan", () => {
    expect(
      saleSchema.safeParse({
        salesDate: "2026-07-01",
        clientName: "Acme",
        paymentPlan: "Crypto",
        lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("comCodeSchema", () => {
  it("coerces valueType enum + rejects unknown", () => {
    expect(comCodeSchema.safeParse({ comCode: "A", label: "L", valueType: "Percentage", value: "10" }).success).toBe(true);
    expect(comCodeSchema.safeParse({ comCode: "A", label: "L", valueType: "Nope", value: "10" }).success).toBe(false);
  });
  it("accepts up to 4 decimal places (Decimal(14,4) column)", () => {
    expect(comCodeSchema.safeParse({ comCode: "A", label: "L", valueType: "Absolute", value: "12.3456" }).success).toBe(true);
  });
});

describe("productSchema", () => {
  it("accepts a valid Percentage product and rejects a missing required rate", () => {
    const ok = productSchema.safeParse({
      productCode: "P1",
      productName: "Funeral Plan",
      commissionType: "Percentage",
      closingCommPct: "10",
      companyCutPct: "40",
      asmOverridePct: "5",
      smOverridePct: "10",
      sdOverridePct: "5",
      isExternal: false,
      effectiveDate: "2026-01-01",
    });
    expect(ok.success).toBe(true);
    expect(
      productSchema.safeParse({
        productCode: "P1",
        productName: "Funeral Plan",
        commissionType: "Percentage",
        // companyCutPct missing — required
        asmOverridePct: "5",
        smOverridePct: "10",
        sdOverridePct: "5",
        isExternal: false,
        effectiveDate: "2026-01-01",
      }).success,
    ).toBe(false);
  });
  it("rejects an unknown commissionType", () => {
    expect(
      productSchema.safeParse({
        productCode: "P1",
        productName: "Funeral Plan",
        commissionType: "Weird",
        companyCutPct: "40",
        asmOverridePct: "5",
        smOverridePct: "10",
        sdOverridePct: "5",
        isExternal: false,
        effectiveDate: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});

describe("newAssociateSchema", () => {
  it("accepts a minimal valid associate and rejects a bad email", () => {
    expect(newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesConsultant" }).success).toBe(true);
    expect(
      newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesConsultant", email: "not-an-email" }).success,
    ).toBe(false);
  });
  it("rejects an unknown designation", () => {
    expect(newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "CEO" }).success).toBe(false);
  });
});

describe("onboardingSchema", () => {
  it("rejects junk input and requires nric/paymentMethod/agreementAccepted", () => {
    expect(validate(onboardingSchema, { junk: true })).toEqual({ ok: false });
  });
  it("accepts a valid minimal submission", () => {
    expect(
      onboardingSchema.safeParse({
        nric: "S1234567A",
        paymentMethod: "PayNow",
        agreementAccepted: true,
      }).success,
    ).toBe(true);
  });
});

describe("validate()", () => {
  it("returns {ok:false} without throwing on bad input", () => {
    expect(validate(onboardingSchema, { junk: true })).toEqual({ ok: false });
  });
  it("returns {ok:true, data} on good input", () => {
    const r = validate(comCodeSchema, { comCode: "A", label: "L", valueType: "Percentage", value: "10" });
    expect(r).toEqual({ ok: true, data: { comCode: "A", label: "L", valueType: "Percentage", value: "10" } });
  });
});
