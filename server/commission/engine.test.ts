import { describe, it, expect } from "vitest";
import { Designation, CommissionType, ComValueType, LedgerLineType } from "@prisma/client";
import { computeLineCommission, type LedgerLineResult, type LineInput } from "./engine";

function pick(lines: LedgerLineResult[], type: LedgerLineType, associateId?: string) {
  const l = lines.find((x) => x.lineType === type && (associateId === undefined || x.associateId === associateId));
  return l?.amount.toString();
}

const base = {
  lineItemId: "li1",
  companyCutPct: "40",
  asmOverridePct: "10",
  smOverridePct: "20",
  sdOverridePct: "10",
  isExternal: false,
  externalCompanyRetainedPct: null,
  comCodes: [],
  closer: { associateId: "closer", designation: Designation.SalesConsultant },
  directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: true },
  secondUpline: { associateId: "sd", designation: Designation.SalesDirector, eligible: true },
} satisfies Partial<LineInput>;

describe("commission engine", () => {
  it("Percentage $10,000 → closer 600 / SM 80 / SD 40 / retained 280 (PRD §8.2)", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
    });
    expect(pick(lines, LedgerLineType.Personal)).toBe("600");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("80");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("40");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("280");
    expect(reconciles).toBe(true);
  });

  it("Fixed $500 → closer 300 / SM 40 / SD 20 / retained 140 (sale-amount independent)", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Fixed, lineSaleAmount: "3800", closingCommFixed: "500",
    });
    expect(pick(lines, LedgerLineType.Personal)).toBe("300");
    expect(pick(lines, LedgerLineType.Override, "sm")).toBe("40");
    expect(pick(lines, LedgerLineType.Override, "sd")).toBe("20");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("140");
    expect(reconciles).toBe(true);
  });

  it("External 5% retained → provider 950 / Enshrine 50", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "1000", closingCommPct: "0",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    expect(pick(lines, LedgerLineType.ExternalPayable)).toBe("950");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("50");
    expect(reconciles).toBe(true);
  });

  it("add-on com codes: 2% of sale + $20 absolute", () => {
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
  });

  it("Consultant upline earns no override; retained absorbs the pool", () => {
    const { lines, reconciles } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      directUpline: { associateId: "c", designation: Designation.SalesConsultant, eligible: true },
      secondUpline: null,
    });
    expect(lines.filter((l) => l.lineType === LedgerLineType.Override)).toHaveLength(0);
    expect(pick(lines, LedgerLineType.Personal)).toBe("600");
    expect(pick(lines, LedgerLineType.CompanyRetained)).toBe("400");
    expect(reconciles).toBe(true);
  });

  it("ineligible (not Approved+Active) upline gets no override", () => {
    const { lines } = computeLineCommission({
      ...base, commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
      directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: false },
      secondUpline: null,
    });
    const overrideAssociates = lines.filter((l) => l.lineType === LedgerLineType.Override).map((l) => l.associateId);
    expect(overrideAssociates).not.toContain("sm");
  });
});
