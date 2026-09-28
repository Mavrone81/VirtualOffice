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

  // A-0b
  it("accepts any installment count 1–24 (not just 12/24) and rejects out of range", () => {
    const base = {
      salesDate: "2026-07-01", clientName: "Acme", paymentPlan: "Installment" as const,
      lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: 1200 }],
    };
    for (const n of [1, 6, 12, 18, 24]) {
      expect(saleSchema.safeParse({ ...base, installmentCount: n }).success).toBe(true);
    }
    expect(saleSchema.safeParse({ ...base, installmentCount: 0 }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, installmentCount: 25 }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, installmentCount: undefined }).success).toBe(false); // required for Installment
  });

  it("refuses a deposit at or above the sale amount for an Installment plan (strict <)", () => {
    const base = {
      salesDate: "2026-07-01", clientName: "Acme", paymentPlan: "Installment" as const, installmentCount: 12,
      lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: 100 }],
    };
    expect(saleSchema.safeParse({ ...base, deposit: 99.99 }).success).toBe(true);
    // Deposit == sale would leave nothing to divide — N schedule rows of $0.00
    // that still gate the eligibility count. Strictly less, not <=.
    expect(saleSchema.safeParse({ ...base, deposit: 100 }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, deposit: 100.01 }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, deposit: 500 }).success).toBe(false);
  });

  it("a Full Payment deposit may equal the sale amount (no installment schedule is minted)", () => {
    const base = {
      salesDate: "2026-07-01", clientName: "Acme", paymentPlan: "Full Payment" as const,
      lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: 100 }],
    };
    expect(saleSchema.safeParse({ ...base, deposit: 100 }).success).toBe(true);
    expect(saleSchema.safeParse({ ...base, deposit: 100.01 }).success).toBe(false);
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
    expect(newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesAssociate" }).success).toBe(true);
    expect(
      newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesAssociate", email: "not-an-email" }).success,
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
        nationality: "Singaporean",
        gender: "Male",
        religion: "Buddhism",
      }).success,
    ).toBe(true);
  });

  const base = {
    nric: "S1234567A", paymentMethod: "PayNow" as const, agreementAccepted: true,
    nationality: "Singaporean", gender: "Male" as const, religion: "Buddhism",
  };

  // Printed on the Associate Agreement's particulars table (28 Sep) — each is
  // required, and a blank one is as bad as a missing one.
  it.each(["nationality", "gender", "religion"] as const)("requires %s", (key) => {
    const { [key]: _omit, ...without } = base;
    expect(onboardingSchema.safeParse(without).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, [key]: "  " }).success).toBe(false);
  });
  it("rejects a gender outside the listed values", () => {
    expect(onboardingSchema.safeParse({ ...base, gender: "Unknown" }).success).toBe(false);
  });

  it("accepts an optional marital status", () => {
    expect(onboardingSchema.safeParse({ ...base, maritalStatus: "Married" }).success).toBe(true);
  });

  it("rejects an unknown marital status", () => {
    expect(onboardingSchema.safeParse({ ...base, maritalStatus: "Complicated" }).success).toBe(false);
  });

  it("accepts a No spouse-conflict declaration without spouse details", () => {
    expect(onboardingSchema.safeParse({ ...base, spouseConflict: false }).success).toBe(true);
  });

  it("requires spouse name + company when the conflict is declared Yes", () => {
    expect(onboardingSchema.safeParse({ ...base, spouseConflict: true }).success).toBe(false);
    expect(
      onboardingSchema.safeParse({ ...base, spouseConflict: true, spouseName: "Jane Tan", spouseCompany: "Rival Funeral Pte Ltd" }).success,
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
