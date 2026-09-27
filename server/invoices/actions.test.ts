// A-0 (M4) — marking an invoice/installment paid (or un-marking it) must move
// SalesTransaction.amountCollected in the SAME DB transaction, clamped to
// [0, saleAmount], and the Received/Receivable split (which filters on
// amountCollected — server/transactions/queries.ts) must reflect it. Real
// throwaway Postgres (needs DATABASE_URL); fake data only, all rows tagged
// and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { markInvoicePaid, markInvoiceUnpaid, markInstallmentPaid, markInstallmentUnpaid } from "./actions";
import { visibleTransactions } from "@/server/transactions/queries";
import { logAudit } from "@/lib/audit";
import { fakePdfFile } from "@/lib/test-fixtures";

const TAG = "A0AMT-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", closerId = "";

async function mkTransaction(code: string, saleAmount: number) {
  const closer = await prisma.associate.findUniqueOrThrow({ where: { id: closerId }, select: { id: true } });
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2099-03-01"), clientName: TAG + code, saleAmount,
      paymentPlan: "FullPayment" as never, closingAssociateId: closer.id, amountCollected: 0,
    },
    select: { id: true },
  });
  return prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-03-01"),
      clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never,
      closingAssociateId: closer.id, amountCollected: 0,
    },
  });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: {
      associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
    },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transaction: { closingAssociateId: closerId } } } });
  await prisma.installmentPlan.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("markInvoicePaid / markInvoiceUnpaid — amountCollected", () => {
  it("increments on Paid, decrements on Unpaid, in step with the invoice status", async () => {
    who.session = ADMIN;
    const tx = await mkTransaction("INV1", 1000);
    const invoice = await prisma.invoice.create({
      data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "INV1", amount: 1000, status: "Outstanding" as never },
    });

    expect((await markInvoicePaid(invoice.id, fakePdfFile(), { method: "Bank" as never })).ok).toBe(true);
    let row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("1000.00");

    // Received/Receivable must reflect the write immediately (same query the
    // portal "My Transaction Received"/"Receivable" tabs use).
    const received = await visibleTransactionsAs(ADMIN, "received");
    expect(received!.some((r) => r.id === tx.id)).toBe(true);
    const receivable = await visibleTransactionsAs(ADMIN, "receivable");
    expect(receivable!.some((r) => r.id === tx.id)).toBe(false);

    // A repeat mark-paid on an already-Paid invoice is refused (a double-click,
    // not a fresh payment) and must not double-count.
    expect(await markInvoicePaid(invoice.id, fakePdfFile(), { method: "Bank" as never })).toEqual({ ok: false, error: "alreadyProcessed" });
    row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("1000.00");

    expect((await markInvoiceUnpaid(invoice.id, "test reason")).ok).toBe(true);
    row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("0.00");

    // Refused the other way too.
    expect(await markInvoiceUnpaid(invoice.id, "test reason")).toEqual({ ok: false, error: "alreadyProcessed" });
    row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("0.00");
  });

  it("clamps at the sale amount, but audits and flags the over-collection instead of hiding it (M1)", async () => {
    who.session = ADMIN;
    const tx = await mkTransaction("INV2", 500);
    // Two invoices summing to more than the sale — a data anomaly, but the
    // clamp must hold anyway (acceptance criterion: never above the sale).
    const inv1 = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "INV2A", amount: 500, status: "Outstanding" as never } });
    const inv2 = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "INV2B", amount: 300, status: "Outstanding" as never } });

    vi.mocked(logAudit).mockClear();
    const r1 = await markInvoicePaid(inv1.id, fakePdfFile());
    expect(r1.ok).toBe(true);
    expect(r1.overCollected).toBeUndefined(); // 500 of 500 — not over yet

    const r2 = await markInvoicePaid(inv2.id, fakePdfFile());
    expect(r2.ok).toBe(true);
    expect(r2.overCollected).toBe(true); // 800 raw > 500 sale — flagged, not hidden
    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("500.00"); // still clamped, not 800

    const overCollectedAudits = vi.mocked(logAudit).mock.calls.filter((c) => c[0].action === "transaction.over_collected");
    expect(overCollectedAudits).toHaveLength(1);
    expect(overCollectedAudits[0][0]).toMatchObject({
      entityType: "SalesTransaction", entityId: tx.id, actorUserId: ADMIN.user.id, after: { raw: "800.00", saleAmount: "500.00" },
    });

    // Unwinding the second (unclamped) invoice must not push it negative.
    expect((await markInvoiceUnpaid(inv2.id, "test reason")).ok).toBe(true);
    const row2 = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(Number(row2.amountCollected)).toBeGreaterThanOrEqual(0);
  });

  it("self-heals a drifted stored value instead of compounding it", async () => {
    who.session = ADMIN;
    const tx = await mkTransaction("INV3", 1000);
    const invA = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "INV3A", amount: 700, status: "Outstanding" as never } });
    expect((await markInvoicePaid(invA.id, fakePdfFile())).ok).toBe(true);

    // Simulate legacy drift: something (a past bug, a manual fix) left the
    // stored column wrong, disagreeing with the actual paid invoices.
    await prisma.salesTransaction.update({ where: { id: tx.id }, data: { amountCollected: 0 } });

    const invB = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "INV3B", amount: 200, status: "Outstanding" as never } });
    expect((await markInvoicePaid(invB.id, fakePdfFile())).ok).toBe(true);

    // A naive +200 on the corrupted 0 would read 200.00. Recomputing from the
    // actual paid invoices (700 + 200) corrects invA's contribution too.
    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("900.00");
  });
});

describe("a lock-wait timeout (P2028) saves nothing, and a retry succeeds", () => {
  it("leaves the invoice Outstanding, amountCollected unchanged, and audits nothing — then retrying works", async () => {
    who.session = ADMIN;
    const tx = await mkTransaction("P2028", 1000);
    const invoice = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + "P2028", amount: 1000, status: "Outstanding" as never } });

    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Transaction timed out", { code: "P2028", clientVersion: "6" }));
    vi.mocked(logAudit).mockClear();

    const r = await markInvoicePaid(invoice.id, fakePdfFile());
    expect(r).toEqual({ ok: false, error: "recomputeBusy" });
    expect(spy).toHaveBeenCalledOnce();

    // Nothing was saved: the whole transaction rolled back.
    const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invAfter.status).toBe("Outstanding");
    const txAfter = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txAfter.amountCollected.toFixed(2)).toBe("0.00");
    expect(logAudit).not.toHaveBeenCalled();

    // The mock was one-shot ($transaction now behaves normally again) — a retry succeeds.
    const retry = await markInvoicePaid(invoice.id, fakePdfFile());
    expect(retry.ok).toBe(true);
    const txRetried = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txRetried.amountCollected.toFixed(2)).toBe("1000.00");
  });
});

describe("markInstallmentPaid / markInstallmentUnpaid — amountCollected", () => {
  it("increments/decrements by the installment's dueAmount", async () => {
    who.session = ADMIN;
    const tx = await mkTransaction("INS1", 900);
    const plan = await prisma.installmentPlan.create({ data: { transactionId: tx.id, totalAmount: 900, deposit: 0, installmentCount: 3 } });
    const s1 = await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 1, dueAmount: 300, paid: false } });
    const s2 = await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 2, dueAmount: 300, paid: false } });

    expect((await markInstallmentPaid(s1.id, fakePdfFile())).ok).toBe(true);
    let row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("300.00");

    expect((await markInstallmentPaid(s2.id, fakePdfFile())).ok).toBe(true);
    row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("600.00");

    expect((await markInstallmentUnpaid(s1.id, "test reason")).ok).toBe(true);
    row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.amountCollected.toFixed(2)).toBe("300.00");
  });
});

async function visibleTransactionsAs(session: unknown, variant: "received" | "receivable") {
  const prev = who.session;
  who.session = session;
  const rows = await visibleTransactions(variant);
  who.session = prev;
  return rows;
}
