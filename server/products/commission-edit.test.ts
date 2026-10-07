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
  // The stored row's managing-director cut is 0 while `input` omits it, so the
  // two still canonicalise equal — the "unchanged" case this fixture exists to
  // assert, and the real state of every product created before 2026-10-07.
  mdCutPct: new Prisma.Decimal("0"), mdCutType: "Percentage" as const,
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

  // Without this, changing ONLY the managing-director cut would canonicalise
  // equal to the stored row, so no new CommissionStructureVersion would be
  // written — and the engine pays from the VERSION, not the product row. The
  // screen would show the new rate while every sale kept using the old one,
  // with nothing anywhere reporting a problem.
  it("a managing-director cut change is detected on its own", () => {
    expect(changedCommissionFields(canonicalFromRow(row), canonicalFromInput({ ...input, mdCutPct: "0.6" }))).toEqual(["mdCutPct"]);
    expect(changedCommissionFields(canonicalFromRow(row), canonicalFromInput({ ...input, mdCutType: "Absolute" }))).toEqual(["mdCutType"]);
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
