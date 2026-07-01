import { CommissionEligibility, PaymentPlan, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { runCommission } from "./run";

/**
 * Recompute a transaction's commission eligibility from its collections, then
 * re-run the engine (idempotent) so ledger lines flip Pending<->Eligible.
 * - Full Payment: Eligible once its invoice(s) are Paid.
 * - Installment: Eligible once >= threshold installments are paid (default 3rd).
 */
export async function recomputeEligibility(transactionId: string): Promise<CommissionEligibility> {
  const tx = await prisma.salesTransaction.findUniqueOrThrow({
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
    await prisma.salesTransaction.update({
      where: { id: transactionId },
      data: { commissionEligibility: eligibility },
    });
  }
  await runCommission(transactionId);
  return eligibility;
}
