// A-2 money review (Architect + DevLead): "this calendar year" must be the
// year a commission was PAID OUT (the settling payout's own payoutMonth),
// not the ledger line's own payoutMonth (the earning/sale month) — a line
// earned in December can settle in a January payout under a catch-up run,
// and belongs to the NEW year. A fully-mocked unit test can only assert the
// query SHAPE is right; this proves the real Postgres filter behaves
// correctly. Real throwaway Postgres (needs DATABASE_URL); fake tagged
// data, cleaned up after.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { myRankResult } from "./rank";

const TAG = "A2RANK-";
const thisYear = new Date().getFullYear();
const lastYear = thisYear - 1;
let earnerId = "", zeroId = "", submissionId = "", txId = "";

beforeAll(async () => {
  earnerId = (await prisma.associate.create({
    data: { associateCode: TAG + "EARN", fullName: "Dec Earner Jan Paid", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  zeroId = (await prisma.associate.create({
    data: { associateCode: TAG + "ZERO", fullName: "Zero Received", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  submissionId = (await prisma.salesSubmission.create({
    data: {
      salesDate: new Date(`${lastYear}-12-15`), clientName: TAG + "Client",
      saleAmount: "1000", closingAssociateId: earnerId, paymentPlan: "FullPayment" as never,
    },
    select: { id: true },
  })).id;
  txId = (await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + "TX1", submissionId, salesDate: new Date(`${lastYear}-12-15`), clientName: TAG + "Client",
      saleAmount: "1000", closingAssociateId: earnerId, paymentPlan: "FullPayment" as never,
    },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { transactionId: txId } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: earnerId } });
  await prisma.salesTransaction.deleteMany({ where: { id: txId } });
  await prisma.salesSubmission.deleteMany({ where: { id: submissionId } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("myRankResult — ranks by the settlement year (payout.payoutMonth), not the earning year", () => {
  it("a line earned in December (last year) but settled in a January (this year) Paid payout counts toward THIS year", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: {
        associateId: earnerId, associateName: "Dec Earner Jan Paid", designation: "SalesAssociate" as never,
        payoutMonth: `${thisYear}-01`, totalPayable: "100", payoutStatus: "Paid" as never,
      },
      select: { id: true },
    });
    // The ledger line's OWN payoutMonth is last year — the earning month —
    // deliberately different from the payout's settlement month.
    await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: `${lastYear}-12`, associateId: earnerId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "100", status: "Eligible" as never, payoutId: payout.id,
      },
    });

    const earner = await myRankResult(earnerId);
    const zero = await myRankResult(zeroId);

    // Both are in the active population; the earner has real received this
    // year (via settlement), the zero-associate has none.
    expect(earner?.band.id).not.toBe("rest");
    expect(zero?.band.id).toBe("rest");

    await prisma.commissionLedger.deleteMany({ where: { payoutId: payout.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("the same line does NOT count if the payout instead settled in December last year (both the earning and settlement year)", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: {
        associateId: earnerId, associateName: "Dec Earner Jan Paid", designation: "SalesAssociate" as never,
        payoutMonth: `${lastYear}-12`, totalPayable: "100", payoutStatus: "Paid" as never,
      },
      select: { id: true },
    });
    await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: `${lastYear}-12`, associateId: earnerId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "100", status: "Eligible" as never, payoutId: payout.id,
      },
    });

    const earner = await myRankResult(earnerId);
    expect(earner?.band.id).toBe("rest"); // nothing settled THIS year

    await prisma.commissionLedger.deleteMany({ where: { payoutId: payout.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });
});
