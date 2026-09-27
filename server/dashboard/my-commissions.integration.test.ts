// "My commissions" paid tile must follow the PAYOUT's status
// (line.payoutId -> payout.payoutStatus = Paid), not LedgerStatus.Paid,
// which nothing in the app ever sets (A-0/R-6 — same bug class as F6,
// server/dashboard/metrics.integration.test.ts). Real throwaway Postgres
// (needs DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { myCommissionsSummary } from "./my-commissions";

const TAG = "MYCOM-";
let associateId = "", submissionId = "", txId = "";

beforeAll(async () => {
  associateId = (await prisma.associate.create({
    data: { associateCode: TAG + "A1", fullName: "Paid Tile Test", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  submissionId = (await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2099-07-10"), clientName: TAG + "Client",
      saleAmount: "1000", closingAssociateId: associateId, paymentPlan: "FullPayment" as never,
    },
    select: { id: true },
  })).id;
  txId = (await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + "TX1", submissionId, salesDate: new Date("2099-07-10"), clientName: TAG + "Client",
      saleAmount: "1000", closingAssociateId: associateId, paymentPlan: "FullPayment" as never,
    },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { transactionId: txId } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId } });
  await prisma.salesTransaction.deleteMany({ where: { id: txId } });
  await prisma.salesSubmission.deleteMany({ where: { id: submissionId } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("myCommissionsSummary — paid follows payout.payoutStatus, not LedgerStatus.Paid", () => {
  it("a line settled in an Approved (not yet Paid) payout does not count as paid", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Paid Tile Test", designation: "SalesAssociate" as never, payoutMonth: "2099-07", totalPayable: "100", payoutStatus: "Approved" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "100", status: "Eligible" as never, payoutId: payout.id,
      },
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.paid.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("a line settled in a Paid payout counts as paid, even with LedgerStatus still Eligible — and NOT in Eligible too (C1)", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Paid Tile Test", designation: "SalesAssociate" as never, payoutMonth: "2099-07", totalPayable: "100", payoutStatus: "Paid" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "100", status: "Eligible" as never, payoutId: payout.id,
      },
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.paid.toString()).toBe("100");
    // Architect review C1: under R-6 the line's LedgerStatus never moves off
    // Eligible, so without excluding Paid-settled lines this same $100 would
    // also show up in the Eligible tile — double-counted.
    expect(summary.eligible.toString()).toBe("0");
    expect(summary.ledger.map((l) => l.id)).toContain(line.id);

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("an Eligible line settled in an Approved (not yet Paid) payout still counts as Eligible (not yet received)", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Paid Tile Test", designation: "SalesAssociate" as never, payoutMonth: "2099-07", totalPayable: "40", payoutStatus: "Approved" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "40", status: "Eligible" as never, payoutId: payout.id,
      },
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.eligible.toString()).toBe("40");
    expect(summary.paid.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("an Eligible line with no payout at all still counts as Eligible", async () => {
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "15", status: "Eligible" as never,
      },
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.eligible.toString()).toBe("15");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
  });

  it("a Cancelled line attached to a Paid payout is excluded defensively", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Paid Tile Test", designation: "SalesAssociate" as never, payoutMonth: "2099-07", totalPayable: "50", payoutStatus: "Paid" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "50", status: "Cancelled" as never, payoutId: payout.id,
      },
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.paid.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("totals are correct with more than 100 lines — the table's take:100 must not cap the sums (C2)", async () => {
    const LINE_COUNT = 105;
    await prisma.commissionLedger.createMany({
      data: Array.from({ length: LINE_COUNT }, () => ({
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "10", amount: "10", status: "Pending" as never,
      })),
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.pending.toString()).toBe((LINE_COUNT * 10).toString());
    expect(summary.ledger).toHaveLength(100); // the table itself still caps at 100 rows

    await prisma.commissionLedger.deleteMany({ where: { associateId, status: "Pending" as never, amount: "10" } });
  });

  it("eligible/pending totals are unaffected — they key off LedgerStatus, not the payout", async () => {
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: txId, payoutMonth: "2099-07", associateId, lineType: "Personal" as never,
        basisAmount: "1000", amount: "30", status: "Pending" as never,
      },
    });

    const summary = await myCommissionsSummary(associateId);
    expect(summary.pending.toString()).toBe("30");
    expect(summary.paid.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
  });
});
