// M5 runtime confirmation (T1(L)-DevLead, 2026-09-25): re-running runPayouts for a
// month must not rewrite a payout that is already Approved/Paid. On 0f89098 the
// upsert in runPayouts updates totals regardless of payoutStatus, so a late
// Eligible line (second invoice paid in the same payout month) silently changes
// the amount on a payout that has already been paid out. Needs a local PG
// (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { runPayouts, setPayoutStatus } from "./actions";

const TAG = "M5RERUN-";
const SALE_DATE = "2099-03-10";
const MONTH = "2099-03";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", sdId = "", smId = "", closerId = "";

async function mkAssoc(code: string, designation: string, direct: string | null, second: string | null) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      directUplineId: direct, secondUplineId: second,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
    },
    select: { id: true },
  });
  return a.id;
}

/** Submit → approve → close → mark the invoice Paid: leaves Eligible ledger lines in MONTH. */
async function paidSale(amount: number) {
  who.session = { user: { associateId: closerId, id: "sess-closer" } };
  expect((await submitSale({
    salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: amount, comCodeIds: [] }],
  } as never)).ok).toBe(true);
  const sub = await prisma.salesSubmission.findFirstOrThrow({
    where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
  });
  who.session = ADMIN;
  expect((await approveSubmissionSplit(sub.id)).ok).toBe(true); // closure needs flow A signed off
  expect((await adminApproveSplit(sub.id)).ok).toBe(true);
  expect((await approveQuotation(sub.id)).ok).toBe(true);
  await prisma.submissionDocument.create({
    data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" },
  });
  expect((await closeSale(sub.id)).ok).toBe(true);
  const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub.id } });
  const inv = await prisma.invoice.findFirstOrThrow({ where: { transactionId: tx.id } });
  expect((await markInvoicePaid(inv.id, { method: "Bank", reference: TAG + amount })).ok).toBe(true);
}

beforeAll(async () => {
  companyId = (await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true },
  })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "M5 Test", commissionType: "Percentage" as never,
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
  sdId = await mkAssoc("SD", "SalesDirector", null, null);
  smId = await mkAssoc("SM", "SalesManager", sdId, null);
  closerId = await mkAssoc("CL", "SalesAssociate", smId, sdId);
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
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

describe("M5: runPayouts re-run vs an already-Paid payout", () => {
  it("does not change the amounts on a payout that is already Paid", async () => {
    await paidSale(10000); // closer net 800
    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const p = await prisma.monthlyPayout.findUniqueOrThrow({
      where: { associateId_payoutMonth: { associateId: closerId, payoutMonth: MONTH } },
    });
    expect(Number(p.totalPayable)).toBeCloseTo(800, 2);
    expect((await setPayoutStatus(p.id, "Approved")).ok).toBe(true);
    expect((await setPayoutStatus(p.id, "Paid")).ok).toBe(true);

    // A second invoice for the same payout month is paid after the payout went out,
    // and accounts re-run the month.
    await paidSale(5000); // closer net +400
    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);

    const after = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.payoutStatus).toBe("Paid");
    // Expected: the paid record is immutable (late lines belong in a new/adjustment payout).
    expect(Number(after.totalPayable)).toBeCloseTo(800, 2);
    expect(Number(after.personalCommission)).toBeCloseTo(Number(p.personalCommission), 2);
  });

  it("audit for a re-run records per-payout before/after amounts", () => {
    // The only audit entry runPayouts writes is { month, count }; no before/after
    // per payout, so an overwrite of a Paid payout is not reconstructable from the trail.
    const runs = vi.mocked(logAudit).mock.calls.filter(([a]) => a.action === "payouts.run");
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every(([a]) => a.before !== undefined)).toBe(true);
  });
});
