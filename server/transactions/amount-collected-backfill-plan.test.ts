// A-0 backfill plan — real throwaway Postgres (needs DATABASE_URL); fake data
// only, cleaned up. Covers all four classes (clean, to-update,
// manual-over-collected, manual-deposit-rule-pending) plus the per-month
// summary (M2, Architect money review).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { planAmountCollectedBackfill, summariseByMonth } from "./amount-collected-backfill-plan";

const TAG = "A0BFPLAN-";
let companyId = "", closerId = "";

async function mkTransaction(code: string, saleAmount: number, storedAmountCollected: number, salesDate = "2099-04-01") {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date(salesDate), clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: storedAmountCollected },
    select: { id: true },
  });
  return prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date(salesDate),
      clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never,
      closingAssociateId: closerId, amountCollected: storedAmountCollected,
    },
  });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transaction: { closingAssociateId: closerId } } } });
  await prisma.installmentPlan.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("planAmountCollectedBackfill", () => {
  it("'clean' when the stored value already matches the paid invoices", async () => {
    const tx = await mkTransaction("CLEAN", 1000, 1000);
    await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "CLEAN", amount: 1000, status: "Paid" as never } });

    const rows = await planAmountCollectedBackfill(prisma);
    const row = rows.find((r) => r.transactionId === tx.id)!;
    expect(row.action).toBe("clean");
    expect(row.computedAmountCollected).toBe("1000.00");
  });

  it("flags 'to-update' when the stored value has drifted from the paid invoices", async () => {
    const tx = await mkTransaction("DRIFT", 1000, 0);
    await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "DRIFT", amount: 600, status: "Paid" as never } });

    const rows = await planAmountCollectedBackfill(prisma);
    const row = rows.find((r) => r.transactionId === tx.id)!;
    expect(row.action).toBe("to-update");
    expect(row.storedAmountCollected).toBe("0.00");
    expect(row.computedAmountCollected).toBe("600.00");
  });

  it("flags 'manual-over-collected' when the raw sum exceeds the sale amount (M1)", async () => {
    const tx = await mkTransaction("OVER", 500, 0);
    await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "OVERA", amount: 500, status: "Paid" as never } });
    await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "OVERB", amount: 300, status: "Paid" as never } });

    const rows = await planAmountCollectedBackfill(prisma);
    const row = rows.find((r) => r.transactionId === tx.id)!;
    expect(row.action).toBe("manual-over-collected");
    expect(row.rawCollected).toBe("800.00"); // the true, unclamped sum — visible, not hidden
    expect(row.computedAmountCollected).toBe("500.00"); // what a (never-run) apply would still clamp to
  });

  it("flags 'manual-deposit-rule-pending' for a legacy plan with a deposit but no sequence-0 row", async () => {
    const tx = await mkTransaction("LEGACYDEP", 900, 0);
    const plan = await prisma.installmentPlan.create({ data: { transactionId: tx.id, totalAmount: 900, deposit: 200, installmentCount: 2 } });
    // Legacy shape: only installments 1..2 exist, no sequence 0 (predates A-0).
    await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 1, dueAmount: 350, paid: true } });
    await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 2, dueAmount: 350, paid: false } });

    const rows = await planAmountCollectedBackfill(prisma);
    const row = rows.find((r) => r.transactionId === tx.id)!;
    expect(row.action).toBe("manual-deposit-rule-pending");
    // Computed excludes the unrecorded deposit — shown, but never auto-applied for a manual row.
    expect(row.computedAmountCollected).toBe("350.00");
  });

  it("does not flag a deposit plan that DOES have its sequence-0 row", async () => {
    const tx = await mkTransaction("NEWDEP", 900, 550);
    const plan = await prisma.installmentPlan.create({ data: { transactionId: tx.id, totalAmount: 900, deposit: 200, installmentCount: 2 } });
    await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 0, dueAmount: 200, paid: true } });
    await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 1, dueAmount: 350, paid: true } });
    await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 2, dueAmount: 350, paid: false } });

    const rows = await planAmountCollectedBackfill(prisma);
    const row = rows.find((r) => r.transactionId === tx.id)!;
    expect(row.action).toBe("clean");
    expect(row.computedAmountCollected).toBe("550.00");
  });
});

describe("summariseByMonth (M2)", () => {
  it("groups by salesDate month; manual rows keep their stored value in the 'after' total", async () => {
    // Two transactions in the same month: one to-update (would change), one
    // manual-over-collected (an apply would never touch it, so its
    // contribution to "after" stays at what's stored today, not the clamp).
    const txA = await mkTransaction("MONA", 1000, 0, "2098-11-05");
    await prisma.invoice.create({ data: { transactionId: txA.id, companyId, invoiceNumber: TAG + "MONA", amount: 400, status: "Paid" as never } });

    const txB = await mkTransaction("MONB", 500, 300, "2098-11-20");
    await prisma.invoice.create({ data: { transactionId: txB.id, companyId, invoiceNumber: TAG + "MONBA", amount: 500, status: "Paid" as never } });
    await prisma.invoice.create({ data: { transactionId: txB.id, companyId, invoiceNumber: TAG + "MONBB", amount: 200, status: "Paid" as never } });

    const rows = await planAmountCollectedBackfill(prisma);
    const mine = rows.filter((r) => r.transactionId === txA.id || r.transactionId === txB.id);
    const summary = summariseByMonth(mine);
    expect(summary).toEqual([
      {
        month: "2098-11",
        transactions: 2,
        collectedBefore: "300.00", // 0 (A, stored) + 300 (B, stored)
        collectedAfter: "700.00", // 400 (A, would become to-update) + 300 (B, manual — stays at stored, NOT the 500 clamp)
        toUpdate: 1,
        manual: 1,
      },
    ]);
  });
});
