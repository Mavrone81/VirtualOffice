import type { Prisma } from "@prisma/client";
import { InvoiceStatus } from "@prisma/client";
import { ZERO, clamp, round2, sum } from "@/lib/money";

export type AmountCollectedResult = {
  value: Prisma.Decimal; // written; clamped to [0, saleAmount]
  /** Set when the raw (unclamped) sum exceeds saleAmount — a duplicate invoice
   * or a schedule bug, never auto-corrected further than the clamp. */
  overCollected: { raw: string; saleAmount: string } | null;
};

/**
 * Recompute a transaction's amountCollected from the paid invoices/installments
 * that actually exist for it — Σ paid invoice amounts + Σ paid installment
 * dueAmounts — clamped to [0, saleAmount], and writes the clamped result.
 * Deriving from scratch (rather than +/- a delta) means the write is
 * idempotent and self-heals any drift in the stored column (legacy data, a
 * past bug, a corrupted value); the backfill script computes the same thing
 * read-only for its dry run.
 *
 * M1 (Architect money review): the clamp still hides over-collection unless
 * the caller acts on `overCollected` — a duplicate invoice or a schedule bug
 * whose raw sum exceeds the sale is never auto-corrected further than the
 * clamp, per `migration-designs.md` §1. Callers audit `transaction.
 * over_collected` and surface the flag; this function only detects it.
 *
 * Does NOT take its own row lock: the caller (A-0's unified mark-paid/unpaid
 * transaction in server/invoices/actions.ts) takes the FOR UPDATE lock on this
 * sales_transactions row FIRST, before the invoice/installment CAS update, and
 * holds it for the whole transaction — including this call.
 */
export async function recomputeAmountCollected(db: Prisma.TransactionClient, transactionId: string): Promise<AmountCollectedResult> {
  const [txn, invoices, installments] = await Promise.all([
    db.salesTransaction.findUniqueOrThrow({ where: { id: transactionId }, select: { saleAmount: true } }),
    db.invoice.findMany({ where: { transactionId, status: InvoiceStatus.Paid }, select: { amount: true } }),
    db.installmentSchedule.findMany({ where: { plan: { transactionId }, paid: true }, select: { dueAmount: true } }),
  ]);
  const raw = round2(sum([...invoices.map((i) => i.amount), ...installments.map((s) => s.dueAmount)]));
  const value = clamp(raw, ZERO, txn.saleAmount);
  await db.salesTransaction.update({ where: { id: transactionId }, data: { amountCollected: value } });
  return {
    value,
    overCollected: raw.gt(txn.saleAmount) ? { raw: raw.toFixed(2), saleAmount: txn.saleAmount.toFixed(2) } : null,
  };
}
