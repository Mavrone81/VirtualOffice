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
  closer: { associateId: "closer", designation: Designation.SalesConsultant },
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

  it("External 5% retained → provider 950 / Enshrine 50 (unchanged)", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "1000", closingCommPct: "0",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    expect(pick(lines, LedgerLineType.ExternalPayable)).toBe("950");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("50");
    expect(reconciles).toBe(true);
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
  });
});
