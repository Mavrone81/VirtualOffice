// Audit reliability (reviews/audit-reliability.md) — Tier A money actions: when
// the action's audit can't be written, the WHOLE action rolls back and the caller
// gets "auditUnavailable" (never a 500, never a half-done action). Audit
// failures are real (a local-only BEFORE INSERT trigger, lib/test-audit-fault.ts),
// raised inside the action's own transaction. Fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { fakePdfFile } from "@/lib/test-fixtures";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { markInvoicePaid } from "./invoices/actions";
import { runPayouts, setPayoutStatus, reconcileLegacyPayout } from "./payouts/actions";
import { runCommission } from "./commission/run";

const TAG = "AUDTA-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", assocId = "";

async function mkTransaction(code: string, saleAmount = 1000) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2196-01-05"), clientName: TAG + code, saleAmount, paymentPlan: "FullPayment", closingAssociateId: assocId, amountCollected: 0, status: "QuotationApproved", closedAt: new Date() },
    select: { id: true },
  });
  return prisma.salesTransaction.create({
    data: { transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2196-01-05"), clientName: TAG + code, saleAmount, paymentPlan: "FullPayment", closingAssociateId: assocId, amountCollected: 0, commissionEligibility: "Eligible" },
  });
}
const mkLine = (transactionId: string, month: string, amount: string) => prisma.commissionLedger.create({
  data: { transactionId, payoutMonth: month, associateId: assocId, lineType: "Personal", basisAmount: "1000", amount, eligibility: "Eligible", status: "Eligible" },
});

beforeAll(async () => {
  await installAuditFault();
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  assocId = (await prisma.associate.create({
    data: { associateCode: TAG + "A1", fullName: TAG + "Closer", designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: "Active" },
    select: { id: true },
  })).id;
  who.session = ADMIN;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { associateId: assocId } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: assocId } });
  await prisma.invoice.deleteMany({ where: { companyId } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: assocId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: assocId } });
  await prisma.associate.deleteMany({ where: { id: assocId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await removeAuditFault();
});

describe("Tier A money actions roll back when their audit can't be written", () => {
  it("mark paid: invoice stays Outstanding, amountCollected unchanged, no ack left behind", async () => {
    const tx = await mkTransaction("MP");
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "MP", amount: 1000, status: "Outstanding" } });
    await failAuditsFor("invoice.marked_paid");
    expect(await markInvoicePaid(inv.id, fakePdfFile())).toEqual({ ok: false, error: "auditUnavailable" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("Outstanding");
    expect(after.paymentAckFileKey).toBeNull();
    expect((await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } })).amountCollected.toFixed(2)).toBe("0.00");

    await clearAuditFaults();
    expect((await markInvoicePaid(inv.id, fakePdfFile())).ok).toBe(true); // and it works once the audit can be written
    expect(await prisma.auditLog.count({ where: { action: "invoice.marked_paid", entityId: inv.id } })).toBe(1);
  });

  it("setPayoutStatus: stays Pending", async () => {
    const p = await prisma.monthlyPayout.create({ data: { payoutMonth: "2196-02", associateId: assocId, seq: 0, associateName: "x", designation: "SalesAssociate", totalPayable: "100.00", payoutStatus: "Pending" } });
    await failAuditsFor(p.id);
    expect(await setPayoutStatus(p.id, "Approved")).toEqual({ ok: false, error: "auditUnavailable" });
    expect((await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: p.id } })).payoutStatus).toBe("Pending");
  });

  it("runPayouts: the associate's step rolls back — lines stay unattached, no payout created", async () => {
    const tx = await mkTransaction("RP");
    const line = await mkLine(tx.id, "2196-03", "250.00");
    await failAuditsFor("payout.created");
    const r = await runPayouts("2196-03");
    expect(r).toMatchObject({ ok: false, error: "auditUnavailable" });
    expect((await prisma.commissionLedger.findUniqueOrThrow({ where: { id: line.id } })).payoutId).toBeNull();
    expect(await prisma.monthlyPayout.count({ where: { associateId: assocId, payoutMonth: "2196-03" } })).toBe(0);
  });

  it("reconcileLegacyPayout: no lines attached", async () => {
    const tx = await mkTransaction("RL");
    const line = await mkLine(tx.id, "2196-04", "300.00");
    const legacy = await prisma.monthlyPayout.create({ data: { payoutMonth: "2196-04", associateId: assocId, seq: 0, associateName: "x", designation: "SalesAssociate", totalPayable: "300.00", payoutStatus: "Paid" } });
    await failAuditsFor("payout.legacy_reconciled");
    expect(await reconcileLegacyPayout(legacy.id, [line.id], "bank statement")).toMatchObject({ ok: false, error: "auditUnavailable" });
    expect((await prisma.commissionLedger.findUniqueOrThrow({ where: { id: line.id } })).payoutId).toBeNull();
  });

  it("runCommission: a recompute with nothing to record still succeeds (audits are per change, not per call)", async () => {
    const tx = await mkTransaction("RC");
    await failAuditsFor(tx.id); // commission.adjusted / payout.updated carry the transaction or payout id
    // No structure version → the recompute writes no lines, so nothing to audit: it must still succeed.
    await expect(runCommission(tx.id, null)).resolves.toBeTypeOf("number");
  });
});
