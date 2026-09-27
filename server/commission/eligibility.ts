import { CommissionEligibility, PaymentPlan, InvoiceStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { runCommissionTx, auditRunResultTx, COMMISSION_TX_OPTIONS } from "./run";

/**
 * The transactional body of a recompute: lock, read, decide eligibility, write
 * if changed, then re-run the engine (idempotent) so ledger lines flip
 * Pending<->Eligible in the SAME transaction as the eligibility write (R-4) —
 * eligibility and the ledger can never disagree.
 * - Full Payment: Eligible once its invoice(s) are Paid.
 * - Installment: Eligible once >= min(threshold, N) REAL installments are
 *   paid, where N is the plan's own installment count — a plan with fewer
 *   real installments than the configured threshold (e.g. a 2-instalment
 *   plan under the default 3rd) needs ALL N paid, not the raw threshold,
 *   since the threshold is env-configurable and a hard schema minimum would
 *   drift or forbid a legitimate short plan. A plan needs at least one real
 *   installment to ever become Eligible — an empty schedule always stays
 *   PendingCollection, it never trivially satisfies min(threshold, 0) = 0.
 *   The deposit (sequence 0, the project owner Q9) is the entry fee, not one of the N
 *   installments, so it never counts toward paidCount or N.
 *
 * Callers that already hold the FOR UPDATE lock on this sales_transactions row
 * (A-0's unified mark-paid/unpaid transaction) pass their own `db` — the lock
 * below is then re-entrant (a no-op re-acquire of a lock this same DB
 * transaction already holds). A caller with no existing transaction should go
 * through `recomputeEligibility` instead, which opens one and audits after.
 */
export async function recomputeEligibilityTx(db: Prisma.TransactionClient, transactionId: string) {
  await db.$queryRaw`SELECT id FROM sales_transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
  const tx = await db.salesTransaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: { installmentPlan: { include: { schedule: true } }, invoices: true },
  });

  let eligibility: CommissionEligibility;
  if (tx.paymentPlan === PaymentPlan.FullPayment) {
    const allPaid = tx.invoices.length > 0 && tx.invoices.every((i) => i.status === InvoiceStatus.Paid);
    eligibility = allPaid ? CommissionEligibility.Eligible : CommissionEligibility.PendingCollection;
  } else {
    const realInstalments = tx.installmentPlan?.schedule.filter((s) => s.sequence > 0) ?? [];
    const paidCount = realInstalments.filter((s) => s.paid).length;
    const effectiveThreshold = Math.min(env.COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD, realInstalments.length);
    eligibility =
      realInstalments.length > 0 && paidCount >= effectiveThreshold
        ? CommissionEligibility.Eligible
        : CommissionEligibility.PendingCollection;
  }

  if (eligibility !== tx.commissionEligibility) {
    await db.salesTransaction.update({
      where: { id: transactionId },
      data: { commissionEligibility: eligibility },
    });
  }
  const run = await runCommissionTx(db, transactionId);
  return { eligibility, run };
}

/** Thin wrapper for callers outside an existing transaction. */
export async function recomputeEligibility(transactionId: string, actorUserId: string | null): Promise<CommissionEligibility> {
  const result = await prisma.$transaction(async (db) => {
    const r = await recomputeEligibilityTx(db, transactionId);
    await auditRunResultTx(db, transactionId, r.run, actorUserId); // Tier A: inside, rolls back together
    return r;
  }, COMMISSION_TX_OPTIONS);
  return result.eligibility;
}
