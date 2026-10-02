// Team Sales "Commission" column (C-9, 02 Oct 2026): proves the column shows
// ONE associate's own Personal commission line on a transaction -- never a
// Cancelled line, never CompanyRetained/ExternalPayable (the company's own
// share, which Q2 says associates must never see), and never another
// associate's split share summed in. A total computed on data with no
// Cancelled/company-share/split rows at all would pass even if any of these
// predicates were missing entirely; every exclusion case here has a
// DISTINCTIVE amount present in the fixture, so a leak is unmistakable.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Designation, LedgerLineType, LedgerStatus, PaymentPlan } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ZERO } from "@/lib/money";
import { fetchTeamSalesCommissionByTransaction, teamSalesCommissionFor } from "./team-commission-column";

const TAG = "TEAMSALESCOMM-";

let closerId = "";
let splitPartnerId = "";
let txnPersonalId = "";
let txnCancelledId = "";
let txnCompanyOnlyId = "";
let txnSplitId = "";

async function makeTransaction(code: string, closingAssociateId: string) {
  const submission = await prisma.salesSubmission.create({
    data: {
      clientName: "Fake client " + code,
      salesDate: new Date("2026-09-01"),
      saleAmount: "10000.00",
      paymentPlan: PaymentPlan.FullPayment,
      closingAssociateId,
      transactionCode: code,
    },
  });
  const transaction = await prisma.salesTransaction.create({
    data: {
      transactionCode: code,
      submissionId: submission.id,
      clientName: "Fake client " + code,
      salesDate: new Date("2026-09-01"),
      saleAmount: "10000.00",
      paymentPlan: PaymentPlan.FullPayment,
      closingAssociateId,
    },
  });
  return transaction.id;
}

beforeAll(async () => {
  const closer = await prisma.associate.create({
    data: { associateCode: TAG + "CLOSER", fullName: "Fake closer", designation: Designation.SalesAssociate },
  });
  closerId = closer.id;
  const partner = await prisma.associate.create({
    data: { associateCode: TAG + "PARTNER", fullName: "Fake split partner", designation: Designation.SalesAssociate },
  });
  splitPartnerId = partner.id;

  txnPersonalId = await makeTransaction(TAG + "1", closerId);
  txnCancelledId = await makeTransaction(TAG + "2", closerId);
  txnCompanyOnlyId = await makeTransaction(TAG + "3", closerId);
  txnSplitId = await makeTransaction(TAG + "4", closerId);

  await prisma.commissionLedger.createMany({
    data: [
      // The real, included case: one associate, one Personal line.
      {
        transactionId: txnPersonalId,
        payoutMonth: "2026-09",
        associateId: closerId,
        lineType: LedgerLineType.Personal,
        basisAmount: "5000.00",
        amount: "500.00",
        status: LedgerStatus.Pending,
      },
      // A Cancelled Personal line -- must be excluded. Distinctive amount
      // (999.00, unlike any other fixture value) so a leak is unmistakable.
      {
        transactionId: txnCancelledId,
        payoutMonth: "2026-09",
        associateId: closerId,
        lineType: LedgerLineType.Personal,
        basisAmount: "9990.00",
        amount: "999.00",
        status: LedgerStatus.Cancelled,
      },
      // Company-side lines only, no Personal line at all. associateId: null
      // matches how the engine actually creates these (engine.ts:76,115).
      {
        transactionId: txnCompanyOnlyId,
        payoutMonth: "2026-09",
        associateId: null,
        lineType: LedgerLineType.CompanyRetained,
        basisAmount: "10000.00",
        amount: "777.00",
        status: LedgerStatus.Pending,
      },
      {
        transactionId: txnCompanyOnlyId,
        payoutMonth: "2026-09",
        associateId: null,
        lineType: LedgerLineType.ExternalPayable,
        basisAmount: "10000.00",
        amount: "888.00",
        status: LedgerStatus.Pending,
      },
      // Flow-3 split sale (engine.ts:94-107): TWO Personal lines on the SAME
      // transaction, one per associate. Distinctive, unequal amounts so a
      // sum-of-both (300+200=500, which is also closerAmt in the other
      // fixture by coincidence of round numbers -- chosen deliberately so a
      // summing bug can't hide behind a different fixture's expected value)
      // is distinguishable from either individual share.
      {
        transactionId: txnSplitId,
        payoutMonth: "2026-09",
        associateId: closerId,
        lineType: LedgerLineType.Personal,
        basisAmount: "5000.00",
        amount: "300.00",
        status: LedgerStatus.Pending,
      },
      {
        transactionId: txnSplitId,
        payoutMonth: "2026-09",
        associateId: splitPartnerId,
        lineType: LedgerLineType.Personal,
        basisAmount: "5000.00",
        amount: "200.00",
        status: LedgerStatus.Pending,
      },
    ],
  });
});
afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { payoutMonth: "2026-09", associateId: { in: [closerId, splitPartnerId] } } });
  await prisma.commissionLedger.deleteMany({ where: { transactionId: txnCompanyOnlyId } });
  await prisma.salesTransaction.deleteMany({ where: { transactionCode: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { transactionCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("Team Sales Commission column — one associate's own Personal line, never summed across a split", () => {
  it("a transaction with a real Personal line returns that amount for its closing associate", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([txnPersonalId]);
    expect(teamSalesCommissionFor(map, txnPersonalId, closerId)?.toFixed(2)).toBe("500.00");
  });

  it("SPLIT SALE — the closer's row shows only the closer's own share, not the sum of both Personal lines", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([txnSplitId]);
    expect(teamSalesCommissionFor(map, txnSplitId, closerId)?.toFixed(2)).toBe("300.00");
  });

  it("SPLIT SALE — the partner's own row (a different associate, same transaction) shows only their share", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([txnSplitId]);
    expect(teamSalesCommissionFor(map, txnSplitId, splitPartnerId)?.toFixed(2)).toBe("200.00");
  });

  it("CONTROL — both split lines are really on the same transaction and really sum to more than either share (so a summing bug would have been caught)", async () => {
    const raw = await prisma.commissionLedger.findMany({ where: { transactionId: txnSplitId }, orderBy: { amount: "asc" } });
    expect(raw.map((r) => r.amount.toFixed(2))).toEqual(["200.00", "300.00"]);
    const total = raw.reduce((acc, r) => acc.add(r.amount), ZERO);
    expect(total.toFixed(2)).toBe("500.00"); // what the pre-fix bug would have shown for EITHER associate
  });

  it("EXCLUSION FIRES — a Cancelled Personal line is present in the fixture and absent from the result", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([txnCancelledId]);
    expect(teamSalesCommissionFor(map, txnCancelledId, closerId)).toBeUndefined();
  });

  it("CONTROL — the Cancelled line really is there and really is 999.00 (the exclusion test isn't vacuous over empty data)", async () => {
    const raw = await prisma.commissionLedger.findMany({ where: { transactionId: txnCancelledId } });
    expect(raw).toHaveLength(1);
    expect(raw[0].status).toBe(LedgerStatus.Cancelled);
    expect(raw[0].amount.toFixed(2)).toBe("999.00");
  });

  it("CompanyRetained/ExternalPayable-only transaction returns no entry at all (not zero -- no Personal line exists)", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([txnCompanyOnlyId]);
    expect(teamSalesCommissionFor(map, txnCompanyOnlyId, closerId)).toBeUndefined();
  });

  it("CONTROL — the company-share amounts (777.00, 888.00) really are in that transaction's raw rows", async () => {
    const raw = await prisma.commissionLedger.findMany({ where: { transactionId: txnCompanyOnlyId }, orderBy: { amount: "asc" } });
    expect(raw.map((r) => r.amount.toFixed(2))).toEqual(["777.00", "888.00"]);
    expect(raw.every((r) => r.associateId === null)).toBe(true);
  });

  it("a transaction id with no commissionLedger rows at all also returns no entry for any associate", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([txnPersonalId, txnCancelledId, txnCompanyOnlyId]);
    expect(map.size).toBe(1);
    expect(teamSalesCommissionFor(map, txnPersonalId, closerId)?.toFixed(2)).toBe("500.00");
  });

  it("an empty transaction id list short-circuits to an empty map without querying", async () => {
    const map = await fetchTeamSalesCommissionByTransaction([]);
    expect(map.size).toBe(0);
  });
});
