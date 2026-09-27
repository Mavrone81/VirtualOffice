// A-0 invariant (DevLead, review of A-0): a SalesTransaction has invoices OR
// installment-schedule rows, never both — closeSale's fullPayment/!fullPayment
// branches are mutually exclusive. computeAmountCollected/recomputeAmountCollected
// sums BOTH sources, so if a future change (B-7, A-17) ever issues invoices for
// an installment sale (or vice versa), it would double count. This test pins
// the invariant now so that change has to touch this file deliberately. Real
// throwaway Postgres (needs DATABASE_URL); fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";

const TAG = "A0INV-";
const SALE_DATE = "2099-10-10";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

async function closedSale(paymentPlan: "Full Payment" | "Installment") {
  who.session = { user: { associateId: closerId, id: "sess-closer" } };
  expect((await submitSale({
    salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan,
    ...(paymentPlan === "Installment" ? { installmentCount: 6 } : {}),
    lines: [{ productId, lineSaleAmount: 600, comCodeIds: [] }],
  } as never)).ok).toBe(true);
  const sub = await prisma.salesSubmission.findFirstOrThrow({ where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true } });

  who.session = ADMIN;
  expect((await approveSubmissionSplit(sub.id)).ok).toBe(true);
  expect((await adminApproveSplit(sub.id)).ok).toBe(true);
  expect((await approveQuotation(sub.id)).ok).toBe(true);
  await prisma.submissionDocument.create({ data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + Date.now(), fileName: "signed.pdf" } });
  expect((await closeSale(sub.id)).ok).toBe(true);
  return prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub.id } });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Invariant Test", commissionType: "Percentage" as never,
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
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociate: mine } } });
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

describe("invariant: a transaction has invoices OR installment-schedule rows, never both", () => {
  it("a Full Payment sale gets invoices and no installment plan", async () => {
    const tx = await closedSale("Full Payment");
    const invoiceCount = await prisma.invoice.count({ where: { transactionId: tx.id } });
    const scheduleCount = await prisma.installmentSchedule.count({ where: { plan: { transactionId: tx.id } } });
    expect(invoiceCount).toBeGreaterThan(0);
    expect(scheduleCount).toBe(0);
  });

  it("an Installment sale gets schedule rows and no invoices", async () => {
    const tx = await closedSale("Installment");
    const invoiceCount = await prisma.invoice.count({ where: { transactionId: tx.id } });
    const scheduleCount = await prisma.installmentSchedule.count({ where: { plan: { transactionId: tx.id } } });
    expect(invoiceCount).toBe(0);
    expect(scheduleCount).toBeGreaterThan(0);
  });
});
