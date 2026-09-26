import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { reconcileWithSettled } from "./settle";

type Row = { associateId: string | null; lineType: string; lineItemId: string | null; comCode: string | null; amount: Prisma.Decimal; remarks?: string | null };
const row = (associateId: string | null, lineType: string, amount: string, lineItemId = "li1"): Row =>
  ({ associateId, lineType, lineItemId, comCode: null, amount: new Prisma.Decimal(amount) });
const template = (l: { associateId: string | null; lineType: string; lineItemId: string | null; comCode: string | null }): Row =>
  ({ ...l, amount: new Prisma.Decimal(0) });
const amounts = (rows: Row[]) => rows.map((r) => [r.associateId, r.lineType, r.amount.toFixed(2)]);

describe("reconcileWithSettled (M5 option a)", () => {
  it("writes everything as computed when nothing is settled", () => {
    const computed = [row("a", "Personal", "800"), row(null, "CompanyRetained", "200")];
    expect(reconcileWithSettled(computed, [], template)).toEqual(computed);
  });

  it("writes nothing for a settled commission that is unchanged", () => {
    expect(reconcileWithSettled([row("a", "Personal", "800")], [row("a", "Personal", "800")], template)).toEqual([]);
  });

  it("writes only the positive difference for a settled commission that grew", () => {
    const out = reconcileWithSettled([row("a", "Personal", "1200")], [row("a", "Personal", "800")], template);
    expect(amounts(out)).toEqual([["a", "Personal", "400.00"]]);
    expect(out[0].remarks).toMatch(/settled 800\.00, now 1200\.00/);
  });

  it("writes a visible clawback when a settled commission shrank", () => {
    const out = reconcileWithSettled([row("a", "Personal", "600")], [row("a", "Personal", "800")], template);
    expect(amounts(out)).toEqual([["a", "Personal", "-200.00"]]);
  });

  it("reverses a settled commission the recompute no longer produces", () => {
    const out = reconcileWithSettled([row("a", "Personal", "800")], [row("a", "Personal", "800"), row("sm", "Override", "500")], template);
    expect(amounts(out)).toEqual([["sm", "Override", "-500.00"]]);
  });

  it("keeps unrelated and new commission alongside settled ones; settled + written = computed", () => {
    const computed = [row("a", "Personal", "600"), row("b", "Personal", "200"), row(null, "CompanyRetained", "100")];
    const locked = [row("a", "Personal", "800")];
    const out = reconcileWithSettled(computed, locked, template);
    const total = (rs: Row[]) => rs.reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0)).toFixed(2);
    expect(total([...locked, ...out])).toBe(total(computed));
    expect(amounts(out)).toEqual([["b", "Personal", "200.00"], [null, "CompanyRetained", "100.00"], ["a", "Personal", "-200.00"]]);
  });

  it("treats different line items as different commissions", () => {
    const out = reconcileWithSettled([row("a", "Personal", "800", "li2")], [row("a", "Personal", "800", "li1")], template);
    expect(amounts(out)).toEqual([["a", "Personal", "800.00"], ["a", "Personal", "-800.00"]]);
  });
});
