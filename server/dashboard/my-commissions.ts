import { LedgerStatus, PayoutStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { EXCLUDE_MD_CUT } from "@/server/commission/md-visibility";

export type CommissionLedgerRow = Prisma.CommissionLedgerGetPayload<{
  include: { transaction: true; payout: { select: { payoutStatus: true } } };
}>;

export type MyCommissionsSummary = {
  ledger: CommissionLedgerRow[];
  eligible: ReturnType<typeof D>;
  pending: ReturnType<typeof D>;
  paid: ReturnType<typeof D>;
};

/**
 * "My Commissions" (app/portal/commissions) for one associate: the raw
 * ledger rows for the table (latest 100, for display only), plus the three
 * stat-tile totals — aggregated in Postgres over ALL of the associate's
 * lines, independent of the table's pagination (Architect review C2: the
 * totals used to come from the same `take: 100` fetch as the table, so an
 * associate with more than 100 lines saw truncated tiles).
 *
 * - `paid` follows the A-0/R-6 derivation — a line counts as paid only once
 *   it's settled in a payout with payout.payoutStatus === Paid, not
 *   LedgerStatus.Paid, which nothing in the app ever sets (same pattern as
 *   lib/my-share.ts / server/dashboard/metrics.ts). Cancelled lines are
 *   excluded defensively, same as lib/my-share.ts.
 * - `eligible` excludes anything already settled in a Paid payout
 *   (Architect review C1): under R-6 a paid-out line KEEPS
 *   LedgerStatus.Eligible (nothing ever moves it to a "Paid" ledger
 *   status), so without this exclusion the same money shows in both the
 *   Eligible and Paid tiles.
 * - `pending` is unaffected by either fix — a Pending line can't be
 *   sitting in a Paid payout.
 */
export async function myCommissionsSummary(associateId: string): Promise<MyCommissionsSummary> {
  const [eligibleAgg, pendingAgg, paidAgg, ledger] = await Promise.all([
    prisma.commissionLedger.aggregate({
      where: {
        associateId,
        ...EXCLUDE_MD_CUT,
        status: LedgerStatus.Eligible,
        OR: [{ payoutId: null }, { payout: { payoutStatus: { not: PayoutStatus.Paid } } }],
      },
      _sum: { amount: true },
    }),
    prisma.commissionLedger.aggregate({
      where: { associateId, ...EXCLUDE_MD_CUT, status: LedgerStatus.Pending },
      _sum: { amount: true },
    }),
    prisma.commissionLedger.aggregate({
      where: { associateId, ...EXCLUDE_MD_CUT, status: { not: LedgerStatus.Cancelled }, payout: { payoutStatus: PayoutStatus.Paid } },
      _sum: { amount: true },
    }),
    prisma.commissionLedger.findMany({
      where: { associateId, ...EXCLUDE_MD_CUT },
      include: { transaction: true, payout: { select: { payoutStatus: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    ledger,
    eligible: D(eligibleAgg._sum.amount ?? 0),
    pending: D(pendingAgg._sum.amount ?? 0),
    paid: D(paidAgg._sum.amount ?? 0),
  };
}
