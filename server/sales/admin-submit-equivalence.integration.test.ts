// Item 9 (owner: "admin must be able to submit product also with the same
// flow as the rest"). AD's fix is routing only (a new /admin/sales/new page
// reusing the portal's existing SaleForm + submitSale — see
// app/admin/sales/new/page.tsx) — no change to any role check or to the
// commission engine. This is the proof that matters: an admin's own
// submission, driven through the exact same pipeline an associate's goes
// through (submit -> split approval -> quotation approval -> close ->
// runCommission), produces rows INDISTINGUISHABLE from an associate's,
// field by field, except for the one field that's supposed to differ
// (closingAssociateId — each submitter's own id).
//
// Needs a local, DISPOSABLE PG (DATABASE_URL); fake data only, all rows
// tagged and cleaned up in afterAll.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { SubmissionStatus, SubmissionFlow, LedgerLineType } from "@prisma/client";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Same reasoning as server/commission/eligibility-threshold-cap.test.ts: this
// file isn't about A-17 at all, but submitSale/closeSale read the ambient
// flag, which would otherwise steer this fixture by whatever happens to be
// in .env. Forced off so the result doesn't depend on that.
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, A17_CLOSED_DEAL_FLOW: false } }));

import { prisma } from "@/lib/db";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { transactionWhere } from "@/server/sales/transaction-filters";

const TAG = "ADMINEQ-";
const SALE_DATE = "2098-06-10";
// A pure Business-Admin approver — no associate profile of their own, used
// only to run the approval/close chain, same convention as the eligibility
// cap test's ADMIN fixture. Deliberately a THIRD identity, distinct from
// either closer below.
const APPROVER = { user: { associateId: null, id: "33333333-3333-3333-3333-333333333333", role: "Admin" } };

let companyId = "", productId = "", closerAdminId = "", closerAssocId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Admin Equivalence Test", commissionType: "Percentage" as never,
      // No overrides (SM/SD = 0) — no uplines are set up on either closer, so
      // this keeps the ledger to Personal + CompanyRetained only. Override
      // routing is already covered by the engine's own tests; the one thing
      // under test here is whether anything differs by WHO submitted, not
      // whether overrides route correctly.
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
  // Same designation for both closers (SalesAssociate) — isolating the ONE
  // variable this item is about (the submitter's login AppRole) by holding
  // everything else, including the closer's own Designation, constant.
  closerAdminId = (await prisma.associate.create({
    data: { associateCode: TAG + "ADM", fullName: "Admin Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  closerAssocId = (await prisma.associate.create({
    data: { associateCode: TAG + "ASC", fullName: "Associate Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.submissionDocument.deleteMany({ where: { fileKey: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: mine });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

/** Submits as `closerId` under `role`, returns the new submission's id — stops right
 * after submission, before any approval, so the verify-queue check below sees it
 * exactly as submitted. */
async function submitAs(closerId: string, role: string, clientSuffix: string): Promise<string> {
  who.session = { user: { associateId: closerId, id: "sess-" + clientSuffix, role } };
  const submitted = await submitSale({
    salesDate: SALE_DATE,
    clientName: TAG + clientSuffix,
    paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
  } as never);
  expect(submitted.ok).toBe(true);
  return (await prisma.salesSubmission.findFirstOrThrow({ where: { clientName: TAG + clientSuffix }, select: { id: true } })).id;
}

/** Approves and closes a submission (Business Admin approver), through to a
 * booked SalesTransaction with its commission ledger run. */
async function approveAndClose(subId: string, clientSuffix: string): Promise<string> {
  who.session = APPROVER;
  expect((await approveSubmissionSplit(subId)).ok).toBe(true);
  expect((await adminApproveSplit(subId)).ok).toBe(true);
  expect((await approveQuotation(subId)).ok).toBe(true);
  await prisma.submissionDocument.create({ data: { submissionId: subId, kind: "Signed", fileKey: TAG + clientSuffix + "-signed.pdf", fileName: "signed.pdf" } });
  expect((await closeSale(subId)).ok).toBe(true);
  return (await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: subId }, select: { id: true } })).id;
}

describe("an admin-submitted sale is indistinguishable from an associate-submitted one, downstream (item 9)", () => {
  it("the submitted row: same status/flow, closer attribution to each submitter's OWN associate id, same sale data — 2 rows examined", async () => {
    const adminSubId = await submitAs(closerAdminId, "Admin", "F1-ADM");
    const assocSubId = await submitAs(closerAssocId, "SalesAssociate", "F1-ASC");

    const [adminSub, assocSub] = await Promise.all([
      prisma.salesSubmission.findUniqueOrThrow({ where: { id: adminSubId }, include: { lineItems: true } }),
      prisma.salesSubmission.findUniqueOrThrow({ where: { id: assocSubId }, include: { lineItems: true } }),
    ]);

    // The one field that's SUPPOSED to differ, and it must differ correctly:
    // each row's closer is its own submitter, not the other one and not null.
    expect(adminSub.closingAssociateId).toBe(closerAdminId);
    expect(assocSub.closingAssociateId).toBe(closerAssocId);

    // Everything else: equal between the two rows.
    expect(adminSub.status).toBe(SubmissionStatus.Submitted);
    expect(assocSub.status).toBe(SubmissionStatus.Submitted);
    expect(adminSub.flow).toBe(assocSub.flow);
    expect(adminSub.saleAmount.toString()).toBe(assocSub.saleAmount.toString());
    expect(adminSub.paymentPlan).toBe(assocSub.paymentPlan);
    expect(adminSub.splitExceptionRequired).toBe(assocSub.splitExceptionRequired);
    expect(adminSub.associate2Id).toBeNull();
    expect(assocSub.associate2Id).toBeNull();
    expect(adminSub.lineItems).toHaveLength(1);
    expect(assocSub.lineItems).toHaveLength(1);
    expect(adminSub.lineItems[0].productCode).toBe(assocSub.lineItems[0].productCode);
    expect(adminSub.lineItems[0].lineSaleAmount.toString()).toBe(assocSub.lineItems[0].lineSaleAmount.toString());
  });

  it("the verify queue's own predicate (status=Submitted, flow=ClosedDeal) returns the same boolean for both rows — neither is singled out by role", async () => {
    const adminSubId = await submitAs(closerAdminId, "Admin", "F2-ADM");
    const assocSubId = await submitAs(closerAssocId, "SalesAssociate", "F2-ASC");

    // Exact predicate app/admin/sales/verify/page.tsx queries with.
    const inQueue = async (id: string) =>
      (await prisma.salesSubmission.count({ where: { id, status: SubmissionStatus.Submitted, flow: SubmissionFlow.ClosedDeal } })) > 0;
    const adminIn = await inQueue(adminSubId);
    const assocIn = await inQueue(assocSubId);
    expect(adminIn).toBe(assocIn);
    // A17_CLOSED_DEAL_FLOW is forced off above, so flow is Legacy for both —
    // neither is in the queue right now. That's still the right assertion:
    // it's the EQUALITY above that is the actual claim, not which value it
    // is. Pinned explicitly so a flag flip that changed this is visible here,
    // not just inferred.
    expect(adminIn).toBe(false);
  });

  it("the commission ledger: same line types, same basis, same rate, same amounts, for the same product and sale amount — 2 transactions, ledger rows compared pairwise", async () => {
    const adminSubId = await submitAs(closerAdminId, "Admin", "F3-ADM");
    const assocSubId = await submitAs(closerAssocId, "SalesAssociate", "F3-ASC");
    const adminTxId = await approveAndClose(adminSubId, "F3-ADM");
    const assocTxId = await approveAndClose(assocSubId, "F3-ASC");

    const ledgerOf = (transactionId: string) =>
      prisma.commissionLedger.findMany({
        where: { transactionId },
        orderBy: [{ lineType: "asc" }, { comCode: "asc" }],
      });
    const [adminLedger, assocLedger] = await Promise.all([ledgerOf(adminTxId), ledgerOf(assocTxId)]);

    expect(adminLedger.length).toBeGreaterThan(0);
    expect(adminLedger).toHaveLength(assocLedger.length);
    // Exactly the lines this product/rate configuration should produce —
    // Personal (to the closer) + CompanyRetained, nothing else (no overrides
    // configured, no add-ons, internal product).
    expect(adminLedger.map((l) => l.lineType).sort()).toEqual([LedgerLineType.CompanyRetained, LedgerLineType.Personal]);

    for (let i = 0; i < adminLedger.length; i++) {
      const a = adminLedger[i], b = assocLedger[i];
      expect(a.lineType).toBe(b.lineType);
      expect(a.comCode).toBe(b.comCode);
      expect(a.basisAmount.toString()).toBe(b.basisAmount.toString());
      expect(a.rateOrValue?.toString() ?? null).toBe(b.rateOrValue?.toString() ?? null);
      expect(a.amount.toString()).toBe(b.amount.toString());
      expect(a.status).toBe(b.status);
      // The Personal line's associateId is each closer's own id, not shared
      // and not the other one's — same shape as the submission-row check.
      if (a.lineType === LedgerLineType.Personal) {
        expect(a.associateId).toBe(closerAdminId);
        expect(b.associateId).toBe(closerAssocId);
      } else {
        expect(a.associateId).toBeNull();
        expect(b.associateId).toBeNull();
      }
    }
  });

  it("the received queue: transactionWhere matches both unconditionally (no role-keyed clause exists to match), and amountCollected>0 includes both once marked paid the same real way — 2 transactions examined", async () => {
    const adminSubId = await submitAs(closerAdminId, "Admin", "F4-ADM");
    const assocSubId = await submitAs(closerAssocId, "SalesAssociate", "F4-ASC");
    const adminTxId = await approveAndClose(adminSubId, "F4-ADM");
    const assocTxId = await approveAndClose(assocSubId, "F4-ASC");

    // transactionWhere (server/sales/transaction-filters.ts) has no clause
    // that reads role at all — confirmed by reading it, and confirmed here:
    // the empty-filter predicate matches both rows found by id, with nothing
    // to discriminate on.
    const matched = await prisma.salesTransaction.findMany({
      where: { AND: [transactionWhere({}), { id: { in: [adminTxId, assocTxId] } }] },
      select: { id: true },
    });
    expect(matched.map((r) => r.id).sort()).toEqual([adminTxId, assocTxId].sort());

    // "Received" (app/admin/sales/received/page.tsx) = amountCollected > 0.
    // Reached the real way for both: the actual markInvoicePaid action, same
    // as Accounts would use, not a raw amountCollected write — the point is
    // whether reaching "received" depends on the closer's role, not whether
    // markInvoicePaid itself works (server/invoices/b7-payment-ack.test.ts
    // already owns that).
    who.session = APPROVER;
    const adminInvoice = await prisma.invoice.findFirstOrThrow({ where: { transactionId: adminTxId }, select: { id: true } });
    const assocInvoice = await prisma.invoice.findFirstOrThrow({ where: { transactionId: assocTxId }, select: { id: true } });
    expect((await markInvoicePaid(adminInvoice.id, null)).ok).toBe(true);
    expect((await markInvoicePaid(assocInvoice.id, null)).ok).toBe(true);

    const received = await prisma.salesTransaction.findMany({
      where: { AND: [transactionWhere({}), { id: { in: [adminTxId, assocTxId] } }] },
      select: { id: true, amountCollected: true },
    });
    const receivedIds = received.filter((r) => r.amountCollected.greaterThan(0)).map((r) => r.id).sort();
    expect(receivedIds).toEqual([adminTxId, assocTxId].sort());
  });
});
