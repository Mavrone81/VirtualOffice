// A-0 deposit row (Samuel, Q9): the deposit becomes installment schedule
// sequence 0. Accounts marks it paid like any installment (moves
// amountCollected, A-0), but it does NOT count toward the N-installment
// eligibility threshold. Real throwaway Postgres (needs DATABASE_URL); fake
// data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
// A-17 follow-up (ambient-flag release blocker, same shape as the earlier one):
// this file is not about A-17 at all, but submitSale (unrelated, pre-existing)
// reads the AMBIENT A17_CLOSED_DEAL_FLOW and sets flow=ClosedDeal whenever it
// is true — which then trips B1's flow=ClosedDeal refusal in
// approveQuotation/closeSale below, used here as pure fixture scaffolding.
// Forced off so this file is not steered by ambient config either way; a
// named coverage gap (this file's path under a real flag-ON config) is
// recorded in reviews/a17-flag-on-preconditions.md as a flag-flip precondition.
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, A17_CLOSED_DEAL_FLOW: false } }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "./actions";
import { markInstallmentPaid } from "@/server/invoices/actions";
import { fakePdfFile } from "@/lib/test-fixtures";

const TAG = "A0DEP-";
const SALE_DATE = "2099-09-10";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Deposit Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date(SALE_DATE),
    },
    select: { id: true },
  })).id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2099-01-01"),
      rateSnapshot: {
        commissionType: "Percentage", closingCommPct: "10", closingCommFixed: null,
        companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
        isExternal: false, externalCompanyRetainedPct: null,
      } as never,
    },
  });
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transaction: { closingAssociate: mine } } } });
  await prisma.installmentPlan.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.submissionDocument.deleteMany({ where: { fileKey: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: mine });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

describe("Deposit schedule row (sequence 0)", () => {
  it("is created at close, moves amountCollected but not the installment-eligibility count", async () => {
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    expect((await submitSale({
      salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Installment",
      deposit: 300, installmentCount: 3,
      lines: [{ productId, lineSaleAmount: 1200, comCodeIds: [] }],
    } as never)).ok).toBe(true);
    const sub = await prisma.salesSubmission.findFirstOrThrow({ where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true } });

    who.session = ADMIN;
    expect((await approveSubmissionSplit(sub.id)).ok).toBe(true);
    expect((await adminApproveSplit(sub.id)).ok).toBe(true);
    expect((await approveQuotation(sub.id)).ok).toBe(true);
    await prisma.submissionDocument.create({ data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
    expect((await closeSale(sub.id)).ok).toBe(true);

    const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub.id } });
    const rows = await prisma.installmentSchedule.findMany({ where: { plan: { transactionId: tx.id } }, orderBy: { sequence: "asc" } });

    // Row 0 = the deposit; rows 1..3 cover (1200 − 300) exactly.
    expect(rows.map((r) => r.sequence)).toEqual([0, 1, 2, 3]);
    expect(rows[0].dueAmount.toFixed(2)).toBe("300.00");
    expect(rows.slice(1).reduce((s, r) => s + Number(r.dueAmount), 0)).toBeCloseTo(900, 10);

    const [deposit, i1, i2, i3] = rows;

    // Deposit paid: amountCollected moves, eligibility does not (0 real installments paid).
    expect((await markInstallmentPaid(deposit.id, fakePdfFile())).ok).toBe(true);
    let txRow = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txRow.amountCollected.toFixed(2)).toBe("300.00");
    expect(txRow.commissionEligibility).toBe("PendingCollection");

    // Deposit + 1 installment paid: still below the default threshold (3).
    expect((await markInstallmentPaid(i1.id, fakePdfFile())).ok).toBe(true);
    txRow = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txRow.commissionEligibility).toBe("PendingCollection");

    // Deposit + 2 installments paid: the literal spec case — still Pending,
    // because the deposit must not count toward the 3-installment threshold.
    expect((await markInstallmentPaid(i2.id, fakePdfFile())).ok).toBe(true);
    txRow = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txRow.amountCollected.toFixed(2)).toBe("900.00");
    expect(txRow.commissionEligibility).toBe("PendingCollection");

    // The 3rd real installment flips it to Eligible.
    expect((await markInstallmentPaid(i3.id, fakePdfFile())).ok).toBe(true);
    txRow = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txRow.amountCollected.toFixed(2)).toBe("1200.00");
    expect(txRow.commissionEligibility).toBe("Eligible");
  });
});
