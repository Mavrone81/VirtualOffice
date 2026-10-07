import { describe, it, expect } from "vitest";
import { CommissionType, ComValueType, Designation, LedgerLineType } from "@prisma/client";
import { computeLineCommission, type LineInput } from "./engine";

/**
 * The managing-director cut (owner, 2026-10-07). Money, so every case here
 * asserts the WHOLE line reconciles, not just the new figure — a cut that
 * computes correctly while leaving the company's residual wrong is still a
 * broken sale.
 */
const base: LineInput = {
  lineItemId: "li1",
  commissionType: CommissionType.Percentage,
  lineSaleAmount: "10000",
  closingCommPct: "10",
  companyCutPct: "2",
  companyCutType: ComValueType.Percentage,
  smOverridePct: "0",
  sdOverridePct: "0",
  isExternal: false,
  comCodes: [],
  closer: { associateId: "closer", designation: Designation.SalesAssociate },
  directUpline: null,
  secondUpline: null,
};

const md = (id: string, eligible = true) => ({ associateId: id, eligible });
const cutLines = (r: { lines: { lineType: LedgerLineType }[] }) =>
  r.lines.filter((l) => l.lineType === LedgerLineType.ManagingDirectorCut);
const amountOf = (r: { lines: { lineType: LedgerLineType; amount: { toString(): string } }[] }, t: LedgerLineType) =>
  r.lines.filter((l) => l.lineType === t).map((l) => l.amount.toString());

describe("managing-director cut", () => {
  it("is not booked at all when no product rate is set — every existing product", () => {
    const r = computeLineCommission({ ...base, managingDirectors: [md("m1")] });
    expect(cutLines(r)).toHaveLength(0);
    expect(r.reconciles).toBe(true);
  });

  it("is not booked when nobody holds the designation, and the company keeps it", () => {
    const withMd = { ...base, mdCutPct: "0.6" };
    const none = computeLineCommission({ ...withMd, managingDirectors: [] });
    const one = computeLineCommission({ ...withMd, managingDirectors: [md("m1")] });
    expect(cutLines(none)).toHaveLength(0);
    // The company is better off by exactly the cut that was not paid.
    const nc = Number(amountOf(none, LedgerLineType.CompanyRetained)[0]);
    const oc = Number(amountOf(one, LedgerLineType.CompanyRetained)[0]);
    expect(nc - oc).toBeCloseTo(60, 2); // 0.6% of 10,000
    expect(none.reconciles && one.reconciles).toBe(true);
  });

  it("reverts to the company for an INELIGIBLE holder, like an ineligible upline", () => {
    const r = computeLineCommission({ ...base, mdCutPct: "0.6", managingDirectors: [md("m1", false)] });
    expect(cutLines(r)).toHaveLength(0);
    expect(r.reconciles).toBe(true);
  });

  it("pays a single holder 0.6% of the sale and takes it from the company", () => {
    const r = computeLineCommission({ ...base, mdCutPct: "0.6", managingDirectors: [md("m1")] });
    expect(amountOf(r, LedgerLineType.ManagingDirectorCut)).toEqual(["60"]);
    expect(r.reconciles).toBe(true);
  });

  // The case that is invisible unless asserted: three ways of splitting $10
  // cannot each be a whole cent.
  it("shares between holders, and the leftover cent does not break the books", () => {
    const r = computeLineCommission({
      ...base,
      mdCutPct: "0.1", // 0.1% of 10,000 = $10 exactly
      managingDirectors: [md("m1"), md("m2"), md("m3")],
    });
    const amounts = amountOf(r, LedgerLineType.ManagingDirectorCut);
    expect(amounts).toEqual(["3.33", "3.33", "3.33"]);
    // 9.99 booked, not 10 — and the company's residual must absorb the cent,
    // which is the whole point of subtracting what was PAID rather than the pool.
    expect(r.reconciles).toBe(true);
  });

  it("only eligible holders share; an ineligible one does not shrink the others' share", () => {
    const r = computeLineCommission({
      ...base,
      mdCutPct: "0.1",
      managingDirectors: [md("m1"), md("m2", false)],
    });
    // Divided by the ELIGIBLE count, not the headcount: one eligible holder
    // takes the whole $10. Dividing by 2 here would quietly pay out half the
    // cut and hand the other half to the company with no line explaining it.
    expect(amountOf(r, LedgerLineType.ManagingDirectorCut)).toEqual(["10"]);
    expect(r.reconciles).toBe(true);
  });

  it("is paid even when a managing director closed the sale themselves", () => {
    const r = computeLineCommission({
      ...base,
      mdCutPct: "0.6",
      closer: { associateId: "m1", designation: Designation.ManagingDirector },
      managingDirectors: [md("m1")],
    });
    expect(amountOf(r, LedgerLineType.ManagingDirectorCut)).toEqual(["60"]);
    expect(amountOf(r, LedgerLineType.Personal)).toHaveLength(1); // and still their closing commission
    expect(r.reconciles).toBe(true);
  });

  it("takes an absolute amount when the type says so", () => {
    const r = computeLineCommission({
      ...base,
      mdCutPct: "250",
      mdCutType: ComValueType.Absolute,
      managingDirectors: [md("m1")],
    });
    expect(amountOf(r, LedgerLineType.ManagingDirectorCut)).toEqual(["250"]);
    expect(r.reconciles).toBe(true);
  });

  it("books under its own line type, never Override — that is what keeps it admin-only", () => {
    const r = computeLineCommission({ ...base, mdCutPct: "0.6", managingDirectors: [md("m1")] });
    expect(amountOf(r, LedgerLineType.Override)).toEqual([]);
    expect(cutLines(r)).toHaveLength(1);
  });
});
