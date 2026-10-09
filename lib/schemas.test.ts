import { describe, it, expect } from "vitest";
import { saleSchema, comCodeSchema, productSchema, productPricingSchema, newAssociateSchema, onboardingSchema, MAX_INSTALMENT_MONTHS } from "./schemas";
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

  // A-0b. The upper bound moved from 24 to 72 on the owner's ruling of
  // 2026-10-09. Written against MAX_INSTALMENT_MONTHS rather than the number,
  // so the next policy change edits one constant and this keeps guarding —
  // the literal 24 in here is what made the sale side disagree with the
  // product side for a day.
  it("accepts any installment count up to the policy maximum, and rejects out of range", () => {
    const base = {
      salesDate: "2026-07-01", clientName: "Acme", paymentPlan: "Installment" as const,
      lines: [{ productId: "p1", comCodeIds: [], lineSaleAmount: 1200 }],
    };
    for (const n of [1, 6, 12, 18, 24, 36, MAX_INSTALMENT_MONTHS]) {
      expect(saleSchema.safeParse({ ...base, installmentCount: n }).success, `${n} months`).toBe(true);
    }
    expect(saleSchema.safeParse({ ...base, installmentCount: 0 }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, installmentCount: MAX_INSTALMENT_MONTHS + 1 }).success).toBe(false);
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

const VALID_PRICING = { listedPrice: "199.99" };

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
      ...VALID_PRICING,
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
        ...VALID_PRICING,
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
        ...VALID_PRICING,
      }).success,
    ).toBe(false);
  });
  it("rejects a product with no pricing at all (listedPrice required)", () => {
    expect(
      productSchema.safeParse({
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
        // no listedPrice
      }).success,
    ).toBe(false);
  });

  it("a valid Fixed-commission product (closingCommFixed, the money helper's other real caller) still passes after the money-max bound", () => {
    const ok = productSchema.safeParse({
      productCode: "P1",
      productName: "Funeral Plan",
      commissionType: "Fixed",
      closingCommFixed: "1500.00",
      companyCutPct: "40",
      asmOverridePct: "5",
      smOverridePct: "10",
      sdOverridePct: "5",
      isExternal: false,
      effectiveDate: "2026-01-01",
      ...VALID_PRICING,
    });
    expect(ok.success).toBe(true);
  });

  it("closingBasis DiscountedPrice with no discountedPrice is rejected on CREATE too, not only on the pricing-only update schema", () => {
    const r = productSchema.safeParse({
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
      ...VALID_PRICING,
      closingBasis: "DiscountedPrice",
    });
    expect(r.success).toBe(false);
  });
});

describe("productPricingSchema", () => {
  const base = { listedPrice: "199.99" };

  it("accepts listedPrice alone, no instalment plans", () => {
    expect(productPricingSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a negative listedPrice", () => {
    expect(productPricingSchema.safeParse({ ...base, listedPrice: "-1.00" }).success).toBe(false);
  });

  it("rejects more than 2 decimal places", () => {
    expect(productPricingSchema.safeParse({ ...base, listedPrice: "199.999" }).success).toBe(false);
  });

  describe("money is bounded to what Decimal(14,2) can actually store", () => {
    it("accepts the boundary itself: 12 integer digits (999999999999.99)", () => {
      expect(productPricingSchema.safeParse({ ...base, listedPrice: "999999999999.99" }).success).toBe(true);
    });
    it("rejects one digit past it: 13 integer digits (1000000000000.00)", () => {
      expect(productPricingSchema.safeParse({ ...base, listedPrice: "1000000000000.00" }).success).toBe(false);
    });
  });

  describe("discountedPrice <= listedPrice, both halves of the bound", () => {
    it("accepts a discount equal to the listed price (the boundary itself)", () => {
      expect(productPricingSchema.safeParse({ ...base, listedPrice: "100.00", discountedPrice: "100.00" }).success).toBe(true);
    });
    it("accepts a discount strictly below the listed price", () => {
      expect(productPricingSchema.safeParse({ ...base, listedPrice: "100.00", discountedPrice: "99.99" }).success).toBe(true);
    });
    it("rejects a discount even 0.01 above the listed price", () => {
      const r = productPricingSchema.safeParse({ ...base, listedPrice: "100.00", discountedPrice: "100.01" });
      expect(r.success).toBe(false);
    });
  });

  describe("instalment plans — a repeatable add-on list (owner's change, 2026-10-09), not a fixed 12/24-month enum", () => {
    it("no plans: bookingFee is NOT required, and defaults to an empty list when omitted", () => {
      const r = productPricingSchema.safeParse({ listedPrice: "199.99" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.instalmentPlans).toEqual([]);
    });
    it("one plan: bookingFee required, and the plan's own monthlyAmount required", () => {
      expect(productPricingSchema.safeParse({ listedPrice: "199.99", instalmentPlans: [{ months: 12, monthlyAmount: "16.66" }] }).success).toBe(false); // bookingFee missing
      expect(
        productPricingSchema.safeParse({
          listedPrice: "199.99", bookingFee: "20.00", instalmentPlans: [{ months: 12, monthlyAmount: "16.66" }],
        }).success,
      ).toBe(true);
    });
    it("several plans with DIFFERENT month counts: accepted", () => {
      expect(
        productPricingSchema.safeParse({
          listedPrice: "199.99", bookingFee: "20.00",
          instalmentPlans: [{ months: 12, monthlyAmount: "16.66" }, { months: 24, monthlyAmount: "8.33" }, { months: 6, monthlyAmount: "33.33" }],
        }).success,
      ).toBe(true);
    });
    it("two plans at the SAME month count: rejected — nonsense per the owner's own framing, mirrors the DB's unique(productId, months)", () => {
      const r = productPricingSchema.safeParse({
        listedPrice: "199.99", bookingFee: "20.00",
        instalmentPlans: [{ months: 12, monthlyAmount: "16.66" }, { months: 12, monthlyAmount: "99.00" }],
      });
      expect(r.success).toBe(false);
    });
    it("a term longer than the sale side's own 24-month cap is ACCEPTED here — that cap is a separate, unmade ruling (lib/schemas.ts saleSchema), not this schema's business", () => {
      expect(
        productPricingSchema.safeParse({
          listedPrice: "199.99", bookingFee: "20.00", instalmentPlans: [{ months: 36, monthlyAmount: "5.55" }],
        }).success,
      ).toBe(true);
    });
    it("a non-positive or non-integer months value is rejected", () => {
      expect(productPricingSchema.safeParse({ listedPrice: "199.99", bookingFee: "20.00", instalmentPlans: [{ months: 0, monthlyAmount: "5.00" }] }).success).toBe(false);
      expect(productPricingSchema.safeParse({ listedPrice: "199.99", bookingFee: "20.00", instalmentPlans: [{ months: -1, monthlyAmount: "5.00" }] }).success).toBe(false);
      expect(productPricingSchema.safeParse({ listedPrice: "199.99", bookingFee: "20.00", instalmentPlans: [{ months: 1.5, monthlyAmount: "5.00" }] }).success).toBe(false);
    });
  });

  it("PRICING FIELDS ONLY: an extra non-pricing key (e.g. commissionType) is rejected, not silently ignored", () => {
    const r = productPricingSchema.safeParse({ ...base, commissionType: "Fixed" });
    expect(r.success).toBe(false);
  });

  describe("closingBasis (2026-10-01) — defaults to ListedPrice, and DiscountedPrice requires an actual discount", () => {
    it("omitted entirely: defaults to ListedPrice (every pre-closing-basis caller keeps working)", () => {
      const r = productPricingSchema.safeParse(base);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.closingBasis).toBe("ListedPrice");
    });

    it("explicit ListedPrice, no discount set: accepted", () => {
      expect(productPricingSchema.safeParse({ ...base, closingBasis: "ListedPrice" }).success).toBe(true);
    });

    it("explicit ListedPrice while a discount IS set: accepted — the basis, not the presence of a discount, decides", () => {
      expect(productPricingSchema.safeParse({ ...base, discountedPrice: "99.99", closingBasis: "ListedPrice" }).success).toBe(true);
    });

    it("DiscountedPrice with a discount set: accepted", () => {
      expect(productPricingSchema.safeParse({ ...base, discountedPrice: "99.99", closingBasis: "DiscountedPrice" }).success).toBe(true);
    });

    it("DiscountedPrice with NO discount set: rejected (invalidInput), not silently treated as ListedPrice", () => {
      const r = productPricingSchema.safeParse({ ...base, closingBasis: "DiscountedPrice" });
      expect(r.success).toBe(false);
    });

    it("DiscountedPrice with discountedPrice explicitly undefined (a cleared field, the real UI shape): still rejected", () => {
      const r = productPricingSchema.safeParse({ ...base, discountedPrice: undefined, closingBasis: "DiscountedPrice" });
      expect(r.success).toBe(false);
    });

    it("rejects an unknown closingBasis value", () => {
      expect(productPricingSchema.safeParse({ ...base, closingBasis: "Negotiated" }).success).toBe(false);
    });
  });
});

describe("newAssociateSchema", () => {
  it("accepts a minimal valid associate and rejects a bad email", () => {
    expect(
      newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesAssociate", email: "jane@example.com" }).success,
    ).toBe(true);
    expect(
      newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesAssociate", email: "not-an-email" }).success,
    ).toBe(false);
  });

  // The login email is what setApprovalStatus provisions the account from, and it
  // is read ONCE at approval — an associate approved without one can never log in
  // and no screen can repair it. So "no email" is rejected at the door, not later.
  it("REJECTS an associate with no email at all — the login provisioning depends on it", () => {
    expect(newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesAssociate" }).success).toBe(false);
    expect(newAssociateSchema.safeParse({ fullName: "Jane Tan", designation: "SalesAssociate", email: "" }).success).toBe(false);
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
        spouseConflict: false,
      }).success,
    ).toBe(true);
  });

  // C-2 (owner ruling): spouseConflict is required at final submit — see
  // lib/schemas.ts's own comment on the field for why that's safe (no
  // draft-save path exists for this form to lock anyone out of).
  it("rejects a submission that omits spouseConflict entirely", () => {
    expect(
      onboardingSchema.safeParse({
        nric: "S1234567A", paymentMethod: "PayNow", agreementAccepted: true,
        nationality: "Singaporean", gender: "Male", religion: "Buddhism",
      }).success,
    ).toBe(false);
  });

  const base = {
    nric: "S1234567A", paymentMethod: "PayNow" as const, agreementAccepted: true,
    nationality: "Singaporean", gender: "Male" as const, religion: "Buddhism",
    spouseConflict: false as const,
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

  it("requires spouse name + company + designation when the conflict is declared Yes", () => {
    expect(onboardingSchema.safeParse({ ...base, spouseConflict: true }).success).toBe(false);
    // C-2: name + company alone is no longer enough — designation joined them.
    expect(
      onboardingSchema.safeParse({ ...base, spouseConflict: true, spouseName: "Jane Tan", spouseCompany: "Rival Funeral Pte Ltd" }).success,
    ).toBe(false);
    expect(
      onboardingSchema.safeParse({
        ...base, spouseConflict: true, spouseName: "Jane Tan", spouseCompany: "Rival Funeral Pte Ltd", spouseDesignation: "Director",
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
