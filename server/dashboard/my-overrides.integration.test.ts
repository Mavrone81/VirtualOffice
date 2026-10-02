// My Overrides (OVERALL/RECEIVED, #Additional-p10) must follow the same
// A-0/R-6 derivation as myCommissionsSummary: "received" is
// line.payoutId -> payout.payoutStatus = Paid, never LedgerStatus.Paid,
// which nothing in the app ever sets. Real throwaway Postgres (needs
// DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { myOverridesSummary } from "./my-overrides";

const TAG = "MYOVR-";
const MONTH = "2099-07";
let associateId = "", submissionId = "", txId = "";

beforeAll(async () => {
  associateId = (await prisma.associate.create({
    data: { associateCode: TAG + "A1", fullName: "Overrides Tile Test", designation: "SalesManager" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  submissionId = (await prisma.salesSubmission.create({
    data: { salesDate: new Date(MONTH + "-10"), clientName: TAG + "Client", saleAmount: "1000", closingAssociateId: associateId, paymentPlan: "FullPayment" as never },
    select: { id: true },
  })).id;
  txId = (await prisma.salesTransaction.create({
    data: { transactionCode: TAG + "TX1", submissionId, salesDate: new Date(MONTH + "-10"), clientName: TAG + "Client", saleAmount: "1000", closingAssociateId: associateId, paymentPlan: "FullPayment" as never },
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

describe("myOverridesSummary", () => {
  it("an Eligible, not-yet-paid-out Override line counts in overall but not received", async () => {
    const line = await prisma.commissionLedger.create({
      data: { transactionId: txId, payoutMonth: MONTH, associateId, lineType: "Override" as never, basisAmount: "1000", amount: "50", status: "Eligible" as never },
    });

    const summary = await myOverridesSummary(associateId, MONTH);
    expect(summary.overall.toString()).toBe("50");
    expect(summary.received.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
  });

  it("a line settled in an Approved (not yet Paid) payout counts in overall but not received", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Overrides Tile Test", designation: "SalesManager" as never, payoutMonth: MONTH, totalPayable: "60", payoutStatus: "Approved" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: { transactionId: txId, payoutMonth: MONTH, associateId, lineType: "Override" as never, basisAmount: "1000", amount: "60", status: "Eligible" as never, payoutId: payout.id },
    });

    const summary = await myOverridesSummary(associateId, MONTH);
    expect(summary.overall.toString()).toBe("60");
    expect(summary.received.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("a line settled in a Paid payout counts in BOTH overall and received, even with LedgerStatus still Eligible (same A-0/R-6 shape as my-commissions)", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Overrides Tile Test", designation: "SalesManager" as never, payoutMonth: MONTH, totalPayable: "70", payoutStatus: "Paid" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: { transactionId: txId, payoutMonth: MONTH, associateId, lineType: "Override" as never, basisAmount: "1000", amount: "70", status: "Eligible" as never, payoutId: payout.id },
    });

    const summary = await myOverridesSummary(associateId, MONTH);
    expect(summary.overall.toString()).toBe("70");
    expect(summary.received.toString()).toBe("70");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  // 🔴 Money-figure change, explicitly required: a Cancelled override line
  // must be excluded from BOTH figures. Previously (before this kit) the
  // two existing "My Overrides" reads summed every Override line with no
  // status filter at all, so a Cancelled line would have inflated the old
  // figure — a visible total may shift for anyone who had one. Stated here
  // AND in the kit's REF-SHA/PR text, not left as a silent behaviour change.
  it("a Cancelled override line is excluded from BOTH overall and received, even if it was settled in a Paid payout", async () => {
    const payout = await prisma.monthlyPayout.create({
      data: { associateId, associateName: "Overrides Tile Test", designation: "SalesManager" as never, payoutMonth: MONTH, totalPayable: "80", payoutStatus: "Paid" as never },
      select: { id: true },
    });
    const line = await prisma.commissionLedger.create({
      data: { transactionId: txId, payoutMonth: MONTH, associateId, lineType: "Override" as never, basisAmount: "1000", amount: "80", status: "Cancelled" as never, payoutId: payout.id },
    });

    const summary = await myOverridesSummary(associateId, MONTH);
    expect(summary.overall.toString()).toBe("0");
    expect(summary.received.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("a Personal (non-Override) line is never counted, regardless of status or payout", async () => {
    const line = await prisma.commissionLedger.create({
      data: { transactionId: txId, payoutMonth: MONTH, associateId, lineType: "Personal" as never, basisAmount: "1000", amount: "90", status: "Eligible" as never },
    });

    const summary = await myOverridesSummary(associateId, MONTH);
    expect(summary.overall.toString()).toBe("0");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
  });

  it("a line in a different payoutMonth is not counted (period scoping is real, not cosmetic)", async () => {
    const otherMonth = "2099-08";
    const line = await prisma.commissionLedger.create({
      data: { transactionId: txId, payoutMonth: otherMonth, associateId, lineType: "Override" as never, basisAmount: "1000", amount: "100", status: "Eligible" as never },
    });

    const summaryThisMonth = await myOverridesSummary(associateId, MONTH);
    const summaryOtherMonth = await myOverridesSummary(associateId, otherMonth);
    expect(summaryThisMonth.overall.toString()).toBe("0");
    expect(summaryOtherMonth.overall.toString()).toBe("100");

    await prisma.commissionLedger.delete({ where: { id: line.id } });
  });
});
