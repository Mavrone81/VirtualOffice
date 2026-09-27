import { CommissionEligibility, PaymentPlan, InvoiceStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { runCommissionTx, auditRunResult, COMMISSION_TX_OPTIONS } from "./run";

/**
 * The transactional body of a recompute: lock, read, decide eligibility, write
 * if changed, then re-run the engine (idempotent) so ledger lines flip
 * Pending<->Eligible in the SAME transaction as the eligibility write (R-4) —
 * eligibility and the ledger can never disagree.
 * - Full Payment: Eligible once its invoice(s) are Paid.
 * - Installment: Eligible once >= threshold REAL installments are paid
 *   (default 3rd) — the deposit (sequence 0, Samuel Q9) is the entry fee, not
 *   one of the N installments, so it never counts toward the threshold.
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
    const threshold = env.COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD;
    const paidCount = tx.installmentPlan?.schedule.filter((s) => s.paid && s.sequence > 0).length ?? 0;
    eligibility =
      paidCount >= threshold ? CommissionEligibility.Eligible : CommissionEligibility.PendingCollection;
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
export async function recomputeEligibility(transactionId: string): Promise<CommissionEligibility> {
  const result = await prisma.$transaction((db) => recomputeEligibilityTx(db, transactionId), COMMISSION_TX_OPTIONS);
  await auditRunResult(transactionId, result.run);
  return result.eligibility;
}
