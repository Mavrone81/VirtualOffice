import { CommissionEligibility, PaymentPlan, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { runCommissionTx, auditRunResult, COMMISSION_TX_OPTIONS } from "./run";

/**
 * Recompute a transaction's commission eligibility from its collections, then
 * re-run the engine (idempotent) so ledger lines flip Pending<->Eligible.
 * - Full Payment: Eligible once its invoice(s) are Paid.
 * - Installment: Eligible once >= threshold installments are paid (default 3rd).
 *
 * R-4: the eligibility read+write and the ledger recompute now happen in ONE
 * transaction (runCommissionTx's own FOR UPDATE lock is the first statement),
 * so eligibility and the ledger can never disagree — a concurrent recompute
 * either hasn't started yet (blocks on the lock) or has already committed
 * (this read sees it), never a stale snapshot from before it.
 */
export async function recomputeEligibility(transactionId: string): Promise<CommissionEligibility> {
  const result = await prisma.$transaction(async (db) => {
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
      const paidCount = tx.installmentPlan?.schedule.filter((s) => s.paid).length ?? 0;
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
  }, COMMISSION_TX_OPTIONS);

  await auditRunResult(transactionId, result.run);
  return result.eligibility;
}

/**
 * recomputeEligibility wrapped so a lock-wait timeout (P2028 — R-4's tx can genuinely
 * wait behind another recompute) is reported instead of thrown.
 *
 * Contract for the caller (Backend, A-0): this must NOT be read as "the payment wasn't
 * recorded" — mark-paid/unpaid already committed its own row update before calling this,
 * and that write must still be audited on the `deferred` path. The caller should:
 *   1. still return ok:true from the mark-paid/unpaid action (the payment IS recorded);
 *   2. surface a soft warning (the `errors.recomputeBusy` i18n key) rather than an error;
 *   3. audit the row change either way, with a `recomputeDeferred: true` marker when this
 *      returns `deferred`;
 *   4. make a REPEAT call to the mark-paid/unpaid action re-run this recompute even
 *      when the row is already in its target state (i.e. no CAS on "already Paid" that
 *      would skip straight past the recompute) — deferred eligibility only clears once
 *      this succeeds.
 */
export async function recomputeEligibilityOrDeferred(
  transactionId: string,
): Promise<{ deferred: false; eligibility: CommissionEligibility } | { deferred: true }> {
  try {
    return { deferred: false, eligibility: await recomputeEligibility(transactionId) };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") return { deferred: true };
    throw e;
  }
}
