import { describe, it, expect } from "vitest";
import { LedgerLineType as T, LedgerStatus as S } from "@prisma/client";
import { summariseMyShare } from "./my-share";

const txn = { closingAssociateId: "closer", directUplineId: "u1", secondUplineId: "u2" };
const PAID = { payoutStatus: "Paid" as const };
const APPROVED = { payoutStatus: "Approved" as const };

describe("summariseMyShare (My Transactions)", () => {
  const lines = [
    // "received" is the payout's status, not the ledger line's — a line can
    // be LedgerStatus.Paid (legacy) while sitting in a payout that never was.
    { associateId: "closer", lineType: T.Personal, status: S.Paid, amount: "600", payout: PAID },
    { associateId: "closer", lineType: T.Personal, status: S.Pending, amount: "400", payout: null },
    { associateId: "closer", lineType: T.AddOn, status: S.Eligible, amount: "50", payout: APPROVED },
    { associateId: "closer", lineType: T.Personal, status: S.Cancelled, amount: "999", payout: PAID }, // ignored
    { associateId: "helper", lineType: T.Personal, status: S.Paid, amount: "200", payout: PAID },
    { associateId: "u1", lineType: T.Override, status: S.Paid, amount: "200", payout: PAID },
    { associateId: "u2", lineType: T.Override, status: S.Pending, amount: "100", payout: null },
    { associateId: null, lineType: T.CompanyRetained, status: S.Paid, amount: "8000", payout: PAID },
  ];

  it("closer: share, received, balance from own lines only (cancelled excluded)", () => {
    const r = summariseMyShare(lines, "closer", txn);
    expect(r.schemes.sort()).toEqual(["addOn", "closer"]);
    expect(r.share.toString()).toBe("1050");
    expect(r.received.toString()).toBe("600");
    expect(r.balance.toString()).toBe("450");
  });

  it("split associate is labelled as a split share", () => {
    expect(summariseMyShare(lines, "helper", txn).schemes).toEqual(["split"]);
  });

  it("uplines are told which override they earn", () => {
    expect(summariseMyShare(lines, "u1", txn).schemes).toEqual(["directOverride"]);
    const u2 = summariseMyShare(lines, "u2", txn);
    expect(u2.schemes).toEqual(["secondOverride"]);
    expect(u2.balance.toString()).toBe("100");
  });

  it("someone with no lines on the transaction gets zeros", () => {
    const r = summariseMyShare(lines, "stranger", txn);
    expect(r.schemes).toEqual([]);
    expect(r.share.toString()).toBe("0");
  });

  it("F6: received follows the payout's status, not LedgerStatus.Paid", () => {
    // A line can be LedgerStatus.Paid (nothing ever sets this today) while its
    // payout is only Approved, or attached to no payout at all — neither
    // counts as received.
    const notActuallyPaidOut = [
      { associateId: "closer", lineType: T.Personal, status: S.Paid, amount: "500", payout: APPROVED },
      { associateId: "closer", lineType: T.Personal, status: S.Paid, amount: "300", payout: null },
    ];
    expect(summariseMyShare(notActuallyPaidOut, "closer", txn).received.toString()).toBe("0");

    const actuallyPaidOut = [{ associateId: "closer", lineType: T.Personal, status: S.Eligible, amount: "500", payout: PAID }];
    expect(summariseMyShare(actuallyPaidOut, "closer", txn).received.toString()).toBe("500");
  });
});
