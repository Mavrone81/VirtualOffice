// A-0 — stress variant of the two-connection race test (PD's condition for
// the W2-a gate). Real Postgres, many rounds, a randomized mix of mark-paid,
// unmark-paid AND a bare recompute (the operation shape a future backfill
// APPLY would run per row — lock, recompute from source rows, write, no
// status change) firing concurrently on the SAME transaction. After every
// round: amountCollected must equal the true sum of currently-Paid invoices
// (no lost update), stay within [0, saleAmount], and every successful
// mark/unmark must have exactly one matching audit entry. A timeout
// ("recomputeBusy") is an allowed outcome — the invariants must still hold
// after it. Needs a local PG (DATABASE_URL); fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { prisma } from "@/lib/db";
import { markInvoicePaid, markInvoiceUnpaid } from "@/server/invoices/actions";
import { fakePdfFile } from "@/lib/test-fixtures";
import { recomputeAmountCollected } from "@/server/transactions/amount-collected";
import { COMMISSION_TX_OPTIONS } from "@/server/commission/run";
import { auditTx } from "@/lib/audit";

const TAG = "A0STRESS-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const N_INVOICES = 10;
const ROUNDS = 50;
let companyId = "", closerId = "", transactionId = "";
const invoiceIds: string[] = [];

/** Seeded PRNG (mulberry32) so a failing run can be replayed exactly — pass
 * A0STRESS_SEED to reproduce a specific run; otherwise a fresh seed is
 * printed up front. */
const SEED = process.env.A0STRESS_SEED ? Number(process.env.A0STRESS_SEED) : (Date.now() ^ 0x9e3779b9) >>> 0;
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

/** The shape a future backfill APPLY would run per row: lock, recompute from
 * source rows, write — no status change. Reuses the exact production helper. */
async function recomputeOnly(txId: string) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM sales_transactions WHERE id = ${txId}::uuid FOR UPDATE`;
    return recomputeAmountCollected(db, txId);
  }, COMMISSION_TX_OPTIONS);
}

async function trueCollected(): Promise<string> {
  const paid = await prisma.invoice.findMany({ where: { transactionId, status: "Paid" as never }, select: { amount: true } });
  return paid.reduce((s, i) => s + Number(i.amount), 0).toFixed(2);
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  const saleAmount = N_INVOICES * 100;
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-12-01"), clientName: TAG + "Client", saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + "TXN", submissionId: sub.id, salesDate: new Date("2099-12-01"),
      clientName: TAG + "Client", saleAmount, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0,
    },
  });
  transactionId = tx.id;
  for (let i = 0; i < N_INVOICES; i++) {
    const inv = await prisma.invoice.create({ data: { transactionId, companyId, invoiceNumber: `${TAG}INV${i}`, amount: 100, status: "Outstanding" as never } });
    invoiceIds.push(inv.id);
  }
}, 30_000);

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { transactionId } });
  await prisma.salesTransaction.deleteMany({ where: { id: transactionId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe(`amountCollected stress: ${ROUNDS} rounds of concurrent mark/unmark/recompute`, () => {
  it("holds every invariant after every round", async () => {
    who.session = ADMIN;
    const start = Date.now();
    console.log(`[amountCollected stress] seed=${SEED} (set A0STRESS_SEED=${SEED} to replay)`);

    try {
      for (let round = 0; round < ROUNDS; round++) {
        const invoices = await prisma.invoice.findMany({ where: { transactionId }, select: { id: true, status: true } });
        const outstanding = invoices.filter((i) => i.status === "Outstanding").map((i) => i.id);
        const paid = invoices.filter((i) => i.status === "Paid").map((i) => i.id);

        const pick = <T>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(rand() * xs.length)] : undefined);
        const ops: { kind: "pay" | "unpay" | "recompute"; invoiceId?: string }[] = [];
        const nOps = 2 + Math.floor(rand() * 2); // 2-3 concurrent ops per round
        for (let i = 0; i < nOps; i++) {
          const roll = rand();
          if (roll < 0.4) { const id = pick(outstanding); if (id) ops.push({ kind: "pay", invoiceId: id }); }
          else if (roll < 0.8) { const id = pick(paid); if (id) ops.push({ kind: "unpay", invoiceId: id }); }
          else ops.push({ kind: "recompute" });
        }
        if (ops.length === 0) ops.push({ kind: "recompute" }); // never an empty round

        const auditCountBefore = vi.mocked(auditTx).mock.calls.length; // Tier A: marks are audited in-transaction
        const results = await Promise.allSettled(
          ops.map((op) => {
            if (op.kind === "pay") return markInvoicePaid(op.invoiceId!, fakePdfFile());
            if (op.kind === "unpay") return markInvoiceUnpaid(op.invoiceId!, "stress test unmark");
            return recomputeOnly(transactionId);
          }),
        );

        // No error escapes: every op either resolves ok, refuses cleanly
        // (alreadyProcessed / recomputeBusy — a timeout is an allowed outcome),
        // or (recomputeOnly) just resolves with the recomputed value.
        for (const r of results) expect(r.status).toBe("fulfilled");

        const marks = ops
          .map((op, i) => ({ op, r: results[i] as PromiseFulfilledResult<unknown> }))
          .filter(({ op }) => op.kind !== "recompute");
        const auditCalls = vi.mocked(auditTx).mock.calls.slice(auditCountBefore).map((c) => [c[1]] as const);

        // Group by (invoiceId, kind): two ops of the same kind can legitimately
        // target the same invoice concurrently in one round (one wins the CAS,
        // the rest are refused), so audits are checked per group, not per op —
        // "exactly one audit per success" AND "zero for a refusal" collapse
        // into one check: matching audits === successes in that group.
        const groups = new Map<string, { successes: number; kind: "pay" | "unpay" }>();
        for (const { op, r } of marks) {
          const key = `${op.kind}:${op.invoiceId}`;
          const g = groups.get(key) ?? { successes: 0, kind: op.kind as "pay" | "unpay" };
          if ((r.value as { ok: boolean }).ok === true) g.successes++;
          groups.set(key, g);
        }
        for (const [key, g] of groups) {
          const invoiceId = key.slice(key.indexOf(":") + 1);
          expect(g.successes).toBeLessThanOrEqual(1); // CAS: at most one winner per (invoice, kind) per round
          const expectedAction = g.kind === "pay" ? "invoice.marked_paid" : "invoice.marked_unpaid";
          const matches = auditCalls.filter((c) => c[0].action === expectedAction && c[0].entityId === invoiceId);
          expect(matches).toHaveLength(g.successes);
        }

        // Invariants, real Postgres read, independent of what any op computed.
        const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: transactionId } });
        expect(row.amountCollected.toFixed(2)).toBe(await trueCollected()); // no lost update
        expect(Number(row.amountCollected)).toBeGreaterThanOrEqual(0);
        expect(Number(row.amountCollected)).toBeLessThanOrEqual(N_INVOICES * 100);
      }
    } catch (e) {
      console.error(`[amountCollected stress] FAILED — replay with A0STRESS_SEED=${SEED}`);
      throw e;
    }

    const ms = Date.now() - start;
    console.log(`[amountCollected stress] ${ROUNDS} rounds in ${ms}ms (${(ms / ROUNDS).toFixed(1)}ms/round)`);
  }, 120_000);
});
