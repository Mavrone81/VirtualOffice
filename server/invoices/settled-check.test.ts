// B-7 follow-up (DevLead): findSettledTransactionIds is a pure extraction of
// refuseIfSettled's two predicates — this proves the batch call agrees with
// N single calls, including the X1 legacy-unlinked-payout case, and that it
// correctly excludes an unsettled transaction. Real throwaway Postgres
// (needs DATABASE_URL); fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { isTransactionSettled, findSettledTransactionIds } from "./settled-check";

const TAG = "B7SETTLED-";
let companyId = "", closerId = "", secondId = "";

async function mkTransaction(code: string) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-05-01"), clientName: TAG + code, saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
    select: { id: true },
  });
  return prisma.salesTransaction.create({
    data: { transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-05-01"), clientName: TAG + code, saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
  });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  secondId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL2", fullName: "Closer2", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociateId: { in: [closerId, secondId] } } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: { in: [closerId, secondId] } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: { in: [closerId, secondId] } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: { in: [closerId, secondId] } } });
  await prisma.associate.deleteMany({ where: { id: { in: [closerId, secondId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("findSettledTransactionIds agrees with isTransactionSettled per id", () => {
  it("linked Approved/Paid, legacy-unlinked, and unsettled all classify the same in batch as individually", async () => {
    let month = 0;
    const nextMonth = () => `2098-${String(++month).padStart(2, "0")}`;

    // 1. Linked, Approved payout -> settled.
    const txLinked = await mkTransaction("LINKED");
    const linkedMonth = nextMonth();
    const linkedPayout = await prisma.monthlyPayout.create({
      data: { payoutMonth: linkedMonth, associateId: closerId, seq: 0, kind: "Regular" as never, associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: "Approved" as never, totalPayable: 100 },
    });
    await prisma.commissionLedger.create({
      data: { transactionId: txLinked.id, payoutMonth: linkedMonth, associateId: closerId, associateName: "Closer", lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never, payoutId: linkedPayout.id },
    });

    // 2. Unlinked line + a separate legacy Paid payout for the same associate/month -> settled (X1).
    const txLegacy = await mkTransaction("LEGACY");
    const legacyMonth = nextMonth();
    await prisma.commissionLedger.create({
      data: { transactionId: txLegacy.id, payoutMonth: legacyMonth, associateId: closerId, associateName: "Closer", lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never },
    });
    await prisma.monthlyPayout.create({
      data: { payoutMonth: legacyMonth, associateId: closerId, seq: 0, kind: "Regular" as never, associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: "Paid" as never, totalPayable: 100 },
    });

    // 3. No ledger line at all, or a Pending-only payout -> not settled.
    const txClear = await mkTransaction("CLEAR");

    const ids = [txLinked.id, txLegacy.id, txClear.id];
    const [individually, batch] = await Promise.all([
      Promise.all(ids.map((id) => isTransactionSettled(prisma, id))),
      findSettledTransactionIds(ids),
    ]);

    expect(individually).toEqual([true, true, false]);
    expect(batch).toEqual(new Set([txLinked.id, txLegacy.id]));
  });

  it("agrees across ~20 mixed transactions and two associates (the fixed-3-query path)", async () => {
    let month = 100;
    const nextMonth = () => `2097-${String(++month).padStart(2, "0")}`;
    const kinds = ["linked", "legacy", "clean"] as const;
    const N = 21;
    const ids: string[] = [];

    for (let i = 0; i < N; i++) {
      const kind = kinds[i % 3];
      const associateId = i % 2 === 0 ? closerId : secondId;
      const tx = await mkTransaction(`MIX${i}`);
      ids.push(tx.id);
      if (kind === "clean") continue;

      const payoutMonth = nextMonth();
      if (kind === "linked") {
        const payout = await prisma.monthlyPayout.create({
          data: { payoutMonth, associateId, seq: 0, kind: "Regular" as never, associateName: "X", designation: "SalesAssociate" as never, payoutStatus: i % 2 === 0 ? "Approved" as never : "Paid" as never, totalPayable: 100 },
        });
        await prisma.commissionLedger.create({
          data: { transactionId: tx.id, payoutMonth, associateId, associateName: "X", lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never, payoutId: payout.id },
        });
      } else {
        await prisma.commissionLedger.create({
          data: { transactionId: tx.id, payoutMonth, associateId, associateName: "X", lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never },
        });
        await prisma.monthlyPayout.create({
          data: { payoutMonth, associateId, seq: 0, kind: "Regular" as never, associateName: "X", designation: "SalesAssociate" as never, payoutStatus: "Paid" as never, totalPayable: 100 },
        });
      }
    }

    const [individually, batch] = await Promise.all([
      Promise.all(ids.map((id) => isTransactionSettled(prisma, id))),
      findSettledTransactionIds(ids),
    ]);
    const expectedSettled = new Set(ids.filter((_, i) => individually[i]));
    expect(batch).toEqual(expectedSettled);
    // Sanity: both "linked" and "legacy" kinds (2/3 of N) are settled.
    expect(batch.size).toBe(ids.filter((_, i) => kinds[i % 3] !== "clean").length);
  });
});
