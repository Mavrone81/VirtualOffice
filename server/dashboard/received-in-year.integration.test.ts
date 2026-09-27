// A-3: the "My Dashboard" target/remaining tiles must derive "received" from
// the settling payout (line.payoutId -> payout.payoutStatus = Paid), bucketed
// by the PAYOUT's own month — not the ledger line's payoutMonth (the sale's
// earning month), and not LedgerStatus.Paid (F6, nothing ever sets it). Real
// throwaway Postgres (needs DATABASE_URL); fake data only, all rows tagged
// and cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { receivedInYear } from "./metrics";
import { remainingToTarget, inPeriod } from "@/lib/quota";

const TAG = "A3RCV-";
const YEAR = "2099";
let closerId = "";

/** A ledger line already settled in a payout at the given status — bypasses the
 * full sales/payout pipeline (that flow is proven separately by F6); this
 * module's job is just "sum by the payout's month, gated on the payout's own
 * status". `earnedMonth` (the line's own payoutMonth) and `paidMonth` (the
 * settling MonthlyPayout's month) can differ — M5-CF catch-up settles a line
 * later than it was earned. */
async function mkSettledLine(code: string, seq: number, amount: string, payoutStatus: "Pending" | "Approved" | "Paid", earnedMonth: string, paidMonth: string) {
  const submission = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-05-10"), clientName: TAG + code, saleAmount: "0", paymentPlan: "FullPayment" as never, closingAssociateId: closerId },
    select: { id: true },
  });
  const transaction = await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: submission.id, salesDate: new Date("2099-05-10"),
      clientName: TAG + code, saleAmount: "0", paymentPlan: "FullPayment" as never, closingAssociateId: closerId,
    },
    select: { id: true },
  });
  const payout = await prisma.monthlyPayout.create({
    data: { payoutMonth: paidMonth, seq, associateId: closerId, associateName: TAG + "Closer", designation: "SalesAssociate" as never, totalPayable: amount, payoutStatus: payoutStatus as never },
    select: { id: true },
  });
  await prisma.commissionLedger.create({
    data: {
      transactionId: transaction.id, payoutMonth: earnedMonth, associateId: closerId, associateName: TAG + "Closer",
      lineType: "Personal" as never, basisAmount: amount, amount, status: "Eligible" as never, payoutId: payout.id,
    },
  });
}

beforeAll(async () => {
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;

  await mkSettledLine("PAID", 0, "800", "Paid", "2099-05", "2099-05"); // earned and paid same month — counts
  await mkSettledLine("APPROVED", 1, "500", "Approved", "2099-05", "2099-05"); // not yet Paid — must not count
  await mkSettledLine("CATCHUP", 2, "300", "Paid", "2099-07", "2099-10"); // earned July, paid October (M5-CF catch-up)
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.associate.deleteMany({ where: mine });
});

describe("receivedInYear — A3 dashboard target/remaining tiles", () => {
  it("only counts lines settled in a Paid payout, not Approved-but-unpaid", async () => {
    const rows = await receivedInYear(closerId, YEAR);
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    expect(total).toBe(1100); // 800 (May, Paid) + 300 (catch-up, Paid), NOT +500 (Approved)
  });

  it("remaining = target − received, using the real Paid figure", async () => {
    const target = 2000;
    const rows = await receivedInYear(closerId, YEAR);
    const received = rows.reduce((s, r) => s + Number(r.amount), 0);
    expect(remainingToTarget(target, received)).toBe(900); // 2000 - 1100
  });

  it("a July-earned line settled in an October Paid payout is bucketed under October, not July (M5-CF catch-up)", async () => {
    const rows = await receivedInYear(closerId, YEAR);
    const octoberReceived = rows.filter((r) => inPeriod(r.payoutMonth, "2099-10")).reduce((s, r) => s + Number(r.amount), 0);
    const julyReceived = rows.filter((r) => inPeriod(r.payoutMonth, "2099-07")).reduce((s, r) => s + Number(r.amount), 0);
    expect(octoberReceived).toBe(300); // reduces October's remaining
    expect(julyReceived).toBe(0); // NOT July's — the line only earned there, it settled in October
  });
});
