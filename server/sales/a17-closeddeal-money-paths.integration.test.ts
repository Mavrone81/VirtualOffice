// A-17 precondition 2.5 (reviews/a17-flag-on-preconditions.md §2.5).
//
// Fixing B1 pinned 15 pre-existing fixture-only tests to flag-OFF (correct,
// and NOT touched here — see the doc for the full list). That pin closed
// the ONLY thing that had ever exercised the commission engine, a payout
// run, a real split-approval action, or the dashboard's own read path
// against a flow=ClosedDeal row.
//
// FRAMING (AD, after the first version of this file): this is
// CHARACTERIZATION, not branch coverage. `runCommissionTx`, `runPayouts`'s
// `buildCatchupPlan`, the real split-approval actions, and `dashboardMetrics`
// read NOTHING flow-specific at all — confirmed directly: `grep -rn
// "SubmissionFlow|\.flow\b" server/commission server/payouts
// server/dashboard` returns nothing outside tests. That means the risk
// isn't a wrong branch on ClosedDeal — it's that these four systems were
// ONLY EVER exercised against Legacy-shaped data (a row built by
// `closeSale`), and nothing establishes they produce the SAME money outcome
// for a row built by `verifySale` instead. So every case below builds the
// identical sale twice — once Legacy (closeSale), once ClosedDeal
// (verifySale) — and asserts the ledger lines, payout amount and dashboard
// figures are byte-for-byte the same. A difference would mean the flip
// changes money behaviour, which is the actual thing nobody has checked;
// per AD's instruction this is reported as a finding, not adjusted to pass.
//
// WHAT EACH CASE CATCHES THAT THE EXISTING SUITE DOES NOT: all 15 pinned
// files are flag-OFF by construction and never produce a ClosedDeal row, so
// NONE of them would notice if a future change (e.g. a flow filter added by
// habit while building the "frozen snapshot" ClosedDeal path
// `runCommissionTx`'s own comment anticipates) silently diverged ClosedDeal
// money outcomes from Legacy's. These four are the only tests in the repo
// that would.
//
// Real throwaway Postgres; fake data only, all tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { fakePdfFile } from "@/lib/test-fixtures";

const TAG = "A17CDMONEY-";
const SALE_DATE = "2099-07-10";
const MONTH = "2099-07";
const ADMIN = { user: { associateId: null, id: "77777777-7777-7777-7777-777777777777", role: "Admin" } };

let companyId = "", productId = "", closerLegacyId = "", closerCdId = "";

// Two separately-flagged imports of the SAME module — submitSale/closeSale/
// approveQuotation under flag-OFF (the Legacy control), submitSale/verifySale
// under flag-ON (the ClosedDeal case). approveSubmissionSplit/adminApproveSplit
// are flow-agnostic (neither reads sub.flow), so one handle serves both.
let submitSaleLegacy: (input: unknown) => Promise<{ ok: boolean; id?: string }>;
let closeSaleLegacy: (id: string) => Promise<{ ok: boolean; error?: string }>;
let approveQuotationLegacy: (id: string) => Promise<{ ok: boolean; error?: string }>;
let submitSaleCd: (input: unknown) => Promise<{ ok: boolean; id?: string }>;
let verifySaleCd: (id: string, seenContentVersion: number) => Promise<{ ok: boolean; error?: string; transactionId?: string }>;
let approveSubmissionSplit: (id: string) => Promise<{ ok: boolean; error?: string }>;
let adminApproveSplit: (id: string) => Promise<{ ok: boolean; error?: string }>;

// These three modules read neither the flag nor SubmissionFlow — confirmed
// by the grep above — so one normal (non-reset) import serves every case.
let runCommission: (transactionId: string, actorUserId: string | null) => Promise<number>;
let runPayouts: (month: string) => Promise<{ ok: true; count: number; blockedAssociateIds: string[] } | { ok: false; code: string; error: string }>;
let markInvoicePaid: (invoiceId: string, ackFile: File, payment?: { method: string; reference?: string }) => Promise<{ ok: boolean; error?: string }>;
let dashboardMetrics: (scopeIds: string[] | null) => Promise<{ totalTransactionValue: unknown; grossTransacted: unknown; grossReceived: unknown }>;

beforeAll(async () => {
  delete process.env.A17_CLOSED_DEAL_FLOW;
  vi.resetModules();
  const legacy = (await import("./actions")) as never as Record<string, (...a: never[]) => unknown>;
  submitSaleLegacy = legacy.submitSale as never;
  closeSaleLegacy = legacy.closeSale as never;
  approveQuotationLegacy = legacy.approveQuotation as never;

  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  const cd = (await import("./actions")) as never as Record<string, (...a: never[]) => unknown>;
  submitSaleCd = cd.submitSale as never;
  verifySaleCd = cd.verifySale as never;
  approveSubmissionSplit = cd.approveSubmissionSplit as never;
  adminApproveSplit = cd.adminApproveSplit as never;

  ({ runCommission } = (await import("@/server/commission/run")) as never);
  ({ runPayouts } = (await import("@/server/payouts/actions")) as never);
  ({ markInvoicePaid } = (await import("@/server/invoices/actions")) as never);
  ({ dashboardMetrics } = (await import("@/server/dashboard/metrics")) as never);

  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "PLN", productName: "Plain", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
    },
    select: { id: true },
  })).id;
  closerLegacyId = (await prisma.associate.create({
    data: { associateCode: TAG + "LCL", fullName: "LegacyCloser", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  closerCdId = (await prisma.associate.create({
    data: { associateCode: TAG + "CCL", fullName: "ClosedDealCloser", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  delete process.env.A17_CLOSED_DEAL_FLOW;
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: { in: [closerLegacyId, closerCdId] } }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  const txs = await prisma.salesTransaction.findMany({ where: { submissionId: { in: subIds } }, select: { id: true } });
  const txIds = txs.map((t) => t.id);
  await prisma.commissionLedger.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.invoice.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: { in: [closerLegacyId, closerCdId] } } });
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.associate.deleteMany({ where: { id: { in: [closerLegacyId, closerCdId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

afterEach(() => {
  who.session = null;
});

/** Legacy control: submit → split-approve → approveQuotation → closeSale. */
async function mintLegacySale(amount: number, clientName: string) {
  who.session = { user: { associateId: closerLegacyId, id: closerLegacyId } };
  const submitted = await submitSaleLegacy({
    salesDate: SALE_DATE, clientName, paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: amount, comCodeIds: [] }],
  });
  expect(submitted.ok).toBe(true);
  const subId = submitted.id!;
  const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { flow: true } });
  expect(sub.flow).toBe("Legacy");

  who.session = ADMIN;
  expect((await approveSubmissionSplit(subId)).ok).toBe(true);
  expect((await adminApproveSplit(subId)).ok).toBe(true);
  expect((await approveQuotationLegacy(subId)).ok).toBe(true);
  await prisma.submissionDocument.create({ data: { submissionId: subId, kind: "Signed" as never, fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
  const closed = await closeSaleLegacy(subId);
  expect(closed.ok).toBe(true);

  const txId = (await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: subId }, select: { id: true } })).id;
  return { subId, txId };
}

/** ClosedDeal case: submit (flag ON) → split-approve → verifySale (NOT closeSale — B1 refuses it). */
async function mintClosedDealSale(amount: number, clientName: string) {
  who.session = { user: { associateId: closerCdId, id: closerCdId } };
  const submitted = await submitSaleCd({
    salesDate: SALE_DATE, clientName, paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: amount, comCodeIds: [] }],
  });
  expect(submitted.ok).toBe(true);
  const subId = submitted.id!;
  const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { flow: true } });
  expect(sub.flow).toBe("ClosedDeal");

  who.session = ADMIN;
  const sdApproval = await approveSubmissionSplit(subId);
  const adminApproval = await adminApproveSplit(subId);
  const verified = await verifySaleCd(subId, 0);
  expect(verified.ok).toBe(true);

  return { subId, txId: verified.transactionId!, sdApproval, adminApproval };
}

/** Ledger lines in a stable, comparable shape (own id/transactionId/timestamps stripped). */
async function ledgerShape(transactionId: string) {
  const rows = await prisma.commissionLedger.findMany({ where: { transactionId }, orderBy: [{ associateId: "asc" }, { lineType: "asc" }] });
  return rows.map((l) => ({ designation: l.designation, lineType: l.lineType, comCode: l.comCode, basisAmount: l.basisAmount.toFixed(2), rateOrValue: l.rateOrValue?.toFixed(4) ?? null, amount: l.amount.toFixed(2), status: l.status }));
}

describe("A-17 precondition 2.5 — ClosedDeal money outcomes, characterised against Legacy (flag genuinely ON for the ClosedDeal half)", () => {
  it("AREA 1 — split approval: the real approveSubmissionSplit/adminApproveSplit actions succeed identically against a flow=ClosedDeal submission", async () => {
    const { sdApproval, adminApproval } = await mintClosedDealSale(1200, "Split Approval Client");
    expect(sdApproval).toEqual({ ok: true });
    expect(adminApproval).toEqual({ ok: true });
  });

  it("AREA 2 — commission recompute: a ClosedDeal-originated transaction produces the SAME ledger shape as the identical Legacy sale, and a recompute reproduces it", async () => {
    const legacy = await mintLegacySale(1500, "Commission Compare Client (Legacy)");
    const cd = await mintClosedDealSale(1500, "Commission Compare Client (ClosedDeal)");

    // Legacy's ledger is only built by an explicit recompute (closeSale alone
    // doesn't run the engine); ClosedDeal's is built inline by verifySale.
    // Run it explicitly on both so the comparison is of the SAME operation.
    await runCommission(legacy.txId, ADMIN.user.id);
    const legacyShape = await ledgerShape(legacy.txId);
    expect(legacyShape.length).toBeGreaterThan(0);

    const cdShapeBefore = await ledgerShape(cd.txId);
    await runCommission(cd.txId, ADMIN.user.id); // the recompute case: run again, after the inline run
    const cdShapeAfter = await ledgerShape(cd.txId);

    expect(cdShapeAfter).toEqual(cdShapeBefore); // recompute is idempotent on an unchanged transaction
    expect(cdShapeAfter).toEqual(legacyShape); // AND matches what the identical Legacy sale produces
  });

  it("AREA 3 — payout run: runPayouts creates the SAME payout amount for a ClosedDeal transaction as for the identical Legacy one", async () => {
    const legacy = await mintLegacySale(1800, "Payout Compare Client (Legacy)");
    const cd = await mintClosedDealSale(1800, "Payout Compare Client (ClosedDeal)");

    await runCommission(legacy.txId, ADMIN.user.id); // Legacy needs the explicit run; ClosedDeal already has one inline
    who.session = ADMIN;
    const legacyInvoice = await prisma.invoice.findFirstOrThrow({ where: { transactionId: legacy.txId } });
    const cdInvoice = await prisma.invoice.findFirstOrThrow({ where: { transactionId: cd.txId } });
    expect((await markInvoicePaid(legacyInvoice.id, fakePdfFile(), { method: "Bank", reference: TAG + "legacy" })).ok).toBe(true);
    expect((await markInvoicePaid(cdInvoice.id, fakePdfFile(), { method: "Bank", reference: TAG + "cd" })).ok).toBe(true);

    const result = await runPayouts(MONTH);
    expect(result.ok).toBe(true);

    const legacyPayout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: closerLegacyId, payoutMonth: MONTH } });
    const cdPayout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: closerCdId, payoutMonth: MONTH } });
    expect(cdPayout.totalPayable.toFixed(2)).toBe(legacyPayout.totalPayable.toFixed(2));
  });

  it("AREA 4 — dashboard read path: dashboardMetrics reports the SAME figures for a ClosedDeal closer as for the identical Legacy closer", async () => {
    // Own, fresh closer pair — the shared closerLegacyId/closerCdId already
    // carry AREAS 2/3's transactions by this point in the file, and
    // dashboardMetrics aggregates a closer's WHOLE history, not one sale.
    const dashLegacyId = (await prisma.associate.create({
      data: { associateCode: TAG + "DLCL", fullName: "DashLegacyCloser", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
      select: { id: true },
    })).id;
    const dashCdId = (await prisma.associate.create({
      data: { associateCode: TAG + "DCCL", fullName: "DashClosedDealCloser", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
      select: { id: true },
    })).id;
    try {
      who.session = { user: { associateId: dashLegacyId, id: dashLegacyId } };
      const legacySubmitted = await submitSaleLegacy({ salesDate: SALE_DATE, clientName: "Dashboard Compare Client (Legacy)", paymentPlan: "Full Payment", lines: [{ productId, lineSaleAmount: 2000, comCodeIds: [] }] });
      expect(legacySubmitted.ok).toBe(true);
      who.session = ADMIN;
      expect((await approveSubmissionSplit(legacySubmitted.id!)).ok).toBe(true);
      expect((await adminApproveSplit(legacySubmitted.id!)).ok).toBe(true);
      expect((await approveQuotationLegacy(legacySubmitted.id!)).ok).toBe(true);
      await prisma.submissionDocument.create({ data: { submissionId: legacySubmitted.id!, kind: "Signed" as never, fileKey: TAG + "dash-signed.pdf", fileName: "dash-signed.pdf" } });
      expect((await closeSaleLegacy(legacySubmitted.id!)).ok).toBe(true);
      const legacyTxId = (await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: legacySubmitted.id! }, select: { id: true } })).id;
      await runCommission(legacyTxId, ADMIN.user.id);

      who.session = { user: { associateId: dashCdId, id: dashCdId } };
      const cdSubmitted = await submitSaleCd({ salesDate: SALE_DATE, clientName: "Dashboard Compare Client (ClosedDeal)", paymentPlan: "Full Payment", lines: [{ productId, lineSaleAmount: 2000, comCodeIds: [] }] });
      expect(cdSubmitted.ok).toBe(true);
      who.session = ADMIN;
      expect((await approveSubmissionSplit(cdSubmitted.id!)).ok).toBe(true);
      expect((await adminApproveSplit(cdSubmitted.id!)).ok).toBe(true);
      expect((await verifySaleCd(cdSubmitted.id!, 0)).ok).toBe(true);

      const legacyMetrics = await dashboardMetrics([dashLegacyId]);
      const cdMetrics = await dashboardMetrics([dashCdId]);

      expect(Number(cdMetrics.totalTransactionValue)).toBe(Number(legacyMetrics.totalTransactionValue));
      expect(Number(cdMetrics.grossTransacted)).toBe(Number(legacyMetrics.grossTransacted));
      expect(Number(cdMetrics.totalTransactionValue)).toBe(2000); // and both match the real, known input — not just each other
    } finally {
      const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: { in: [dashLegacyId, dashCdId] } }, select: { id: true } });
      const subIds = subs.map((s) => s.id);
      const txs = await prisma.salesTransaction.findMany({ where: { submissionId: { in: subIds } }, select: { id: true } });
      const txIds = txs.map((t) => t.id);
      await prisma.commissionLedger.deleteMany({ where: { transactionId: { in: txIds } } });
      await prisma.invoice.deleteMany({ where: { transactionId: { in: txIds } } });
      await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.salesTransaction.deleteMany({ where: { id: { in: txIds } } });
      await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
      await prisma.associate.deleteMany({ where: { id: { in: [dashLegacyId, dashCdId] } } });
    }
  });
});
