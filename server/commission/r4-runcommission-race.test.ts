// R-4 (reviews/m5-architect-review.md; reviews/m5-cf-design.md §7): runCommission reads the
// transaction (and so its eligibility) through the global client BEFORE taking M5's C1 lock.
// A concurrent recompute can race past a committed write: A reads not-eligible (unlocked),
// B marks the invoice paid and commits Eligible lines, then A takes the (now-free) lock and
// rewrites those lines back to not-eligible. Needs a local PG (DATABASE_URL); fake data only,
// all rows tagged and cleaned up.
//
// The barrier below intercepts runCommission's own top-of-function read (matched by its
// distinctive `include` shape) and, while that call is suspended, runs the concurrent
// mark-invoice-paid chain to completion — deterministically reproducing the race on
// unfixed code. On the fixed code that read moves onto the transaction's own client, so
// the spy is never invoked for it; a short fallback then runs the same concurrent chain so
// the test still exercises two real overlapping calls (asserted correct via Postgres's own
// row lock either way). Either way, "B" runs exactly once and the assertions are the same.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { CommissionEligibility, LedgerStatus } from "@prisma/client";

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
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { fakePdfFile } from "@/lib/test-fixtures";
import { runCommission } from "./run";

const TAG = "R4RACE-";
const SALE_DATE = "2098-05-10";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

async function mkAssoc(code: string, designation: string) {
  const a = await prisma.associate.create({
    data: { associateCode: TAG + code, fullName: code, designation: designation as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  });
  return a.id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "R4 Test", commissionType: "Percentage" as never,
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
  closerId = await mkAssoc("CL", "SalesAssociate");
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
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

describe("R-4: runCommission stale-read race", () => {
  it("a concurrent mark-paid must not be rewritten back to not-eligible by a racing recompute", async () => {
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
    const inv = await prisma.invoice.findFirstOrThrow({ where: { transactionId: tx.id } });
    // Invoice is still Outstanding here: closeSale leaves commissionEligibility at its
    // schema default (Ineligible) and books Pending lines.

    let hookFired = false;
    let bStarted: Promise<unknown> | null = null;
    const runBOnce = () => {
      if (!bStarted) {
        who.session = ADMIN;
        bStarted = markInvoicePaid(inv.id, fakePdfFile(), { method: "Bank", reference: TAG + "pay" });
      }
      return bStarted;
    };

    const orig = prisma.salesTransaction.findUniqueOrThrow.bind(prisma.salesTransaction);
    const spy = vi.spyOn(prisma.salesTransaction, "findUniqueOrThrow").mockImplementation((async (args: unknown) => {
      const res = await orig(args as Parameters<typeof orig>[0]);
      const inc = (args as { include?: Record<string, unknown> })?.include;
      if (!hookFired && inc?.lineItems && inc?.closingAssociate) {
        hookFired = true; // this is runCommission's own top-of-function read
        const r = await runBOnce();
        expect((r as { ok: boolean }).ok).toBe(true);
      }
      return res;
    }) as never);
    // Architect suggestion: assert the fix's actual invariant directly, not just via
    // timing — runCommissionTx must make ZERO calls on the global client for the reads
    // R-4 moved onto `db` (this firing means a read was moved back to the global client).
    let globalAssociateCalls = 0;
    const origAssociateFindMany = prisma.associate.findMany.bind(prisma.associate);
    const associateSpy = vi.spyOn(prisma.associate, "findMany").mockImplementation((async (args: unknown) => {
      globalAssociateCalls++;
      return origAssociateFindMany(args as Parameters<typeof origAssociateFindMany>[0]);
    }) as never);

    who.session = ADMIN;
    const aPromise = runCommission(tx.id, null); // a gratuitous concurrent recompute (call A)
    const fallback = (async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (!hookFired) await runBOnce(); // fixed code: the vulnerable read moved off the global
    })(); // client, so the hook above never fires — still exercise a real concurrent B.
    await Promise.all([aPromise, fallback]);
    spy.mockRestore();
    associateSpy.mockRestore();
    // Zero, because runCommissionTx now reads uplines through `db` only, and
    // markInvoicePaid's own recomputeEligibility call does the same in its own
    // transaction — regardless of which path (hook or fallback) drove call B above.
    expect(globalAssociateCalls).toBe(0);

    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id, associateId: { not: null } } });
    const fresh = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    console.log("R-4 race result:", hookFired ? "hook-forced (unfixed path)" : "fallback (fixed path)",
      fresh.commissionEligibility, lines.map((l) => [l.lineType, l.status, l.amount.toFixed(2)]));

    expect(fresh.commissionEligibility).toBe(CommissionEligibility.Eligible);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.status === LedgerStatus.Eligible)).toBe(true);
  });
});
