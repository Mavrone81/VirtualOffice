// B-7 — the payment acknowledgement is OPTIONAL on mark-paid (owner ruling,
// reverses #21's "required"); when one is attached it's still SEC-11 checked
// (magic-byte sniffed, size-capped). Un-mark is Business Admin only, requires
// a reason, and is refused when the transaction's commission is already
// settled in an Approved or Paid payout. Real throwaway Postgres (needs
// DATABASE_URL); fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { prisma } from "@/lib/db";
import { markInvoicePaid, markInstallmentPaid, markInvoiceUnpaid } from "./actions";
import { fakePdfFile } from "@/lib/test-fixtures";
import { logAudit, auditTx } from "@/lib/audit";
import { auditedEntries } from "@/lib/test-fixtures";

const TAG = "B7ACK-";
const BUSINESS_ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const ACCOUNTS = { user: { associateId: null, id: "22222222-2222-2222-2222-222222222222", role: "Accounts" } };
let companyId = "", closerId = "";

async function mkTransaction(code: string, saleAmount: number) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-06-01"), clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
    select: { id: true },
  });
  return prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-06-01"),
      clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0,
    },
  });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: closerId } });
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transaction: { closingAssociateId: closerId } } } });
  await prisma.installmentPlan.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("mark-paid's payment acknowledgement is optional, but SEC-11 checked when given", () => {
  it("an invoice mark-paid with no file succeeds with a null ack key; an oversized or bad-type file is still refused and writes nothing", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("NOACK", 1000);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "NOACK", amount: 1000, status: "Outstanding" as never } });

    const notADoc = new File([new TextEncoder().encode("just some text, not a pdf/image")], "fake.pdf", { type: "application/pdf" });
    expect((await markInvoicePaid(inv.id, notADoc))).toEqual({ ok: false, error: "invalidFileType" });

    // DevLead (gate review): the ack becoming OPTIONAL must not also drop the
    // size cap's own test coverage — MAX_ACK_BYTES is still enforced in
    // storePaymentAck, and production is unguarded by a test that nobody
    // checks once the "no file" case (which shared this test) is gone.
    const oversized = new File([new Uint8Array(10_000_001)], "big.pdf", { type: "application/pdf" });
    expect((await markInvoicePaid(inv.id, oversized))).toEqual({ ok: false, error: "fileTooLarge" });

    const stillOutstanding = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(stillOutstanding.status).toBe("Outstanding");
    expect(stillOutstanding.paymentAckFileKey).toBeNull();

    // No file at all (null, or a zero-byte File — the UI's "nothing chosen"
    // shape) is no longer a refusal: it marks Paid with a null ack key.
    expect((await markInvoicePaid(inv.id, null)).ok).toBe(true);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(paid.status).toBe("Paid");
    expect(paid.paymentAckFileKey).toBeNull();
  });

  it("a genuine PDF still succeeds and records the key, for both invoice and installment", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("WITHACK", 1000);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "WITHACK", amount: 1000, status: "Outstanding" as never } });
    expect((await markInvoicePaid(inv.id, fakePdfFile())).ok).toBe(true);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(paid.status).toBe("Paid");
    expect(paid.paymentAckFileKey).toMatch(new RegExp(`^payment-acks/${inv.id}/`));
  });

  it("an installment mark-paid also accepts no ack, and persists its own method/reference/ack columns when one is given", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("INSACK", 300);
    const plan = await prisma.installmentPlan.create({ data: { transactionId: tx.id, totalAmount: 300, deposit: 0, installmentCount: 1 } });
    const s = await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 1, dueAmount: 300, paid: false } });

    const noAckResult = await markInstallmentPaid(s.id, new File([], "empty.pdf"), { method: "Cash" as never });
    expect(noAckResult.ok).toBe(true);
    const noAckRow = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(noAckRow.paid).toBe(true);
    expect(noAckRow.paymentAckFileKey).toBeNull();

    const tx2 = await mkTransaction("INSACK2", 300);
    const plan2 = await prisma.installmentPlan.create({ data: { transactionId: tx2.id, totalAmount: 300, deposit: 0, installmentCount: 1 } });
    const s2 = await prisma.installmentSchedule.create({ data: { planId: plan2.id, sequence: 1, dueAmount: 300, paid: false } });
    expect((await markInstallmentPaid(s2.id, fakePdfFile(), { method: "Bank" as never, reference: "REF-1" })).ok).toBe(true);
    const row2 = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: s2.id } });
    expect(row2.paid).toBe(true);
    expect(row2.paidMethod).toBe("Bank");
    expect(row2.paidReference).toBe("REF-1");
    expect(row2.paymentAckFileKey).toMatch(new RegExp(`^payment-acks/${s2.id}/`));
  });
});

describe("unmark clears the ack/method/reference, but both are recoverable from audit history", () => {
  it("mark -> unmark -> mark leaves both ack keys discoverable in the audit log", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("RECOVER", 500);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "RECOVER", amount: 500, status: "Outstanding" as never } });

    vi.mocked(logAudit).mockClear();
    const r1 = await markInvoicePaid(inv.id, fakePdfFile(), { method: "Bank" as never, reference: "REF-A" });
    expect(r1.ok).toBe(true);
    const firstAckKey = (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paymentAckFileKey;
    expect(firstAckKey).not.toBeNull();

    expect((await markInvoiceUnpaid(inv.id, "correction")).ok).toBe(true);
    const afterUnmark = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(afterUnmark.paymentAckFileKey).toBeNull(); // cleared, not overwritten silently
    expect(afterUnmark.paidMethod).toBeNull();
    expect(afterUnmark.paidReference).toBeNull();

    const r2 = await markInvoicePaid(inv.id, fakePdfFile(), { method: "Cash" as never, reference: "REF-B" });
    expect(r2.ok).toBe(true);
    const secondAckKey = (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paymentAckFileKey;
    expect(secondAckKey).not.toBe(firstAckKey);

    // Both keys are recoverable from the audit trail even though only the
    // second is live on the row.
    const paidCalls = auditedEntries(logAudit, auditTx).filter((c) => c.action === "invoice.marked_paid" && c.entityId === inv.id).map((c) => [c]);
    expect(paidCalls[0][0].after).toMatchObject({ ackFileKey: firstAckKey, method: "Bank", reference: "REF-A" });
    expect(paidCalls[1][0].after).toMatchObject({ ackFileKey: secondAckKey, method: "Cash", reference: "REF-B" });
    const unmarkCall = auditedEntries(logAudit, auditTx).filter((c) => c.action === "invoice.marked_unpaid" && c.entityId === inv.id).map((c) => [c])[0]!;
    expect(unmarkCall[0].before).toMatchObject({ ackFileKey: firstAckKey, method: "Bank", reference: "REF-A" });
  });
});

describe("un-mark is Business Admin only, requires a reason", () => {
  it("Accounts cannot un-mark (forbidden), Business Admin can", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("BAONLY", 500);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "BAONLY", amount: 500, status: "Outstanding" as never } });
    expect((await markInvoicePaid(inv.id, fakePdfFile())).ok).toBe(true);

    who.session = ACCOUNTS;
    expect(await markInvoiceUnpaid(inv.id, "wrong role")).toEqual({ ok: false, error: "forbidden" });
    const stillPaid = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(stillPaid.status).toBe("Paid");

    who.session = BUSINESS_ADMIN;
    expect(await markInvoiceUnpaid(inv.id, "")).toEqual({ ok: false, error: "reasonRequired" });
    expect((await markInvoiceUnpaid(inv.id, "customer disputed the charge")).ok).toBe(true);
  });
});

describe("un-mark is refused when the transaction's commission is Approved or Paid", () => {
  let month = 0;
  async function settleLedgerLine(transactionId: string, payoutStatus: "Pending" | "Approved" | "Paid") {
    const payoutMonth = `2099-${String(++month).padStart(2, "0")}`; // unique per call — MonthlyPayout is unique on (associateId, payoutMonth, seq)
    const payout = await prisma.monthlyPayout.create({
      data: {
        payoutMonth, associateId: closerId, seq: 0, kind: "Regular" as never,
        associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: payoutStatus as never, totalPayable: 100,
      },
    });
    await prisma.commissionLedger.create({
      data: {
        transactionId, payoutMonth, associateId: closerId, associateName: "Closer",
        lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never,
        payoutId: payout.id,
      },
    });
  }

  it("refuses for an Approved payout, and for a Paid payout", async () => {
    who.session = BUSINESS_ADMIN;

    const txApproved = await mkTransaction("SETAPP", 500);
    const invApproved = await prisma.invoice.create({ data: { transactionId: txApproved.id, companyId, invoiceNumber: TAG + "SETAPP", amount: 500, status: "Outstanding" as never } });
    expect((await markInvoicePaid(invApproved.id, fakePdfFile())).ok).toBe(true);
    await settleLedgerLine(txApproved.id, "Approved");
    expect(await markInvoiceUnpaid(invApproved.id, "trying anyway")).toEqual({ ok: false, error: "payoutAlreadyApprovedOrPaid" });

    const txPaid = await mkTransaction("SETPAID", 500);
    const invPaid = await prisma.invoice.create({ data: { transactionId: txPaid.id, companyId, invoiceNumber: TAG + "SETPAID", amount: 500, status: "Outstanding" as never } });
    expect((await markInvoicePaid(invPaid.id, fakePdfFile())).ok).toBe(true);
    await settleLedgerLine(txPaid.id, "Paid");
    expect(await markInvoiceUnpaid(invPaid.id, "trying anyway")).toEqual({ ok: false, error: "payoutAlreadyApprovedOrPaid" });

    // Neither invoice actually moved.
    for (const id of [invApproved.id, invPaid.id]) {
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("Paid");
    }
  });

  it("still allows unmark when the payout is only Pending", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("SETPEND", 500);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "SETPEND", amount: 500, status: "Outstanding" as never } });
    expect((await markInvoicePaid(inv.id, fakePdfFile())).ok).toBe(true);
    await settleLedgerLine(tx.id, "Pending");
    expect((await markInvoiceUnpaid(inv.id, "fine to revert")).ok).toBe(true);
  });
});

describe("X1 (Architect): un-mark is refused for a legacy (unlinked) Approved/Paid payout too", () => {
  it("refuses while the associate's legacy payout for that month has no linked lines; allows once it's reconciled", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("LEGACY", 500);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "LEGACY", amount: 500, status: "Outstanding" as never } });
    expect((await markInvoicePaid(inv.id, fakePdfFile())).ok).toBe(true);

    // This transaction's own ledger line, still unlinked — no payout has run
    // for it yet, so refuseIfSettled's first (linked) check finds nothing.
    const line = await prisma.commissionLedger.create({
      data: {
        transactionId: tx.id, payoutMonth: "2098-01", associateId: closerId, associateName: "Closer",
        lineType: "Personal" as never, basisAmount: 500, amount: 500, eligibility: "Eligible" as never, status: "Eligible" as never,
      },
    });
    expect(line.payoutId).toBeNull();

    // A legacy (pre-M5) Paid payout for the SAME associate + month, with NO
    // linked lines at all (predates payoutId).
    const legacyPayout = await prisma.monthlyPayout.create({
      data: {
        payoutMonth: line.payoutMonth, associateId: closerId, seq: 0, kind: "Regular" as never,
        associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: "Paid" as never, totalPayable: 500,
      },
    });

    expect(await markInvoiceUnpaid(inv.id, "trying anyway")).toEqual({ ok: false, error: "legacyReconciliationPending" });

    // "Reconciled": the legacy payout gets ITS OWN linked line (from a
    // different, already-settled sale) — ledgerLines: none no longer
    // matches it — while this transaction's own line is untouched.
    const otherTx = await mkTransaction("LEGACYOTHER", 100);
    await prisma.commissionLedger.create({
      data: {
        transactionId: otherTx.id, payoutMonth: line.payoutMonth, associateId: closerId, associateName: "Closer",
        lineType: "Personal" as never, basisAmount: 100, amount: 100, eligibility: "Eligible" as never, status: "Eligible" as never,
        payoutId: legacyPayout.id,
      },
    });

    expect((await markInvoiceUnpaid(inv.id, "now fine")).ok).toBe(true);
  });
});

describe("K1 (DevSecOps): a refused mark-paid deletes its own orphaned ack, leaving exactly one file", () => {
  it("a double mark-paid click stores two files but deletes the losing one, leaving exactly one on disk", async () => {
    who.session = BUSINESS_ADMIN;
    const tx = await mkTransaction("ORPHAN", 500);
    const inv = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "ORPHAN", amount: 500, status: "Outstanding" as never } });

    const storage = await import("@/lib/storage");
    const putSpy = vi.spyOn(storage, "putObject");
    const deleteSpy = vi.spyOn(storage, "deleteObject");

    const r1 = await markInvoicePaid(inv.id, fakePdfFile());
    expect(r1.ok).toBe(true);
    const r2 = await markInvoicePaid(inv.id, fakePdfFile()); // already Paid -> refused
    expect(r2).toEqual({ ok: false, error: "alreadyProcessed" });

    expect(putSpy).toHaveBeenCalledTimes(2); // both uploads were stored...
    const [firstKey] = putSpy.mock.calls[0];
    const [secondKey] = putSpy.mock.calls[1];
    expect(deleteSpy).toHaveBeenCalledExactlyOnceWith(secondKey); // ...but only the losing one is deleted

    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paymentAckFileKey).toBe(firstKey); // the winner's file is untouched
    expect(await storage.getObject(firstKey)).not.toBeNull();
    expect(await storage.getObject(secondKey)).toBeNull(); // the loser's file is gone

    putSpy.mockRestore();
    deleteSpy.mockRestore();
  });
});
