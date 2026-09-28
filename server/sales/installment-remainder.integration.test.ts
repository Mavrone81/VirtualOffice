// A-0b — the installment schedule's dueAmounts must sum EXACTLY to
// (sale − deposit); rounding leftover goes on the last installment, not lost.
// Real throwaway Postgres (needs DATABASE_URL); fake data only, cleaned up.
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

const TAG = "A0BREM-";
const SALE_DATE = "2099-08-10";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

async function closedInstallmentSale(saleAmount: number, deposit: number, installmentCount: number) {
  who.session = { user: { associateId: closerId, id: "sess-closer" } };
  expect((await submitSale({
    salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Installment",
    deposit, installmentCount,
    lines: [{ productId, lineSaleAmount: saleAmount, comCodeIds: [] }],
  } as never)).ok).toBe(true);
  const sub = await prisma.salesSubmission.findFirstOrThrow({ where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true } });

  who.session = ADMIN;
  expect((await approveSubmissionSplit(sub.id)).ok).toBe(true);
  expect((await adminApproveSplit(sub.id)).ok).toBe(true);
  expect((await approveQuotation(sub.id)).ok).toBe(true);
  await prisma.submissionDocument.create({ data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
  expect((await closeSale(sub.id)).ok).toBe(true);

  const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub.id } });
  return prisma.installmentSchedule.findMany({ where: { plan: { transactionId: tx.id } }, orderBy: { sequence: "asc" } });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Remainder Test", commissionType: "Percentage" as never,
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

describe("closeSale installment schedule — exact reconciliation", () => {
  it("10,000 / 12 sums to exactly 10,000 (the literal acceptance case)", async () => {
    const rows = await closedInstallmentSale(10000, 0, 12);
    expect(rows).toHaveLength(12);
    const total = rows.reduce((s, r) => s + Number(r.dueAmount), 0);
    expect(total).toBeCloseTo(10000, 10);
    expect(rows[11].dueAmount.toFixed(2)).toBe((10000 - Number(rows[0].dueAmount) * 11).toFixed(2));
  });

  it("a division that doesn't round evenly still sums exactly, remainder on the last", async () => {
    // 100 / 3 = 33.33 recurring → naive rows would total 99.99, 1¢ short.
    const rows = await closedInstallmentSale(100, 0, 3);
    expect(rows.map((r) => r.dueAmount.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    const total = rows.reduce((s, r) => s.add(r.dueAmount), rows[0].dueAmount.sub(rows[0].dueAmount));
    expect(total.toFixed(2)).toBe("100.00");
  });

  it("a deposit is excluded before dividing the installments, but is its own schedule row (sequence 0)", async () => {
    const rows = await closedInstallmentSale(1000, 250, 4);
    // Deposit row (Samuel, Q9): sequence 0, separate from the 4 installments.
    const deposit = rows.find((r) => r.sequence === 0)!;
    expect(deposit.dueAmount.toFixed(2)).toBe("250.00");
    const installmentsTotal = rows.filter((r) => r.sequence > 0).reduce((s, r) => s + Number(r.dueAmount), 0);
    expect(installmentsTotal).toBeCloseTo(750, 10); // (1000 − 250), independent of the deposit row
    const grandTotal = rows.reduce((s, r) => s + Number(r.dueAmount), 0);
    expect(grandTotal).toBeCloseTo(1000, 10); // deposit + installments = the full sale
  });
});
