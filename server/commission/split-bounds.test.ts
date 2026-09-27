import { describe, it, expect } from "vitest";
import { Designation } from "@prisma/client";
import { computeLineCommission, type LineInput } from "./engine";
import { negativeLines } from "./split-bounds";

// TXN-0003 shape: a split share larger than Net-to-Closer books a negative closer line.
const line = (over: Partial<LineInput> = {}): LineInput => ({
  lineItemId: "l1", commissionType: "Percentage", lineSaleAmount: 10000,
  closingCommPct: 10, companyCutPct: 2, smOverridePct: 5, sdOverridePct: 3, isExternal: false, comCodes: [],
  closer: { associateId: "closer", designation: Designation.SalesAssociate },
  directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: true },
  secondUpline: { associateId: "sd", designation: Designation.SalesDirector, eligible: true },
  ...over,
});

describe("negativeLines (SEC-6)", () => {
  it("flags the closer line when the split exceeds Net-to-Closer", () => {
    const r = computeLineCommission(line({ associate2: { associateId: "a2", valueType: "Absolute", value: 1096 } }));
    expect(negativeLines("P1", r)).toEqual([{ productCode: "P1", lineType: "Personal", associateId: "closer", amount: "-296.00" }]);
  });
  it("is empty for a split within net, including exactly net", () => {
    expect(negativeLines("P1", computeLineCommission(line({ associate2: { associateId: "a2", valueType: "Percentage", value: 50 } })))).toEqual([]);
    expect(negativeLines("P1", computeLineCommission(line({ associate2: { associateId: "a2", valueType: "Absolute", value: 800 } })))).toEqual([]);
  });
  it("also flags a company cut larger than the closing commission (negative net)", () => {
    const v = negativeLines("P1", computeLineCommission(line({ closingCommPct: 1, companyCutPct: 2 })));
    expect(v.map((x) => x.lineType)).toContain("Personal");
  });
});

import { snapshotCovers, type SplitBoundViolation } from "./split-bounds";
const v = (amount: string, over: Partial<SplitBoundViolation> = {}): SplitBoundViolation =>
  ({ productCode: "P1", lineType: "Personal", associateId: "closer", amount, ...over });

describe("snapshotCovers (B-S6 N2)", () => {
  it("covers when nothing is negative, or the same line is equal or less negative", () => {
    expect(snapshotCovers([], null)).toBe(true);
    expect(snapshotCovers([v("-296.00")], [v("-296.00")])).toBe(true);
    expect(snapshotCovers([v("-100.00")], [v("-296.00")])).toBe(true);
  });
  it("does not cover without an approval, a deeper negative, or a new negative line", () => {
    expect(snapshotCovers([v("-296.00")], null)).toBe(false);
    expect(snapshotCovers([v("-500.00")], [v("-296.00")])).toBe(false);
    expect(snapshotCovers([v("-296.00"), v("-10.00", { lineType: "CompanyRetained", associateId: null })], [v("-296.00")])).toBe(false);
    expect(snapshotCovers([v("-296.00", { productCode: "P2" })], [v("-296.00")])).toBe(false);
  });
});
