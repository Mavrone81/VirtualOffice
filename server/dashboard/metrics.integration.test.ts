// F6 — "received"/grossReceived must follow the PAYOUT's status
// (line.payoutId -> payout.payoutStatus = Paid), not LedgerStatus.Paid, which
// nothing in the app ever sets. Full flow on a real throwaway Postgres (needs
// DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { fakePdfFile } from "@/lib/test-fixtures";
import { runPayouts, setPayoutStatus } from "@/server/payouts/actions";
import { dashboardMetrics } from "./metrics";
import { myTransactionRows } from "@/server/transactions/queries";
import { summariseMyShare } from "@/lib/my-share";

const TAG = "F6RCV-";
const SALE_DATE = "2099-07-10";
const MONTH = "2099-07";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "F6 Test", commissionType: "Percentage" as never,
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
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.invoice.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.submissionDocument.deleteMany({ where: { fileKey: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: mine });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

describe("F6: received/grossReceived derive from the payout, not LedgerStatus", () => {
  it("a paid invoice + an approved-then-paid payout makes received/grossReceived > 0", async () => {
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    expect((await submitSale({
      salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
      lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
    } as never)).ok).toBe(true);
    const sub = await prisma.salesSubmission.findFirstOrThrow({ where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true } });

    who.session = ADMIN;
    expect((await approveSubmissionSplit(sub.id)).ok).toBe(true);
    expect((await adminApproveSplit(sub.id)).ok).toBe(true);
    expect((await approveQuotation(sub.id)).ok).toBe(true);
    await prisma.submissionDocument.create({ data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
    expect((await closeSale(sub.id)).ok).toBe(true);

    const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub.id } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { transactionId: tx.id } });
    expect((await markInvoicePaid(invoice.id, fakePdfFile())).ok).toBe(true);

    const eligibleLine = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: tx.id, associateId: closerId } });
    expect(eligibleLine.status).toBe("Eligible"); // confirmed by mark-paid, not yet settled into a payout

    // Before any payout exists: not received, whatever the ledger status is.
    who.session = { user: { associateId: closerId, id: "sess-closer", role: "SalesAssociate" } };
    const beforeRows = await myTransactionRows("list");
    const beforeRow = beforeRows!.find((r) => r.id === tx.id)!;
    expect(summariseMyShare(beforeRow.ledgerLines, closerId, beforeRow).received.toString()).toBe("0");

    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: closerId, payoutMonth: MONTH } });
    expect((await setPayoutStatus(payout.id, "Approved")).ok).toBe(true);
    // Approved but not yet Paid: still not received.
    const midRows = await myTransactionRows("list");
    const midRow = midRows!.find((r) => r.id === tx.id)!;
    expect(summariseMyShare(midRow.ledgerLines, closerId, midRow).received.toString()).toBe("0");

    expect((await setPayoutStatus(payout.id, "Paid")).ok).toBe(true);

    const afterRows = await myTransactionRows("list");
    const afterRow = afterRows!.find((r) => r.id === tx.id)!;
    const mine = summariseMyShare(afterRow.ledgerLines, closerId, afterRow);
    const expectedLine = afterRow.ledgerLines.find((l) => l.associateId === closerId)!;
    expect(mine.received.toString()).toBe(expectedLine.amount.toString());
    expect(Number(mine.received)).toBeGreaterThan(0);

    who.session = ADMIN;
    const metrics = await dashboardMetrics(null);
    expect(Number(metrics.grossReceived)).toBeGreaterThan(0);
  });
});
