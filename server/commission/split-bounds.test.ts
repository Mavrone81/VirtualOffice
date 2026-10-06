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

  // PINNED CONSEQUENCE (item 4 brief): external lines had no Net-to-Closer
  // before this change, so SEC-6's bound — a split larger than net books a
  // negative closer line — never reached them. The moment they have a real
  // net-to-closer, it applies, unchanged, exactly as it already does for
  // internal above. Not a new check added here: this is the SAME
  // negativeLines call, on an external line, pinned so it's a known
  // consequence instead of a production discovery.
  // retainedPct 20 (not 5): isolates the closer-split violation from the
  // second, separate consequence below — at this line's fixed 10% closing /
  // 2% cut / 5% SM / 3% SD, retainedBase needs to be >= 1,600 (16%) for
  // CompanyRetained to stay non-negative on its own, so this case has
  // exactly one violation, not two.
  it("CONSEQUENCE, now pinned: an external line's Associate-2 split exceeding Net-to-Closer is flagged exactly like an internal one's", () => {
    const r = computeLineCommission(line({ isExternal: true, externalCompanyRetainedPct: 20, associate2: { associateId: "a2", valueType: "Absolute", value: 1096 } }));
    expect(negativeLines("P1", r)).toEqual([{ productCode: "P1", lineType: "Personal", associateId: "closer", amount: "-296.00" }]);
  });

  // SECOND, BROADER consequence found during verification, not stated in the
  // brief this way: negativeLines filters by amount.isNegative() with no
  // lineType discrimination, so it ALSO catches a negative CompanyRetained —
  // with NO split present at all. The owner's own worked example (10,000 /
  // 10% closing / 2% cut / 5% SM / 3% SD / 5% retained → company -1,100) is
  // exactly this case. See the delivery notes: this is the same pre-existing,
  // untouched mechanism (snapshotCovers' own test fixture above already
  // includes a CompanyRetained violation), not something added for external
  // — but it means that worked example, closed as a real sale with no splits
  // at all, hits server/sales/actions.ts's splitExceptionRequired gate and
  // cannot close without a Business Admin's manual approval.
  it("CONSEQUENCE, now pinned: the owner's own worked example (negative CompanyRetained, no splits at all) is ALSO flagged by negativeLines", () => {
    const r = computeLineCommission(line({ isExternal: true, externalCompanyRetainedPct: 5 })); // no associate2/3
    const v = negativeLines("P1", r);
    expect(v).toEqual([{ productCode: "P1", lineType: "CompanyRetained", associateId: null, amount: "-1100.00" }]);
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
