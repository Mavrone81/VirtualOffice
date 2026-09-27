// B-7 (DevLead): a concurrent un-mark and payout-approve on the same
// transaction must never end with an unmarked (Outstanding) invoice whose
// commission line sits in an Approved/Paid payout — setPayoutStatus now
// locks every transaction its lines belong to before its own CAS, the same
// lock markInvoiceUnpaid takes first, closing the interleaving. 20 trials,
// real Postgres, concurrent calls each round. Needs DATABASE_URL; fake data
// only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { prisma } from "@/lib/db";
import { markInvoiceUnpaid } from "@/server/invoices/actions";
import { setPayoutStatus } from "./actions";

const TAG = "B7RACE-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const TRIALS = 20;
let companyId = "", closerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: closerId } });
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

async function mkSettledSale(code: string) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-07-01"), clientName: TAG + code, saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 500 },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-07-01"),
      clientName: TAG + code, saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 500,
    },
  });
  const invoice = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + code, amount: 500, status: "Paid" as never, paidDate: new Date() } });
  const payout = await prisma.monthlyPayout.create({
    data: {
      payoutMonth: `2099-${code}`, associateId: closerId, seq: 0, kind: "Regular" as never,
      associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: "Pending" as never, totalPayable: 100,
    },
  });
  await prisma.commissionLedger.create({
    data: {
      transactionId: tx.id, payoutMonth: `2099-${code}`, associateId: closerId, associateName: "Closer",
      lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never,
      payoutId: payout.id,
    },
  });
  return { tx, invoice, payout };
}

describe("B-7: concurrent un-mark vs payout approve", () => {
  it(`never leaves an unmarked invoice with lines in an Approved/Paid payout (${TRIALS} trials)`, async () => {
    who.session = ADMIN;
    for (let i = 0; i < TRIALS; i++) {
      const code = String(i).padStart(2, "0");
      const { tx, invoice, payout } = await mkSettledSale(code);

      const [unmarkResult, approveResult] = await Promise.allSettled([
        markInvoiceUnpaid(invoice.id, `trial ${i}`),
        setPayoutStatus(payout.id, "Approved"),
      ]);
      expect(unmarkResult.status).toBe("fulfilled");
      expect(approveResult.status).toBe("fulfilled");

      const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const payoutAfter = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: payout.id } });

      // The invariant (DevLead): never Outstanding while the payout is
      // Approved/Paid. Several orderings are safe and all observed across
      // trials — unmark-then-approve (Outstanding/Approved), approve-then-
      // unmark (unmark refused, stays Paid/Approved), and unmark-first
      // wiping the still-Pending payout's line via the eligibility recompute
      // so approve's CAS then misses on the changed total (stays Pending) —
      // only the combination below is unsafe.
      const violated = invAfter.status === "Outstanding" && payoutAfter.payoutStatus !== "Pending";
      expect(violated).toBe(false);

      void tx;
    }
  }, 60_000);
});
