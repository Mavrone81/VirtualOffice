// lib/schemas.ts allows an Installment plan with as few as 1 real
// installment, but eligibility.ts required a flat `paidCount >= threshold`
// (default 3) with no relation to how many real installments the plan
// actually has. A 1- or 2-instalment sale could therefore never reach the
// threshold: fully collected, commission stuck at PendingCollection forever,
// no error anywhere. Fix: cap the effective threshold at the plan's own
// real-installment count, but require at least one real installment (an
// empty schedule must never trivially satisfy min(threshold, 0) = 0). Needs
// a local PG (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { CommissionEligibility, LedgerStatus } from "@prisma/client";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { recomputeEligibility } from "./eligibility";

const TAG = "ELIGCAP-";
const SALE_DATE = "2098-06-10";
const ADMIN = { user: { associateId: null, id: "22222222-2222-2222-2222-222222222222", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

async function mkSaleTransaction(code: string, installmentCount: number, deposit = 0) {
  who.session = { user: { associateId: closerId, id: "sess-" + code } };
  const submitted = await submitSale({
    salesDate: SALE_DATE,
    clientName: TAG + code,
    paymentPlan: "Installment",
    installmentCount,
    deposit,
    lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
  } as never);
  expect(submitted.ok).toBe(true);
  const sub = await prisma.salesSubmission.findFirstOrThrow({
    where: { closingAssociateId: closerId, clientName: TAG + code },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  who.session = ADMIN;
  expect((await approveSubmissionSplit(sub.id)).ok).toBe(true);
  expect((await adminApproveSplit(sub.id)).ok).toBe(true);
  expect((await approveQuotation(sub.id)).ok).toBe(true);
  await prisma.submissionDocument.create({ data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + code + "-signed.pdf", fileName: "signed.pdf" } });
  expect((await closeSale(sub.id)).ok).toBe(true);
  return prisma.salesTransaction.findFirstOrThrow({
    where: { submissionId: sub.id },
    include: { installmentPlan: { include: { schedule: true } } },
  });
}

async function markPaid(scheduleId: string) {
  await prisma.installmentSchedule.update({ where: { id: scheduleId }, data: { paid: true, paidDate: new Date() } });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Eligibility Cap Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "0", sdOverridePct: "0",
      defaultCompanyId: companyId, effectiveDate: new Date(SALE_DATE),
    },
    select: { id: true },
  })).id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2098-01-01"),
      rateSnapshot: {
        commissionType: "Percentage", closingCommPct: "10", closingCommFixed: null,
        companyCutPct: "2", smOverridePct: "0", sdOverridePct: "0",
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
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transaction: { closingAssociate: mine } } } });
  await prisma.installmentPlan.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.submissionDocument.deleteMany({ where: { fileKey: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: mine });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

describe("recomputeEligibility: threshold capped at the plan's real-installment count", () => {
  it("a 2-instalment plan becomes Eligible once both are paid, even though the default threshold is 3", async () => {
    const tx = await mkSaleTransaction("TWO-BOTH", 2);
    for (const s of tx.installmentPlan!.schedule) await markPaid(s.id);

    const result = await recomputeEligibility(tx.id);
    expect(result).toBe(CommissionEligibility.Eligible);
    const fresh = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(fresh.commissionEligibility).toBe(CommissionEligibility.Eligible);
  });

  it("a 2-instalment plan with only 1 paid stays PendingCollection", async () => {
    const tx = await mkSaleTransaction("TWO-ONE", 2);
    const [first] = tx.installmentPlan!.schedule.sort((a, b) => a.sequence - b.sequence);
    await markPaid(first.id);

    const result = await recomputeEligibility(tx.id);
    expect(result).toBe(CommissionEligibility.PendingCollection);
  });

  it("REGRESSION GUARD: an Installment sale with an empty schedule never flips to Eligible (min(threshold, 0) must not equal 0-paid)", async () => {
    const tx = await mkSaleTransaction("EMPTY", 1);
    // Simulate the degenerate shape the fix must reject: no real installments
    // at all (e.g. a legacy/corrupted plan) — never producible through the UI,
    // which is exactly why a naive `Math.min(threshold, realInstalments.length)`
    // with no "at least one" guard is dangerous: min(3, 0) = 0 and 0 >= 0.
    await prisma.installmentSchedule.deleteMany({ where: { planId: tx.installmentPlan!.id } });

    const result = await recomputeEligibility(tx.id);
    expect(result).toBe(CommissionEligibility.PendingCollection);
    const fresh = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(fresh.commissionEligibility).toBe(CommissionEligibility.PendingCollection);
  });

  it("existing behaviour unchanged: a 5-instalment plan needs exactly the threshold (3) paid, not fewer", async () => {
    const tx = await mkSaleTransaction("FIVE", 5);
    const sorted = tx.installmentPlan!.schedule.filter((s) => s.sequence > 0).sort((a, b) => a.sequence - b.sequence);
    expect(sorted.length).toBe(5);
    for (const s of sorted.slice(0, 3)) await markPaid(s.id);

    const result = await recomputeEligibility(tx.id);
    expect(result).toBe(CommissionEligibility.Eligible);

    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.status === LedgerStatus.Eligible)).toBe(true);
  });

  it("only the deposit (sequence 0) paid stays PendingCollection — the deposit is the entry fee, not a real installment", async () => {
    const tx = await mkSaleTransaction("DEPOSIT-ONLY", 3, 1000);
    const deposit = tx.installmentPlan!.schedule.find((s) => s.sequence === 0);
    expect(deposit).toBeTruthy();
    await markPaid(deposit!.id);

    const result = await recomputeEligibility(tx.id);
    expect(result).toBe(CommissionEligibility.PendingCollection);

    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.status === LedgerStatus.Pending)).toBe(true);
  });
});
