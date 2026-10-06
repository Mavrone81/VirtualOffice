// "Delete associate after deactivated" — archive (reversible, hides from every
// archivedAt: null read filter) and delete (narrow, only for a never-used
// Inactive associate). Real throwaway Postgres (needs DATABASE_URL); every
// fixture is built by this file and cleaned up, never leaning on live data —
// an empty fixture would make "the associate was not deleted" pass trivially
// against a row that was never created, so every guard test here creates its
// own blocking row and asserts the count on BOTH sides of the call.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { downlineIds } from "@/lib/rbac";
import { fetchTeamDashboardAssociates } from "@/server/recruitment/team-dashboard";
import { archiveAssociate, deleteAssociate } from "./actions";

const who = { session: null as { user: { id: string; role: string } } | null };
import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/audit")>()),
  auditTx: vi.fn(async () => {}),
}));

const TAG = "ARCHDEL-";
let adminUserId = "";

function mkAssociate(code: string, overrides: Record<string, unknown> = {}) {
  return prisma.associate.create({
    data: {
      associateCode: TAG + code,
      fullName: TAG + code,
      designation: "SalesAssociate" as never,
      approvalStatus: "Approved" as never,
      associateStatus: "Inactive" as never,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}admin@example.test`, passwordHash: "x", role: "Admin" as never },
    select: { id: true },
  });
  adminUserId = admin.id;
  who.session = { user: { id: adminUserId, role: "Admin" } };
});

afterAll(async () => {
  // Order matches the dependency direction: children before parents. Each
  // test's own try/finally is the primary cleanup; this is the backstop if one
  // of them is interrupted — matched by TAG-prefixed denormalized name fields
  // where the model has one, since associateId itself may already be gone.
  await prisma.paymentVoucher.deleteMany({ where: { OR: [{ associateName: { startsWith: TAG } }, { reference: { startsWith: TAG } }] } });
  await prisma.commissionLedger.deleteMany({ where: { associateName: { startsWith: TAG } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateName: { startsWith: TAG } } });
  await prisma.quotation.deleteMany({ where: { quotationCode: { startsWith: TAG } } });
  await prisma.vendorReferral.deleteMany({ where: { vendorName: { startsWith: TAG } } });
  await prisma.document.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.candidate.deleteMany({ where: { onboardingToken: { startsWith: TAG } } });
  await prisma.pFileDocument.deleteMany({ where: { pFile: { user: { email: { startsWith: TAG.toLowerCase() } } } } });
  await prisma.pFile.deleteMany({ where: { user: { email: { startsWith: TAG.toLowerCase() } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("deleteAssociate", () => {
  // Checked first in the function and in this file: this is the guard closest to
  // the owner's own rule, and it was watched working (by accident) while building
  // the ledger test below — the fixture there was re-engineered specifically to
  // AVOID tripping this one, which is a good sign the ordering is understood, but
  // "watched it fire once" is not the same as "asserted". It wasn't, until now.
  it("an associate with sales history (as closer) is REFUSED and still exists", async () => {
    const a = await mkAssociate("SALESHIST");
    const sub = await prisma.salesSubmission.create({
      data: { salesDate: new Date("2099-01-01"), clientName: TAG + "SALESHIST", saleAmount: 100, paymentPlan: "FullPayment" as never, closingAssociateId: a.id, amountCollected: 0 },
    });
    const tx = await prisma.salesTransaction.create({
      data: { transactionCode: TAG + "SALESHISTTX", submissionId: sub.id, salesDate: new Date("2099-01-01"), clientName: TAG + "SALESHIST", saleAmount: 100, paymentPlan: "FullPayment" as never, closingAssociateId: a.id, amountCollected: 0 },
    });

    try {
      const subCountBefore = await prisma.salesSubmission.count({ where: { closingAssociateId: a.id } });
      const txCountBefore = await prisma.salesTransaction.count({ where: { closingAssociateId: a.id } });
      expect(subCountBefore).toBe(1);
      expect(txCountBefore).toBe(1);

      const result = await deleteAssociate(a.id);
      expect(result).toEqual({ ok: false, error: "associateHasSalesHistory" });

      const stillThere = await prisma.associate.findUnique({ where: { id: a.id } });
      expect(stillThere).not.toBeNull();
      expect(await prisma.salesSubmission.count({ where: { closingAssociateId: a.id } })).toBe(1);
      expect(await prisma.salesTransaction.count({ where: { closingAssociateId: a.id } })).toBe(1);
    } finally {
      await prisma.salesTransaction.deleteMany({ where: { id: tx.id } });
      await prisma.salesSubmission.deleteMany({ where: { id: sub.id } });
    }
  });

  it("an associate with a commission ledger line is REFUSED and still exists", async () => {
    const a = await mkAssociate("LEDGER");
    // Isolated from the sales-history check on purpose: the submission/transaction
    // this ledger row hangs off belongs to a DIFFERENT associate (a split-payee
    // shape the schema already supports — CommissionLedger.associateId is
    // independent of SalesTransaction.closingAssociateId). If the fixture instead
    // made `a` the closer too, the sales-history check (checked earlier in the
    // function) would fire first and this test would never actually exercise the
    // ledger-specific branch — caught by running this for real: the first draft
    // of this fixture did exactly that and the assertion below failed with
    // "associateHasSalesHistory" instead.
    const otherCloser = await mkAssociate("LEDGERCLOSER");
    const sub = await prisma.salesSubmission.create({
      data: { salesDate: new Date("2099-01-01"), clientName: TAG + "LEDGER", saleAmount: 100, paymentPlan: "FullPayment" as never, closingAssociateId: otherCloser.id, amountCollected: 0 },
    });
    const tx = await prisma.salesTransaction.create({
      data: { transactionCode: TAG + "LEDGERTX", submissionId: sub.id, salesDate: new Date("2099-01-01"), clientName: TAG + "LEDGER", saleAmount: 100, paymentPlan: "FullPayment" as never, closingAssociateId: otherCloser.id, amountCollected: 0 },
    });
    await prisma.commissionLedger.create({
      data: { transactionId: tx.id, payoutMonth: "2099-01", associateId: a.id, associateName: a.fullName, lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never },
    });

    // cleanup specific to this test (saleSubmission/Transaction aren't swept by
    // afterAll) wrapped in try/finally so it runs even if an assertion below
    // throws — a failed assertion here previously leaked a submission still
    // pointing at the associate, which then broke afterAll's associate delete
    // for every other test in the file with an FK violation. Caught by running
    // this for real, not by inspection.
    try {
      const beforeCount = await prisma.commissionLedger.count({ where: { associateId: a.id } });
      expect(beforeCount).toBe(1); // exactly the one row this test created

      const result = await deleteAssociate(a.id);
      expect(result).toEqual({ ok: false, error: "associateHasCommissionHistory" });

      const stillThere = await prisma.associate.findUnique({ where: { id: a.id } });
      expect(stillThere).not.toBeNull();
      const afterCount = await prisma.commissionLedger.count({ where: { associateId: a.id } });
      expect(afterCount).toBe(1); // unchanged — refusal didn't touch the ledger either
    } finally {
      await prisma.commissionLedger.deleteMany({ where: { associateId: a.id } });
      await prisma.salesTransaction.deleteMany({ where: { id: tx.id } });
      await prisma.salesSubmission.deleteMany({ where: { id: sub.id } });
      await prisma.associate.deleteMany({ where: { id: otherCloser.id } });
    }
  });

  it("an associate with a downline is REFUSED, still exists, AND the downline still exists", async () => {
    const upline = await mkAssociate("UPLINE2");
    const downline = await mkAssociate("DOWNLINE2", { directUplineId: upline.id });

    const downlineCountBefore = await prisma.associate.count({ where: { directUplineId: upline.id } });
    expect(downlineCountBefore).toBe(1);

    const result = await deleteAssociate(upline.id);
    expect(result).toEqual({ ok: false, error: "associateHasDownline" });

    const uplineStill = await prisma.associate.findUnique({ where: { id: upline.id } });
    expect(uplineStill).not.toBeNull();
    const downlineStill = await prisma.associate.findUnique({ where: { id: downline.id } });
    expect(downlineStill).not.toBeNull();
    const downlineCountAfter = await prisma.associate.count({ where: { directUplineId: upline.id } });
    expect(downlineCountAfter).toBe(1); // the one row, still attached
  });

  it("an associate with payout history is REFUSED and still exists", async () => {
    const a = await mkAssociate("PAYOUTHIST");
    const payout = await prisma.monthlyPayout.create({
      data: { payoutMonth: "2099-03", associateId: a.id, seq: 0, kind: "Regular" as never, associateName: a.fullName, designation: "SalesAssociate" as never, payoutStatus: "Approved" as never, totalPayable: 100 },
    });

    const before = await prisma.monthlyPayout.count({ where: { associateId: a.id } });
    expect(before).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateHasPayoutHistory" });

    expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.monthlyPayout.count({ where: { associateId: a.id } })).toBe(1);

    await prisma.monthlyPayout.deleteMany({ where: { id: payout.id } });
  });

  it("an associate with an issued payment voucher is REFUSED and still exists", async () => {
    const a = await mkAssociate("VOUCHER");
    // Isolated from the sales-history and payout-history checks the same way the
    // ledger test above isolates from sales-history: the transaction this voucher
    // is issued against, AND the payout batch it settles, both belong to a
    // DIFFERENT associate. PaymentVoucher.associateId (who the voucher is FOR)
    // is a separate column from both SalesTransaction.closingAssociateId and
    // MonthlyPayout.associateId — nothing in the schema requires them to agree,
    // so this is a valid fixture, not a contrived one, and it reaches the
    // voucher-specific branch rather than tripping an earlier check first.
    const other = await mkAssociate("VOUCHEROTHER");
    const sub = await prisma.salesSubmission.create({
      data: { salesDate: new Date("2099-04-01"), clientName: TAG + "VOUCHER", saleAmount: 100, paymentPlan: "FullPayment" as never, closingAssociateId: other.id, amountCollected: 100 },
    });
    const tx = await prisma.salesTransaction.create({
      data: { transactionCode: TAG + "VOUCHERTX", submissionId: sub.id, salesDate: new Date("2099-04-01"), clientName: TAG + "VOUCHER", saleAmount: 100, paymentPlan: "FullPayment" as never, closingAssociateId: other.id, amountCollected: 100 },
    });
    const payout = await prisma.monthlyPayout.create({
      data: { payoutMonth: "2099-04", associateId: other.id, seq: 0, kind: "Regular" as never, associateName: other.fullName, designation: "SalesAssociate" as never, payoutStatus: "Paid" as never, totalPayable: 100 },
    });
    const voucher = await prisma.paymentVoucher.create({
      data: {
        transactionId: tx.id, associateId: a.id, payoutId: payout.id, reference: TAG + "VOUCHERREF", seq: 1,
        associateName: a.fullName, associateCode: a.associateCode, transactionCode: tx.transactionCode,
        clientInitials: "VC", payoutMonths: ["2099-04"], paidDate: new Date("2099-04-15"), lines: [], totalPaid: 100,
      },
    });

    try {
      const before = await prisma.paymentVoucher.count({ where: { associateId: a.id } });
      expect(before).toBe(1);

      const result = await deleteAssociate(a.id);
      expect(result).toEqual({ ok: false, error: "associateHasPaymentVouchers" });

      expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
      expect(await prisma.paymentVoucher.count({ where: { associateId: a.id } })).toBe(1);
    } finally {
      await prisma.paymentVoucher.deleteMany({ where: { id: voucher.id } });
      await prisma.monthlyPayout.deleteMany({ where: { id: payout.id } });
      await prisma.salesTransaction.deleteMany({ where: { id: tx.id } });
      await prisma.salesSubmission.deleteMany({ where: { id: sub.id } });
      await prisma.associate.deleteMany({ where: { id: other.id } });
    }
  });

  it("an associate with a quotation is REFUSED and still exists", async () => {
    const a = await mkAssociate("QUOTATION");
    const q = await prisma.quotation.create({
      data: { quotationCode: TAG + "Q1", associateId: a.id, clientName: TAG + "Client", quoteDate: new Date("2099-05-01"), lines: [], total: 500 },
    });

    const before = await prisma.quotation.count({ where: { associateId: a.id } });
    expect(before).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateHasQuotations" });

    expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.quotation.count({ where: { associateId: a.id } })).toBe(1);

    await prisma.quotation.deleteMany({ where: { id: q.id } });
  });

  it("an associate with a vendor referral is REFUSED and still exists", async () => {
    const a = await mkAssociate("VENDORREF");
    const vr = await prisma.vendorReferral.create({
      data: { vendorName: TAG + "Vendor", submittedByAssociateId: a.id },
    });

    const before = await prisma.vendorReferral.count({ where: { submittedByAssociateId: a.id } });
    expect(before).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateHasVendorReferrals" });

    expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.vendorReferral.count({ where: { submittedByAssociateId: a.id } })).toBe(1);

    await prisma.vendorReferral.deleteMany({ where: { id: vr.id } });
  });

  it("an associate with a document on file is REFUSED and still exists", async () => {
    const a = await mkAssociate("DOCOWNER");
    const doc = await prisma.document.create({
      data: { type: "Other" as never, title: TAG + "Doc", fileKey: TAG + "doc-key", ownerAssociateId: a.id },
    });

    const before = await prisma.document.count({ where: { ownerAssociateId: a.id } });
    expect(before).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateHasDocuments" });

    expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.document.count({ where: { ownerAssociateId: a.id } })).toBe(1);

    await prisma.document.deleteMany({ where: { id: doc.id } });
  });

  it("an associate who is an intended upline on a candidate is REFUSED and still exists", async () => {
    const a = await mkAssociate("INTENDEDUP");
    const cand = await prisma.candidate.create({
      data: {
        fullName: TAG + "Candidate1", mobileNumber: "90000001", email: `${TAG.toLowerCase()}cand1@example.test`,
        onboardingToken: TAG + "TOKEN1", intendedDirectUplineId: a.id,
      },
    });

    const before = await prisma.candidate.count({ where: { intendedDirectUplineId: a.id } });
    expect(before).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateIsIntendedUpline" });

    expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.candidate.count({ where: { intendedDirectUplineId: a.id } })).toBe(1);

    await prisma.candidate.deleteMany({ where: { id: cand.id } });
  });

  it("an associate who is the converted result of a candidate record is REFUSED and still exists", async () => {
    const a = await mkAssociate("CONVERTED");
    const cand = await prisma.candidate.create({
      data: {
        fullName: TAG + "Candidate2", mobileNumber: "90000002", email: `${TAG.toLowerCase()}cand2@example.test`,
        onboardingToken: TAG + "TOKEN2", convertedAssociateId: a.id,
      },
    });

    const before = await prisma.candidate.count({ where: { convertedAssociateId: a.id } });
    expect(before).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateIsConvertedCandidate" });

    expect(await prisma.associate.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await prisma.candidate.count({ where: { convertedAssociateId: a.id } })).toBe(1);

    await prisma.candidate.deleteMany({ where: { id: cand.id } });
  });

  it("an ACTIVE associate is REFUSED even with no history (the owner's deactivate-first rule)", async () => {
    const a = await mkAssociate("ACTIVE2", { associateStatus: "Active" as never });

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: false, error: "associateNotInactive" });

    const stillThere = await prisma.associate.findUnique({ where: { id: a.id } });
    expect(stillThere).not.toBeNull();
  });

  it("an unused Inactive associate is deleted, and their user and p_file go with them", async () => {
    const a = await mkAssociate("UNUSED");
    const user = await prisma.user.create({
      data: { email: `${TAG.toLowerCase()}unused@example.test`, passwordHash: "x", role: "SalesAssociate" as never, associateId: a.id },
    });
    const pFile = await prisma.pFile.create({ data: { userId: user.id, associateId: a.id } });

    // Row count on BOTH sides: exactly 1 associate, 1 user, 1 pFile before.
    expect(await prisma.associate.count({ where: { id: a.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    expect(await prisma.pFile.count({ where: { id: pFile.id } })).toBe(1);

    const result = await deleteAssociate(a.id);
    expect(result).toEqual({ ok: true });

    expect(await prisma.associate.count({ where: { id: a.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.pFile.count({ where: { id: pFile.id } })).toBe(0);
  });
});

describe("archiveAssociate", () => {
  it("un-archive restores them", async () => {
    const a = await mkAssociate("RESTORE");

    const archiveResult = await archiveAssociate(a.id, true);
    expect(archiveResult).toEqual({ ok: true });
    const archived = await prisma.associate.findUnique({ where: { id: a.id }, select: { archivedAt: true } });
    expect(archived?.archivedAt).not.toBeNull();

    const restoreResult = await archiveAssociate(a.id, false);
    expect(restoreResult).toEqual({ ok: true });
    const restored = await prisma.associate.findUnique({ where: { id: a.id }, select: { archivedAt: true } });
    expect(restored?.archivedAt).toBeNull();
  });

  it("refuses to archive an Active associate (same deactivate-first rule as delete)", async () => {
    const a = await mkAssociate("ACTIVEARCH", { associateStatus: "Active" as never });
    const result = await archiveAssociate(a.id, true);
    expect(result).toEqual({ ok: false, error: "associateNotInactive" });
    const row = await prisma.associate.findUnique({ where: { id: a.id }, select: { archivedAt: true } });
    expect(row?.archivedAt).toBeNull();
  });

  // THE ONE THAT MATTERS MOST: Associate.archivedAt has never been written in this
  // codebase before this branch, so lib/rbac.ts's downlineIds and
  // fetchTeamDashboardAssociates's `archivedAt: null` filters have never run
  // against a non-null value — this is the first time either is actually
  // exercised, not a regression check.
  it("an archived associate disappears from downlineIds and the team dashboard, while their ledger rows stay untouched", async () => {
    const director = await mkAssociate("DIR3");
    const manager = await mkAssociate("MGR3", { directUplineId: director.id });
    const rep = await mkAssociate("REP3", { directUplineId: manager.id });

    // Ledger row for the associate being archived — must survive archiving untouched.
    const sub = await prisma.salesSubmission.create({
      data: { salesDate: new Date("2099-02-01"), clientName: TAG + "MGR3", saleAmount: 200, paymentPlan: "FullPayment" as never, closingAssociateId: manager.id, amountCollected: 0 },
    });
    const tx = await prisma.salesTransaction.create({
      data: { transactionCode: TAG + "MGR3TX", submissionId: sub.id, salesDate: new Date("2099-02-01"), clientName: TAG + "MGR3", saleAmount: 200, paymentPlan: "FullPayment" as never, closingAssociateId: manager.id, amountCollected: 0 },
    });
    const ledger = await prisma.commissionLedger.create({
      data: { transactionId: tx.id, payoutMonth: "2099-02", associateId: manager.id, associateName: manager.fullName, lineType: "Personal" as never, basisAmount: 200, amount: 200, eligibility: "Eligible" as never, status: "Eligible" as never },
    });

    try {
      // Before archiving: director's downline includes self + manager + rep (3).
      const before = await downlineIds(director.id);
      expect(new Set(before)).toEqual(new Set([director.id, manager.id, rep.id]));

      const result = await archiveAssociate(manager.id, true);
      expect(result).toEqual({ ok: true });

      // After archiving the MIDDLE node: confirmed by direct measurement, not
      // assumed — downlineIds' recursive CTE excludes a node once
      // archived_at IS NOT NULL, and the recursive step can only chain through
      // rows already IN the result set. Once `manager` is excluded, `rep`
      // (whose direct_upline_id is `manager`) can never be reached FROM
      // `director`, even though `rep` itself is not archived. That is a real,
      // reportable side effect of archiving a middle node, not a bug in this
      // branch's own code — the filter (lib/rbac.ts:105) is exactly as
      // documented, and this is the first time anyone has looked at what it
      // does to a non-leaf archive.
      const after = await downlineIds(director.id);
      expect(new Set(after)).toEqual(new Set([director.id])); // manager AND rep both gone from director's view

      // rep itself is untouched and still exists as its own row, still pointing at manager.
      const repRow = await prisma.associate.findUnique({ where: { id: rep.id }, select: { archivedAt: true, directUplineId: true } });
      expect(repRow?.archivedAt).toBeNull();
      expect(repRow?.directUplineId).toBe(manager.id);

      // Team dashboard: querying explicitly BY id (bypassing downlineIds) still
      // excludes the archived manager — its own `archivedAt: null` filter catches it
      // independently of the downline-traversal issue above.
      const dashboardRows = await fetchTeamDashboardAssociates([director.id, manager.id, rep.id]);
      const dashboardIds = dashboardRows.map((r) => r.id);
      expect(dashboardIds).toContain(director.id);
      expect(dashboardIds).toContain(rep.id);
      expect(dashboardIds).not.toContain(manager.id);
      expect(dashboardRows.length).toBe(2); // exactly director + rep, out of 3 requested

      // Ledger row: untouched by archiving — same row, same amount.
      const ledgerAfter = await prisma.commissionLedger.findUnique({ where: { id: ledger.id } });
      expect(ledgerAfter).not.toBeNull();
      expect(ledgerAfter?.amount.toString()).toBe("200");
      expect(await prisma.commissionLedger.count({ where: { associateId: manager.id } })).toBe(1);
    } finally {
      await prisma.commissionLedger.deleteMany({ where: { id: ledger.id } });
      await prisma.salesTransaction.deleteMany({ where: { id: tx.id } });
      await prisma.salesSubmission.deleteMany({ where: { id: sub.id } });
    }
  });
});
