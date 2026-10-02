import { LedgerLineType, LedgerStatus, PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Money } from "@/lib/money";

export type MyOverridesSummary = {
  overall: Money;
  received: Money;
};

/**
 * "My Overrides" for one associate, scoped to a single payout month
 * ("YYYY-MM"). Two figures, not one:
 * - `overall`: every non-Cancelled Override-line amount for that month,
 *   regardless of payout status.
 * - `received`: the same lines, further restricted to ones settled in a
 *   payout with payout.payoutStatus === Paid — NOT LedgerStatus.Paid, which
 *   nothing in the app ever sets (same A-0/R-6 derivation already used by
 *   lib/my-share.ts / server/dashboard/my-commissions.ts /
 *   server/dashboard/metrics.ts; using LedgerStatus.Paid here would show
 *   "received" as permanently zero).
 */
export async function myOverridesSummary(associateId: string, payoutMonth: string): Promise<MyOverridesSummary> {
  const [overallAgg, receivedAgg] = await Promise.all([
    prisma.commissionLedger.aggregate({
      where: {
        associateId,
        lineType: LedgerLineType.Override,
        payoutMonth,
        status: { not: LedgerStatus.Cancelled },
      },
      _sum: { amount: true },
    }),
    prisma.commissionLedger.aggregate({
      where: {
        associateId,
        lineType: LedgerLineType.Override,
        payoutMonth,
        status: { not: LedgerStatus.Cancelled },
        payout: { payoutStatus: PayoutStatus.Paid },
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    overall: D(overallAgg._sum.amount ?? 0),
    received: D(receivedAgg._sum.amount ?? 0),
  };
}
