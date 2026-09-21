import { describe, it, expect } from "vitest";
import { Designation as G, LedgerLineType as T, LedgerStatus as S } from "@prisma/client";
import { descendants, managerOptions, parseTab, performanceByAssociate, selectRecruits } from "./recruitment-view";

// me ─┬─ a (SM) ─┬─ a1 ── a11
//     │          └─ a2
//     └─ b (SA)
// x (unrelated)
const n = (id: string, up: string | null, designation: G = G.SalesAssociate) => ({ id, directUplineId: up, designation, associateCode: id.toUpperCase(), fullName: id });
const rows = [n("me", null, G.SalesDirector), n("a", "me", G.SalesManager), n("a1", "a"), n("a2", "a"), n("a11", "a1"), n("b", "me"), n("x", null)];
const ids = (r: { id: string }[]) => r.map((x) => x.id).sort();

describe("recruitment tabs (A8)", () => {
  it("all = whole tree below me, nothing unrelated, never me", () => {
    expect(ids(descendants(rows, "me"))).toEqual(["a", "a1", "a11", "a2", "b"]);
    expect(ids(selectRecruits(rows, "me", "all"))).toEqual(["a", "a1", "a11", "a2", "b"]);
  });
  it("direct = my own recruits only", () => {
    expect(ids(selectRecruits(rows, "me", "direct"))).toEqual(["a", "b"]);
  });
  it("downline = below me minus my direct recruits", () => {
    expect(ids(selectRecruits(rows, "me", "downline"))).toEqual(["a1", "a11", "a2"]);
  });
  it("manager filter narrows to that manager's tree", () => {
    expect(ids(selectRecruits(rows, "me", "all", "a"))).toEqual(["a1", "a11", "a2"]);
    expect(ids(selectRecruits(rows, "me", "direct", "a"))).toEqual([]);
  });
  it("manager options = non-associate designations below me who have recruits", () => {
    expect(ids(managerOptions(rows, "me"))).toEqual(["a"]);
  });
  it("unknown tab falls back to all", () => {
    expect(parseTab("nope")).toBe("all");
    expect(parseTab("direct")).toBe("direct");
  });
  it("survives a cycle in bad data", () => {
    const loop = [n("p", "q"), n("q", "p")];
    expect(ids(descendants(loop, "p"))).toEqual(["q"]);
  });
});

describe("downline performance (A10)", () => {
  const txns = [
    { id: "t1", closingAssociateId: "a1", saleAmount: "10000", directUplineId: "a", secondUplineId: "me" },
    { id: "t2", closingAssociateId: "b", saleAmount: "5000", directUplineId: "me", secondUplineId: null },
  ];
  const lines = [
    { transactionId: "t1", associateId: "a1", lineType: T.Personal, status: S.Eligible, amount: "9000" },
    { transactionId: "t1", associateId: "a", lineType: T.Override, status: S.Eligible, amount: "200" },
    { transactionId: "t1", associateId: "me", lineType: T.Override, status: S.Paid, amount: "100" },
    { transactionId: "t2", associateId: "b", lineType: T.Personal, status: S.Pending, amount: "4500" },
    { transactionId: "t2", associateId: "me", lineType: T.Override, status: S.Pending, amount: "100" },
    { transactionId: "t2", associateId: "b", lineType: T.Personal, status: S.Cancelled, amount: "777" },
  ];
  it("totals per associate and my override split by position", () => {
    const p = performanceByAssociate(["a", "a1", "b"], txns, lines, "me");
    expect(p.get("a1")!.transacted.toString()).toBe("10000");
    expect(p.get("a1")!.commission.toString()).toBe("9000");
    expect(p.get("a1")!.mySecond.toString()).toBe("100");
    expect(p.get("a1")!.myDirect.toString()).toBe("0");
    expect(p.get("b")!.commission.toString()).toBe("4500"); // cancelled excluded
    expect(p.get("b")!.myDirect.toString()).toBe("100");
    expect(p.get("a")!.commission.toString()).toBe("200"); // a's own override income
  });
});
