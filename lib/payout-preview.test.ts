import { describe, it, expect } from "vitest";
import { classifyPreviewPlans, type PreviewPlanRow } from "./payout-preview";

const row = (over: Partial<PreviewPlanRow>): PreviewPlanRow => ({
  associateId: "a", associateName: "A", newLines: 1, releasedLines: 0, net: "100.00",
  attach: true, policy: "carry_forward", isLeaver: false, ...over,
});

describe("classifyPreviewPlans — M5-CF Screen 1 sectioning", () => {
  it("attach: true, net > 0 goes to willBePaid", () => {
    const { willBePaid, held, carriedForward, leaverFlags } = classifyPreviewPlans([row({ associateId: "a1", attach: true, net: "100.00" })]);
    expect(willBePaid.map((r) => r.associateId)).toEqual(["a1"]);
    expect(held).toEqual([]);
    expect(carriedForward).toEqual([]);
    expect(leaverFlags).toEqual([]);
  });

  it("hold policy: attach: true but net <= 0 goes to held, not willBePaid — no money actually moves (U1)", () => {
    const { willBePaid, held } = classifyPreviewPlans([
      row({ associateId: "held1", attach: true, net: "-40.00", policy: "hold", note: "non-positive total" }),
    ]);
    expect(willBePaid).toEqual([]);
    expect(held.map((r) => r.associateId)).toEqual(["held1"]);
  });

  it("hold policy: net exactly 0 also goes to held (never paid), not willBePaid", () => {
    const { willBePaid, held } = classifyPreviewPlans([row({ associateId: "zero", attach: true, net: "0.00", policy: "hold" })]);
    expect(willBePaid).toEqual([]);
    expect(held.map((r) => r.associateId)).toEqual(["zero"]);
  });

  it("attach: false, not a leaver, goes to carriedForward", () => {
    const { carriedForward, leaverFlags } = classifyPreviewPlans([row({ associateId: "a2", attach: false, isLeaver: false })]);
    expect(carriedForward.map((r) => r.associateId)).toEqual(["a2"]);
    expect(leaverFlags).toEqual([]);
  });

  it("attach: false AND isLeaver goes to leaverFlags only, never also carriedForward", () => {
    const { carriedForward, leaverFlags } = classifyPreviewPlans([row({ associateId: "a3", attach: false, isLeaver: true })]);
    expect(leaverFlags.map((r) => r.associateId)).toEqual(["a3"]);
    expect(carriedForward).toEqual([]);
  });

  it("a leaver who WOULD be paid (attach: true, net > 0) is not flagged — the flag is only for a carried (unpaid) balance", () => {
    const { willBePaid, leaverFlags } = classifyPreviewPlans([row({ associateId: "a4", attach: true, net: "100.00", isLeaver: true })]);
    expect(willBePaid.map((r) => r.associateId)).toEqual(["a4"]);
    expect(leaverFlags).toEqual([]);
  });

  it("headline total/count sum only willBePaid rows — excludes held, carried and flagged amounts", () => {
    const plans = [
      row({ associateId: "paid1", attach: true, net: "800.00" }),
      row({ associateId: "paid2", attach: true, net: "1200.50" }),
      row({ associateId: "held1", attach: true, net: "-40.00", policy: "hold", note: "non-positive total" }),
      row({ associateId: "carried", attach: false, net: "-40.00" }),
      row({ associateId: "leaver", attach: false, net: "-180.00", isLeaver: true }),
    ];
    const { total, count } = classifyPreviewPlans(plans);
    expect(total.toString()).toBe("2000.5"); // NOT 1960.5 — a held negative net must not lower the total (U1)
    expect(count).toBe(2);
  });

  it("under carry_forward policy, the same non-positive-net row is attach:false (carried), never held", () => {
    // held only exists under the hold-fallback (attach:true, net<=0); carry_forward's
    // equivalent case is attach:false, which classifyPreviewPlans already routes to carriedForward.
    const { held, carriedForward } = classifyPreviewPlans([
      row({ associateId: "cf1", attach: false, net: "-40.00", policy: "carry_forward" }),
    ]);
    expect(held).toEqual([]);
    expect(carriedForward.map((r) => r.associateId)).toEqual(["cf1"]);
  });
});
