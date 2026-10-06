import { describe, it, expect } from "vitest";
import { Designation, CommissionType, ComValueType, LedgerLineType } from "@prisma/client";
import { computeLineCommission, type LedgerLineResult, type LineInput } from "./engine";

function pick(lines: LedgerLineResult[], type: LedgerLineType, associateId?: string) {
  const l = lines.find((x) => x.lineType === type && (associateId === undefined || x.associateId === associateId));
  return l?.amount.toString();
}
function sum(lines: LedgerLineResult[], type: LedgerLineType) {
  return lines.filter((x) => x.lineType === type).reduce((s, x) => s + Number(x.amount), 0);
}

// 16-Jul-2026 model. All % fields compute on the SALES AMOUNT.
// Net to Closer = Closing − Company Cut Pool.
// Overrides are position-based: direct upline gets SM Overriding, second upline gets SD Overriding.
// Company take (single CompanyRetained line) = Cut Pool + Company Retained = Sale − NetToCloser − SM − SD.
const base = {
  lineItemId: "li1",
  companyCutPct: "2", // % of SALES AMOUNT
  smOverridePct: "5", // % of SALES AMOUNT → direct upline (Tier 1)
  sdOverridePct: "3", // % of SALES AMOUNT → second upline (Tier 2)
  isExternal: false,
  externalCompanyRetainedPct: null,
  comCodes: [],
  closer: { associateId: "closer", designation: Designation.SalesAssociate },
  directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: true },
  secondUpline: { associateId: "sd", designation: Designation.SalesDirector, eligible: true },
} satisfies Partial<LineInput>;

describe("commission engine (16-Jul model)", () => {
  it("Percentage $10,000, 10/5/3/2 → NetToCloser 800 / SM 500 / SD 300 / company 8400", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
    });
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("800");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("500");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("300");
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(8400);
    expect(reconciles).toBe(true);
  });

  it("Fixed closing $1,000 on a $10,000 sale → NetToCloser 800 (overrides still on sale)", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Fixed, lineSaleAmount: "10000", closingCommFixed: "1000",
    });
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("800");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("500");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("300");
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(8400);
    expect(reconciles).toBe(true);
  });

  it("ABSOLUTE company-cut + overrides: fixed $ amounts, not % of sale", () => {
    // sale 10,000, closing 10% = 1,000. Cut $150 → Net 850. SM $400, SD $250.
    // company = 10,000 − 850 − 400 − 250 = 8,500. Values chosen ≠ the % path.
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      companyCutPct: "150", companyCutType: ComValueType.Absolute,
      smOverridePct: "400", smOverrideType: ComValueType.Absolute,
      sdOverridePct: "250", sdOverrideType: ComValueType.Absolute,
    });
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("850");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("400");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("250");
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(8500);
    expect(reconciles).toBe(true);
  });

  it("mixed: absolute SM override with percentage company-cut + SD", () => {
    // cut 2% = 200 → Net 800. SM $450 (absolute). SD 3% = 300.
    // company = 10,000 − 800 − 450 − 300 = 8,450.
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      smOverridePct: "450", smOverrideType: ComValueType.Absolute,
    });
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("800");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("450");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("300");
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(8450);
    expect(reconciles).toBe(true);
  });

  it("overrides are POSITION-based: direct→SM amount, second→SD amount, regardless of designation", () => {
    const { lines } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      // deliberately swap the designations — position must still drive the amount
      directUpline: { associateId: "x", designation: Designation.SalesDirector, eligible: true },
      secondUpline: { associateId: "y", designation: Designation.SalesManager, eligible: true },
    });
    expect(pick(lines, LedgerLineType.Override, "x")).toBe("500"); // direct upline → SM overriding
    expect(pick(lines, LedgerLineType.Override, "y")).toBe("300"); // second upline → SD overriding
  });

  it("Associate 1/2/3 split divides Net to Closer; primary auto-deducts", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      associate2: { associateId: "a2", valueType: ComValueType.Percentage, value: "25" }, // 25% of 800 = 200
      associate3: { associateId: "a3", valueType: ComValueType.Absolute, value: "100" }, // $100
    });
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("500"); // 800 − 200 − 100
    expect(pick(lines, LedgerLineType.Personal, "a2")).toBe("200");
    expect(pick(lines, LedgerLineType.Personal, "a3")).toBe("100");
    // overrides + company unchanged by the split
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("500");
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(8400);
    expect(reconciles).toBe(true);
  });

  it("no upline → no overrides; company absorbs (Sale − NetToCloser)", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      directUpline: null, secondUpline: null,
    });
    expect(lines.filter((l) => l.lineType === LedgerLineType.Override)).toHaveLength(0);
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("800");
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(9200); // 10000 − 800
    expect(reconciles).toBe(true);
  });

  it("ineligible direct upline gets no override; that amount reverts to the company", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: false },
      secondUpline: null,
    });
    expect(lines.filter((l) => l.lineType === LedgerLineType.Override)).toHaveLength(0);
    expect(sum(lines, LedgerLineType.CompanyRetained)).toBe(9200); // SM's 500 reverts → 10000 − 800
    expect(reconciles).toBe(true);
  });

  // `base` carries companyCutPct/smOverridePct/sdOverridePct = 2/5/3 (for the
  // INTERNAL cases above) and directUpline/secondUpline eligible — fields the
  // pre-2026-10 engine silently ignored for an external line. Zeroed here so
  // this test keeps isolating exactly what it always intended (just the
  // provider/retained split), now that those fields are no longer ignored —
  // see the full unified arithmetic (closing/cut/overrides all applying to
  // external too) in the two tests below instead.
  it("External 5% retained, no closing/cut/overrides configured → provider 950 / Enshrine 50 (unchanged)", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "1000", closingCommPct: "0",
      companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    expect(pick(lines, LedgerLineType.ExternalPayable)).toBe("950");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("50");
    expect(reconciles).toBe(true);
  });

  // The owner's own worked example (brief, item 4): external pays the
  // associate exactly like internal, on top of the provider split, with the
  // resulting company take permitted to go negative.
  it("External, owner's worked example: $10,000 @ 10/2/5/3, 5% retained → net 800, SM 500, SD 300, company -1,100, reconciles", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    expect(pick(lines, LedgerLineType.ExternalPayable)).toBe("9500");
    expect(pick(lines, LedgerLineType.Personal, "closer")).toBe("800");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("500");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("300");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("-1100");
    expect(reconciles).toBe(true);
  });

  // Permitted, not prevented: the negative figure books as-is, with no floor.
  it("External negative CompanyRetained is PERMITTED: the ledger books the negative figure and the sale still reconciles", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    const company = lines.find((l) => l.lineType === LedgerLineType.CompanyRetained)!;
    expect(company.amount.isNegative()).toBe(true);
    expect(company.amount.toString()).toBe("-1100");
    expect(reconciles).toBe(true); // not merely non-crashing: the sale balances to lineSaleAmount exactly
  });

  it("add-on com codes: 2% of sale + $20 absolute (extra, attributed to closer)", () => {
    const { lines } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      comCodes: [
        { comCode: "SEA", valueType: ComValueType.Percentage, value: "2" },
        { comCode: "REM", valueType: ComValueType.Absolute, value: "20" },
      ],
    });
    const addons = lines.filter((l) => l.lineType === LedgerLineType.AddOn);
    expect(addons.find((a) => a.comCode === "SEA")?.amount.toString()).toBe("200");
    expect(addons.find((a) => a.comCode === "REM")?.amount.toString()).toBe("20");
    expect(addons.every((a) => a.associateId === "closer")).toBe(true);
    // retainedBase === lineSale for an internal line, so this also pins that
    // the basis recorded on the ledger line is unaffected by the G1 fix below.
    expect(addons.find((a) => a.comCode === "SEA")?.basisAmount.toString()).toBe("10000");
  });

  // G1 (item 4 follow-up, Part 4): disabling behavior and watching the whole
  // suite stay green turned this up — add-on com codes applied to an external
  // line with zero test coverage either way. Resolved: a Percentage add-on
  // must be % of retainedBase (the company's actual share of an external
  // sale), not the full sale — most of an external sale is externalPayable,
  // money that never reaches the company, so computing a bonus against it
  // would make the company fund that bonus from revenue it never received.
  it("G1: an external line's add-on com codes resolve against retainedBase, not the full sale", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "0",
      companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0",
      isExternal: true, externalCompanyRetainedPct: "5",
      comCodes: [
        { comCode: "SEA", valueType: ComValueType.Percentage, value: "2" },
        { comCode: "REM", valueType: ComValueType.Absolute, value: "20" },
      ],
    });
    // retainedBase = 5% of 10,000 = 500.
    const addons = lines.filter((l) => l.lineType === LedgerLineType.AddOn);
    const sea = addons.find((a) => a.comCode === "SEA")!;
    expect(sea.amount.toString()).toBe("10"); // 2% of retainedBase (500) — 2% of the sale would wrongly be 200
    expect(sea.basisAmount.toString()).toBe("500");
    const rem = addons.find((a) => a.comCode === "REM")!;
    expect(rem.amount.toString()).toBe("20"); // absolute — unaffected by which basis the Percentage add-ons use
    // Add-ons stay "extra", outside the reconciliation — exactly as for
    // internal (header comment above); this fix doesn't change that.
    expect(reconciles).toBe(true);
  });

  // G2 (item 4 follow-up, Part 4): the external retained % recorded as
  // rateOrValue on the CompanyRetained line — AD's own code comment calls it
  // "preserved exactly as the pre-unification code recorded it" — had zero
  // test coverage; set to null, nothing noticed. Pinned both ways.
  it("G2: the external retained % is preserved as rateOrValue on the CompanyRetained line", () => {
    const { lines } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    const company = lines.find((l) => l.lineType === LedgerLineType.CompanyRetained)!;
    expect(company.rateOrValue?.toString()).toBe("5");
  });

  it("G2 control: an INTERNAL line's CompanyRetained rateOrValue stays null", () => {
    const { lines } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
    });
    const company = lines.find((l) => l.lineType === LedgerLineType.CompanyRetained)!;
    expect(company.rateOrValue).toBeNull();
  });
});
