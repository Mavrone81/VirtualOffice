// A-0 — two invoices on the SAME transaction marked Paid concurrently must
// never lose one's contribution to amountCollected. Deterministic interleaving,
// same technique as server/commission/c1-runcommission-approval-race.
// integration.test.ts: a Proxy on the first mark-paid's transaction client
// fires the second mark-paid right after computeAmountCollected's first read
// (i.e. inside the FOR UPDATE critical section) and races it against a
// timeout. With the lock, the second call must block until the first
// commits; without it (see the "without the lock" case below, which calls a
// local copy of computeAmountCollected with the FOR UPDATE line removed),
// the second call's stale read lets it overwrite the first's contribution.
// Needs a local PG (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WINDOW_MS = 300;

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import type { Prisma } from "@prisma/client";
import { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { markInvoicePaid } from "@/server/invoices/actions";
import { ZERO, clamp, round2, sum } from "@/lib/money";

const TAG = "A0RACE-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", closerId = "";

async function mkTransactionWithTwoInvoices(code: string, saleAmount: number, amtA: number, amtB: number) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-05-01"), clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-05-01"),
      clientName: TAG + code, saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0,
    },
  });
  const invA = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + code + "A", amount: amtA, status: "Outstanding" as never } });
  const invB = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: TAG + code + "B", amount: amtB, status: "Outstanding" as never } });
  return { tx, invA, invB };
}

/** computeAmountCollected's logic MINUS the FOR UPDATE lock — the counterfactual. */
async function computeAmountCollectedNoLock(tx: Prisma.TransactionClient, transactionId: string) {
  const [txn, invoices, installments] = await Promise.all([
    tx.salesTransaction.findUniqueOrThrow({ where: { id: transactionId }, select: { saleAmount: true } }),
    tx.invoice.findMany({ where: { transactionId, status: InvoiceStatus.Paid }, select: { amount: true } }),
    tx.installmentSchedule.findMany({ where: { plan: { transactionId }, paid: true }, select: { dueAmount: true } }),
  ]);
  const collected = sum([...invoices.map((i) => i.amount), ...installments.map((s) => s.dueAmount)]);
  const next = clamp(round2(collected), ZERO, txn.saleAmount);
  await tx.salesTransaction.update({ where: { id: transactionId }, data: { amountCollected: next } });
  return next;
}

async function markPaidNoLock(invoiceId: string, transactionId: string) {
  await prisma.$transaction(async (dbtx) => {
    await dbtx.invoice.updateMany({ where: { id: invoiceId, status: { not: InvoiceStatus.Paid } }, data: { status: InvoiceStatus.Paid, paidDate: new Date() } });
    await computeAmountCollectedNoLock(dbtx, transactionId);
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
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("amountCollected: two invoices on the same transaction marked Paid concurrently", () => {
  it("WITH the FOR UPDATE lock: the second call blocks, and both contributions land", async () => {
    who.session = ADMIN;
    const { tx, invA, invB } = await mkTransactionWithTwoInvoices("LOCK", 1000, 600, 400);

    let second: Promise<unknown> = Promise.resolve();
    let secondState = "not-fired";
    const orig = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (db: Prisma.TransactionClient) => Promise<unknown>, opts?: unknown) =>
      orig(async (db: Prisma.TransactionClient) => {
        const realFindMany = db.invoice.findMany.bind(db.invoice) as (...a: unknown[]) => Promise<unknown>;
        let fired = false;
        const wrappedInvoice = new Proxy(db.invoice, {
          get(t, k) {
            if (k === "findMany") return async (...a: unknown[]) => {
              const r = await realFindMany(...a);
              if (!fired) {
                fired = true;
                second = markInvoicePaid(invB.id);
                secondState = await Promise.race([second.then(() => "committed-in-window"), sleep(WINDOW_MS).then(() => "blocked")]);
              }
              return r;
            };
            return Reflect.get(t, k);
          },
        });
        const dbProxy = new Proxy(db, { get(t, k) { return k === "invoice" ? wrappedInvoice : Reflect.get(t, k); } });
        return fn(dbProxy);
      }, opts)) as never);

    await markInvoicePaid(invA.id); // the FIRST call — its computeAmountCollected read is where we inject
    spy.mockRestore();
    await second;

    // The lock made the second call wait for the first to commit.
    expect(secondState).toBe("blocked");

    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    // No lost update: both invoices' amounts landed, whichever order they committed in.
    expect(row.amountCollected.toFixed(2)).toBe("1000.00");
  }, 10_000);

  it("WITHOUT the lock (counterfactual): the second call's stale read overwrites the first's contribution", async () => {
    who.session = ADMIN;
    const { tx, invA, invB } = await mkTransactionWithTwoInvoices("NOLOCK", 1000, 600, 400);

    let second: Promise<unknown> = Promise.resolve();
    const orig = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (db: Prisma.TransactionClient) => Promise<unknown>, opts?: unknown) =>
      orig(async (db: Prisma.TransactionClient) => {
        const realFindMany = db.invoice.findMany.bind(db.invoice) as (...a: unknown[]) => Promise<unknown>;
        let fired = false;
        const wrappedInvoice = new Proxy(db.invoice, {
          get(t, k) {
            if (k === "findMany") return async (...a: unknown[]) => {
              const r = await realFindMany(...a);
              if (!fired) {
                fired = true;
                // No lock held here (this test's transaction never takes FOR UPDATE),
                // so the second call's own read-then-write runs concurrently and
                // completes well inside the window.
                second = markPaidNoLock(invB.id, tx.id);
                await Promise.race([second, sleep(WINDOW_MS)]);
              }
              return r;
            };
            return Reflect.get(t, k);
          },
        });
        const dbProxy = new Proxy(db, { get(t, k) { return k === "invoice" ? wrappedInvoice : Reflect.get(t, k); } });
        return fn(dbProxy);
      }, opts)) as never);

    await markPaidNoLock(invA.id, tx.id); // the FIRST call, also lock-free
    spy.mockRestore();
    await second;

    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    // Lost update: the first call's read (only A paid at that point) computed 600 and
    // wrote it AFTER the second call's 400, stomping B's contribution.
    expect(row.amountCollected.toFixed(2)).toBe("600.00");
    expect(row.amountCollected.toFixed(2)).not.toBe("1000.00");
  }, 10_000);
});
