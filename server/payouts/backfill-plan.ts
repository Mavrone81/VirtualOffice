import { Prisma, LedgerStatus, PayoutStatus, type PrismaClient } from "@prisma/client";
import { payoutTotalsFromLines } from "./totals";

/**
 * M5 backfill PLAN — read-only. Payouts approved/paid before `commission_ledger.payout_id`
 * existed have no lines attached; runPayouts refuses to run a month that has any.
 * For each such payout this works out which ledger lines it settled: the month's
 * Eligible, still-unattached lines of that associate, which is exactly what the old
 * runPayouts summed. Attaching is proposed ONLY when those lines add up to the
 * payout's total to the cent, the total is positive, and the payout does not look
 * overwritten after it was paid; anything else needs a human.
 *
 * Also flags Paid payouts written after their paid date — the M5 overwrite
 * signature (their earlier amount is not recoverable from the audit trail).
 */
export type PayoutBackfillRow = {
  payoutId: string;
  payoutMonth: string;
  status: PayoutStatus;
  payoutTotal: string;
  linesTotal: string;
  lineIds: string[];
  action: "attach" | "manual-mismatch" | "manual-no-lines" | "manual-overwritten" | "manual-non-positive";
  possiblyOverwritten: boolean;
};

const OVERWRITE_GRACE_MS = 60_000; // paid_date and updated_at are written by the same statement

export async function planPayoutBackfill(db: PrismaClient | Prisma.TransactionClient): Promise<PayoutBackfillRow[]> {
  const legacy = await db.monthlyPayout.findMany({
    where: { payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] }, ledgerLines: { none: {} } },
    orderBy: [{ payoutMonth: "asc" }, { id: "asc" }],
  });

  const rows: PayoutBackfillRow[] = [];
  for (const p of legacy) {
    const lines = await db.commissionLedger.findMany({
      where: { associateId: p.associateId, payoutMonth: p.payoutMonth, status: LedgerStatus.Eligible, payoutId: null },
      select: { id: true, lineType: true, amount: true },
    });
    const linesTotal = payoutTotalsFromLines(lines).totalPayable;
    const possiblyOverwritten =
      p.payoutStatus === PayoutStatus.Paid && !!p.paidDate && p.updatedAt.getTime() - p.paidDate.getTime() > OVERWRITE_GRACE_MS;
    // Never auto-link when the recorded total may not be what was actually paid: an
    // overwritten Paid payout's lines add up to the REWRITTEN total, so linking them
    // would mark the late lines as settled although they were never paid.
    const action: PayoutBackfillRow["action"] =
      lines.length === 0 ? "manual-no-lines"
      : possiblyOverwritten ? "manual-overwritten"
      : p.totalPayable.lte(0) ? "manual-non-positive"
      : linesTotal.equals(p.totalPayable) ? "attach"
      : "manual-mismatch";
    rows.push({
      payoutId: p.id,
      payoutMonth: p.payoutMonth,
      status: p.payoutStatus,
      payoutTotal: p.totalPayable.toFixed(2),
      linesTotal: linesTotal.toFixed(2),
      lineIds: lines.map((l) => l.id),
      action,
      possiblyOverwritten,
    });
  }
  return rows;
}
