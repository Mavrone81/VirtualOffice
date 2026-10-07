import { AssociateStatus, LedgerStatus, PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, ZERO } from "@/lib/money";
import { periodKeys } from "@/lib/quota";
import { rankByCommissionReceived, type RankResult } from "@/lib/rank-band";
import { EXCLUDE_MD_CUT } from "@/server/commission/md-visibility";

/**
 * A-2: this associate's percentile band, ranked against every active
 * associate by commission received this calendar year (A-0/R-6: "received"
 * is derived from the payout that settled the ledger line —
 * payout.payoutStatus = Paid, not LedgerStatus.Paid, which nothing sets;
 * same derivation as lib/my-share.ts / server/dashboard/metrics.ts).
 *
 * "This calendar year" is the year the commission was PAID OUT — the
 * settling payout's own `payoutMonth`, not the ledger line's `payoutMonth`
 * (the earning/sale month). With a catch-up payout run these differ (a line
 * earned in December can settle in a January payout); the year it counts
 * toward is the settlement year, matching Frontend's A-3 fix to the same
 * "received this year" figure on the dashboard's target tiles.
 *
 * Aggregated in Postgres (groupBy + _sum), not fetched row-by-row into Node
 * — DevLead review: the earlier version pulled every Paid line of the year
 * for every associate into memory on each dashboard load.
 *
 * Computed live on every call — "as of today" only requires the figure to be
 * current as of now; there's no daily-job cache in this codebase to hook
 * into, and dashboardMetrics (the other portal-dashboard figures) is
 * computed the same way, live per request. No TTL cache either — it's live
 * data, and a cache would just add staleness for no benefit at this volume.
 *
 * Returns null if the associate isn't found among the active population
 * (e.g. not Active) — the caller treats that the same as an error: hide the
 * band row, don't show a wrong one.
 */
export async function myRankResult(associateId: string): Promise<RankResult | null> {
  const { year } = periodKeys(new Date());
  const [active, grouped] = await Promise.all([
    prisma.associate.findMany({ where: { associateStatus: AssociateStatus.Active }, select: { id: true } }),
    prisma.commissionLedger.groupBy({
      by: ["associateId"],
      where: {
        associateId: { not: null },
        ...EXCLUDE_MD_CUT,
        status: { not: LedgerStatus.Cancelled },
        payout: { payoutStatus: PayoutStatus.Paid, payoutMonth: { startsWith: `${year}-` } },
      },
      _sum: { amount: true },
    }),
  ]);

  const receivedByAssociate = new Map<string, ReturnType<typeof D>>();
  for (const row of grouped) {
    if (row.associateId) receivedByAssociate.set(row.associateId, D(row._sum.amount ?? 0));
  }

  const inputs = active.map((a) => ({ associateId: a.id, received: (receivedByAssociate.get(a.id) ?? ZERO).toNumber() }));
  const results = rankByCommissionReceived(inputs);
  return results.find((r) => r.associateId === associateId) ?? null;
}
