import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { canonicalFromInput, canonicalFromRow, changedCommissionFields } from "./commission-edit";

const input = {
  commissionType: "Percentage" as const, closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
  isExternal: false, effectiveDate: "2098-01-01",
};
const row = {
  commissionType: "Percentage" as const, closingCommPct: new Prisma.Decimal("10"), closingCommFixed: null,
  companyCutPct: new Prisma.Decimal("2"), companyCutType: "Percentage" as const,
  smOverridePct: new Prisma.Decimal("5"), smOverrideType: "Percentage" as const,
  sdOverridePct: new Prisma.Decimal("3"), sdOverrideType: "Percentage" as const,
  isExternal: false, externalCompanyRetainedPct: null, effectiveDate: new Date("2098-01-01"),
};

describe("commission-edit canonical form", () => {
  it("an input equal to the stored row is unchanged — '10' vs Decimal 10.0000, omitted types vs stored defaults", () => {
    expect(changedCommissionFields(canonicalFromRow(row), canonicalFromInput(input))).toEqual([]);
    expect(changedCommissionFields(canonicalFromRow(row), canonicalFromInput({ ...input, closingCommPct: "10.0000", companyCutType: "Percentage" }))).toEqual([]);
  });

  it("names exactly the fields that differ", () => {
    expect(changedCommissionFields(canonicalFromRow(row), canonicalFromInput({ ...input, smOverridePct: "5.5", effectiveDate: "2098-02-01" }))).toEqual(["smOverridePct", "effectiveDate"]);
  });

  it("maps like createProduct: the closing value only for its own type, the retained % only when external", () => {
    const fixed = canonicalFromInput({ ...input, commissionType: "Fixed", closingCommFixed: "1500", closingCommPct: "10" });
    expect(fixed).toMatchObject({ closingCommPct: null, closingCommFixed: "1500.00" });
    expect(canonicalFromInput({ ...input, externalCompanyRetainedPct: "9" }).externalCompanyRetainedPct).toBeNull();
    expect(canonicalFromInput({ ...input, isExternal: true }).externalCompanyRetainedPct).toBe("0.0000");
  });

  it("an ISO datetime effective date compares by its calendar day", () => {
    expect(canonicalFromInput({ ...input, effectiveDate: "2098-01-01T00:00:00.000Z" }).effectiveDate).toBe("2098-01-01");
  });
});
