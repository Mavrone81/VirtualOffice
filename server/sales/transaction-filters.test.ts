import { describe, it, expect } from "vitest";
import { Designation, CommissionEligibility } from "@prisma/client";
import { transactionWhere, parseTransactionSearch } from "./transaction-filters";

describe("transactionWhere — B-3 query builder", () => {
  it("no filters → no where clause", () => {
    expect(transactionWhere({})).toEqual({});
  });

  it("designation narrows to closingAssociate.designation", () => {
    expect(transactionWhere({ designation: Designation.SalesManager })).toEqual({
      AND: [{ closingAssociate: { designation: Designation.SalesManager } }],
    });
  });

  it("team narrows to closingAssociateId in the resolved team scope", () => {
    expect(transactionWhere({ teamMemberIds: ["a1", "a2"] })).toEqual({
      AND: [{ closingAssociateId: { in: ["a1", "a2"] } }],
    });
  });

  it("date range narrows to salesDate >= from and < to (to is exclusive, the day after)", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-10-01T00:00:00.000Z");
    expect(transactionWhere({ from, to })).toEqual({
      AND: [{ salesDate: { gte: from } }, { salesDate: { lt: to } }],
    });
  });

  it("a from-only range only sets gte", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    expect(transactionWhere({ from })).toEqual({ AND: [{ salesDate: { gte: from } }] });
  });

  it("product narrows to a line item with that product code", () => {
    expect(transactionWhere({ product: "FUN-BASE" })).toEqual({
      AND: [{ lineItems: { some: { productCode: "FUN-BASE" } } }],
    });
  });

  it("eligibility narrows to commissionEligibility", () => {
    expect(transactionWhere({ eligibility: CommissionEligibility.Eligible })).toEqual({
      AND: [{ commissionEligibility: CommissionEligibility.Eligible }],
    });
  });

  it("closer narrows to a specific closingAssociateId", () => {
    expect(transactionWhere({ closer: "assoc-1" })).toEqual({
      AND: [{ closingAssociateId: "assoc-1" }],
    });
  });

  it("productCodes (B-2: a resolved product category) narrows to any line item with one of those codes", () => {
    expect(transactionWhere({ productCodes: ["FUN-BASE", "PET-CREMATE"] })).toEqual({
      AND: [{ lineItems: { some: { productCode: { in: ["FUN-BASE", "PET-CREMATE"] } } } }],
    });
  });

  it("txnId (B-2) narrows to a case-insensitive transactionCode prefix match", () => {
    expect(transactionWhere({ txnId: "TXN-004" })).toEqual({
      AND: [{ transactionCode: { startsWith: "TXN-004", mode: "insensitive" } }],
    });
  });

  it("combined filters AND together, one clause per active filter", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2027-01-01T00:00:00.000Z");
    const where = transactionWhere({
      designation: Designation.SalesDirector,
      teamMemberIds: ["a1", "a2"],
      from,
      to,
      product: "FUN-BASE",
      eligibility: CommissionEligibility.PartiallyEligible,
      closer: "assoc-9",
    });
    expect(where).toEqual({
      AND: [
        { closingAssociateId: "assoc-9" },
        { closingAssociate: { designation: Designation.SalesDirector } },
        { closingAssociateId: { in: ["a1", "a2"] } },
        { salesDate: { gte: from } },
        { salesDate: { lt: to } },
        { lineItems: { some: { productCode: "FUN-BASE" } } },
        { commissionEligibility: CommissionEligibility.PartiallyEligible },
      ],
    });
  });
});

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("parseTransactionSearch — validates URL query params before they reach Prisma", () => {
  it("empty input → everything undefined, no throw", () => {
    expect(parseTransactionSearch({})).toEqual({
      designation: undefined, team: undefined, from: undefined, to: undefined,
      product: undefined, eligibility: undefined, closer: undefined,
    });
  });

  it("a valid designation passes through", () => {
    expect(parseTransactionSearch({ designation: Designation.SalesManager }).designation).toBe(Designation.SalesManager);
  });

  it("garbage designation, including inherited Object keys, is dropped", () => {
    expect(parseTransactionSearch({ designation: "constructor" }).designation).toBeUndefined();
    expect(parseTransactionSearch({ designation: "toString" }).designation).toBeUndefined();
    expect(parseTransactionSearch({ designation: "Wizard" }).designation).toBeUndefined();
  });

  it("a valid eligibility passes through; garbage is dropped", () => {
    expect(parseTransactionSearch({ eligibility: CommissionEligibility.Eligible }).eligibility).toBe(CommissionEligibility.Eligible);
    expect(parseTransactionSearch({ eligibility: "hasOwnProperty" }).eligibility).toBeUndefined();
  });

  it("a valid UUID passes through for team/closer; non-UUID strings are dropped", () => {
    expect(parseTransactionSearch({ team: VALID_UUID }).team).toBe(VALID_UUID);
    expect(parseTransactionSearch({ closer: VALID_UUID }).closer).toBe(VALID_UUID);
    expect(parseTransactionSearch({ team: "'; DROP TABLE associates;--" }).team).toBeUndefined();
    expect(parseTransactionSearch({ closer: "not-a-uuid" }).closer).toBeUndefined();
  });

  it("a valid YYYY-MM-DD `from` parses to that UTC calendar day, regardless of server timezone", () => {
    expect(parseTransactionSearch({ from: "2026-09-01" }).from).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("garbage, malformed, or invalid-calendar dates are dropped, not thrown", () => {
    expect(parseTransactionSearch({ from: "not-a-date" }).from).toBeUndefined();
    expect(parseTransactionSearch({ from: "2026-13-40" }).from).toBeUndefined();
    expect(parseTransactionSearch({ from: "2026-02-30" }).from).toBeUndefined(); // no silent rollover to Mar 2
    expect(parseTransactionSearch({ to: "2026/09/01" }).to).toBeUndefined();
  });

  it("`to` is exclusive — the UTC midnight starting the day after, so same-day sales aren't dropped", () => {
    expect(parseTransactionSearch({ to: "2026-09-26" }).to).toEqual(new Date("2026-09-27T00:00:00.000Z"));
  });

  it("product is passed through as a plain trimmed string (not a UUID column, no format check needed)", () => {
    expect(parseTransactionSearch({ product: "  FUN-BASE  " }).product).toBe("FUN-BASE");
    expect(parseTransactionSearch({ product: "" }).product).toBeUndefined();
  });

  it("txnId (B-2) is trimmed and passed through; empty/whitespace-only is dropped", () => {
    expect(parseTransactionSearch({ txnId: "  TXN-004  " }).txnId).toBe("TXN-004");
    expect(parseTransactionSearch({ txnId: "" }).txnId).toBeUndefined();
    expect(parseTransactionSearch({ txnId: "   " }).txnId).toBeUndefined();
  });

  it("txnId longer than the cap is truncated, not rejected outright (still narrows, just to a longer prefix than anything real)", () => {
    const long = "T".repeat(100);
    expect(parseTransactionSearch({ txnId: long }).txnId).toHaveLength(40);
  });

  it("category (B-2) is passed through as a plain trimmed string — the page resolves it to productCodes", () => {
    expect(parseTransactionSearch({ category: "  Funeral  " }).category).toBe("Funeral");
    expect(parseTransactionSearch({ category: "" }).category).toBeUndefined();
  });
});
