// C1 (DevSecOps M5 review) — runCommission racing a payout approval must not pay the
// same commission twice. Adapted from DevSecOps' probe
// (reviews/m5-probe-runcommission-race.integration.test.ts): an approval of the
// closer's Pending payout is started on another pooled connection right after
// runCommission's ledger read. Before the fix (read-committed, no row locks) the
// approval commits inside the window and the full commission is re-written as new
// lines -> Approved 800 + Adjustment 800. With the locks the approval waits for
// runCommission to commit, then its CAS re-checks the (now changed) total.
// The approval is not awaited inside the transaction (that would deadlock against the
// lock): it gets APPROVAL_WINDOW_MS to commit, which it does unless it is blocked.
// Needs a local PG (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { runPayouts, setPayoutStatus } from "@/server/payouts/actions";
import { runCommission } from "./run";

const TAG = "C1RACE-";
const APPROVAL_WINDOW_MS = 300;
const SALE_DATE = "2098-05-10";
const MONTH = "2098-05";
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
      productCode: TAG + "P1", productId, effectiveDate: new Date("2098-01-01"),
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
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.bankFileBatch.deleteMany({ where: { payoutMonth: MONTH, payouts: { none: {} } } });
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


describe("C1: runCommission vs a concurrent payout approval", () => {
  it("approval landing between runCommission's read and its delete", async () => {
    await paidSale(10000);
    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const p = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: closerId, payoutMonth: MONTH, seq: 0 } });
    const before = p.totalPayable.toFixed(2);
    const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { closingAssociateId: closerId } });

    // Interleave: let runCommission read the ledger, then commit an approval of P on
    // another pooled connection, then let runCommission continue.
    let approval: Promise<{ ok: boolean; error?: string }> = Promise.resolve({ ok: false });
    let approvalState = "not-fired";
    const orig = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (db: any) => Promise<unknown>, opts?: unknown) =>
      orig(async (db: any) => {
        const real = db.commissionLedger.findMany.bind(db.commissionLedger);
        let fired = false;
        const wrapped = new Proxy(db.commissionLedger, { get(t, k) {
          if (k === "findMany") return async (...a: unknown[]) => { const r = await real(...a);
            if (!fired) {
              fired = true; who.session = ADMIN;
              approval = setPayoutStatus(p.id, "Approved");
              approvalState = await Promise.race([approval.then(() => "committed-in-window"), sleep(APPROVAL_WINDOW_MS).then(() => "blocked")]);
            }
            return r; };
          return (t as any)[k]; } });
        const dbProxy = new Proxy(db, { get(t, k) { return k === "commissionLedger" ? wrapped : (t as any)[k]; } });
        return fn(dbProxy);
      }, opts)) as never);
    await runCommission(tx.id);
    spy.mockRestore();
    const approvalResult = await approval;
    console.log("interleaved approval:", approvalState, JSON.stringify(approvalResult));

    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id, associateId: closerId }, select: { amount: true, payoutId: true, status: true } });
    const approved = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: p.id } });
    console.log("payout P:", approved.payoutStatus, approved.totalPayable.toFixed(2), "(was", before + ")");
    console.log("closer ledger lines for the txn:", JSON.stringify(lines.map((l) => ({ amt: l.amount.toFixed(2), inP: l.payoutId === p.id, attached: !!l.payoutId, st: l.status }))));
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const all = await prisma.monthlyPayout.findMany({ where: { associateId: closerId, payoutMonth: MONTH }, orderBy: { seq: "asc" } });
    console.log("closer payouts for the month:", JSON.stringify(all.map((x) => ({ seq: x.seq, kind: x.kind, st: x.payoutStatus, total: x.totalPayable.toFixed(2) }))));
    const totalOwed = all.reduce((s, x) => s + Number(x.totalPayable), 0);
    console.log("TOTAL across payouts:", totalOwed.toFixed(2), " expected (one sale):", before);
    expect(totalOwed.toFixed(2)).toBe(before);
    // With the fix the approval had to wait, and a payout is never approved at <= 0.
    expect(approvalState).toBe("blocked");
    expect(all.every((x) => x.payoutStatus === "Pending" || Number(x.totalPayable) > 0)).toBe(true);
  });
});
