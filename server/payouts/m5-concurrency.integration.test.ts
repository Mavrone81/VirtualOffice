// M5 — two runPayouts racing for the same month on a real Postgres (separate pooled
// connections, so the two per-associate transactions genuinely interleave). The
// interleaving is not deterministic, so each round asserts invariants that must
// hold whichever run wins, then a sequential retry settles anything left over.
// Rounds cover: creating the regular payouts, joining Pending payouts, and
// creating Adjustment payouts after a payout was Approved and Paid.
// Needs a local PG (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { runPayouts, setPayoutStatus } from "./actions";

const TAG = "M5RACE-";
const SALE_DATE = "2099-06-10";
const MONTH = "2099-06";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";
const assocIds: string[] = [];

async function mkAssoc(code: string, designation: string, direct: string | null, second: string | null) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      directUplineId: direct, secondUplineId: second,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
    },
    select: { id: true },
  });
  assocIds.push(a.id);
  return a.id;
}

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
  expect((await approveSubmissionSplit(sub.id)).ok).toBe(true);
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

/** Invariants that must hold after any interleaving (plus a settling retry). */
async function checkInvariants(paidTotals: Map<string, string>) {
  const lines = await prisma.commissionLedger.findMany({
    where: { associateId: { in: assocIds }, payoutMonth: MONTH, status: "Eligible" },
    select: { id: true, associateId: true, payoutId: true, amount: true },
  });
  // Every eligible line is settled by exactly one payout (payoutId is a single FK).
  expect(lines.filter((l) => l.payoutId === null)).toEqual([]);

  const payouts = await prisma.monthlyPayout.findMany({ where: { associateId: { in: assocIds }, payoutMonth: MONTH } });
  for (const p of payouts) {
    // Each payout's total equals the lines attached to it.
    const mine = lines.filter((l) => l.payoutId === p.id).reduce((s, l) => s + Number(l.amount), 0);
    expect(Number(p.totalPayable)).toBeCloseTo(mine, 2);
    // Paid payouts never move.
    if (paidTotals.has(p.id)) expect(p.totalPayable.toFixed(2)).toBe(paidTotals.get(p.id));
  }
  // At most one Pending payout per associate for the month; seqs are contiguous from 0.
  for (const a of assocIds) {
    const mine = payouts.filter((p) => p.associateId === a).sort((x, y) => x.seq - y.seq);
    expect(mine.filter((p) => p.payoutStatus === "Pending").length).toBeLessThanOrEqual(1);
    expect(mine.map((p) => p.seq)).toEqual(mine.map((_, i) => i));
  }
}

async function race() {
  who.session = ADMIN;
  const results = await Promise.allSettled([runPayouts(MONTH), runPayouts(MONTH)]);
  // Never a crash: each run either succeeds or reports a clean conflict.
  for (const r of results) {
    expect(r.status).toBe("fulfilled");
    const v = (r as PromiseFulfilledResult<{ ok: boolean; error?: string }>).value;
    expect(v.ok || v.error === "payoutRunConflict").toBe(true);
  }
  const outcome = results.map((r) => {
    const v = (r as PromiseFulfilledResult<{ ok: boolean; count?: number; error?: string }>).value;
    return v.ok ? `ok(${v.count})` : v.error;
  });
  // A retry after a conflict settles whatever the losing run left over.
  expect((await runPayouts(MONTH)).ok).toBe(true);
  return outcome;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true },
  })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Race Test", commissionType: "Percentage" as never,
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
  const sdId = await mkAssoc("SD", "SalesDirector", null, null);
  const smId = await mkAssoc("SM", "SalesManager", sdId, null);
  closerId = await mkAssoc("CL", "SalesAssociate", smId, sdId);
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

describe("M5: two runPayouts racing on the same month (real Postgres)", () => {
  it("keeps every invariant across create, join-Pending and adjustment rounds", async () => {
    const paidTotals = new Map<string, string>();
    const outcomes: string[][] = [];

    // Rounds 1–3: first run creates the regular payouts; later rounds join them.
    for (let round = 0; round < 3; round++) {
      await paidSale(10000 + round * 1000);
      outcomes.push(await race());
      await checkInvariants(paidTotals);
    }

    // The closer's payout is approved and paid; the next rounds must create
    // Adjustment payouts and never touch it.
    const regular = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: closerId, payoutMonth: MONTH, seq: 0 } });
    who.session = ADMIN;
    expect((await setPayoutStatus(regular.id, "Approved")).ok).toBe(true);
    expect((await setPayoutStatus(regular.id, "Paid")).ok).toBe(true);
    paidTotals.set(regular.id, (await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: regular.id } })).totalPayable.toFixed(2));

    for (let round = 0; round < 3; round++) {
      await paidSale(5000 + round * 500);
      outcomes.push(await race());
      await checkInvariants(paidTotals);
    }

    const closer = await prisma.monthlyPayout.findMany({ where: { associateId: closerId, payoutMonth: MONTH }, orderBy: { seq: "asc" } });
    expect(closer.map((p) => [p.seq, p.kind, p.payoutStatus])).toEqual([[0, "Regular", "Paid"], [1, "Adjustment", "Pending"]]);
    // Evidence for the review: which interleavings this run actually hit.
    console.info("race outcomes per round:", JSON.stringify(outcomes));
  }, 60_000);
});
