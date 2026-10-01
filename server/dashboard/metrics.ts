import type { AppRole } from "@prisma/client";
import { LedgerStatus, PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sum } from "@/lib/money";
import { downlineIds } from "@/lib/rbac";
import { teamScopeIds } from "@/lib/team";

/**
 * The set of associate ids a "My Dashboard" aggregates over, per the role's
 * data-visibility ladder (Sep 2026):
 *  - Admin / Accounts            → null  (all teams, org-wide)
 *  - Sales Director              → own team
 *  - Sales Manager / Asst Mgr    → own downline + own team
 *  - Sales Associate             → own data only
 * null means "no filter" — callers aggregate across everyone.
 */
export async function dashboardScopeIds(role: AppRole, associateId: string | null): Promise<string[] | null> {
  if (role === "Admin" || role === "Accounts") return null;
  if (!associateId) return [];
  if (role === "SalesDirector") return teamScopeIds(associateId);
  if (role === "SalesManager" || role === "SalesAssistantManager") {
    const [dl, team] = await Promise.all([downlineIds(associateId), teamScopeIds(associateId)]);
    return [...new Set([...dl, ...team])];
  }
  return [associateId]; // associate — own only
}

export type DashboardMetrics = {
  totalTransactionValue: ReturnType<typeof sum>;
  grossTransacted: ReturnType<typeof sum>;
  grossReceived: ReturnType<typeof sum>;
};

/**
 * The three headline figures scoped to a set of associate ids (null = all):
 *  - Total Transaction Value    = Σ sale amounts of closed transactions
 *  - Gross Commission Transacted = Σ non-cancelled commission-ledger lines
 *  - Gross Commission Received   = Σ ledger lines settled in a Paid payout
 *    (derived from line.payoutId -> payout.payoutStatus, not
 *    LedgerStatus.Paid — see lib/my-share.ts)
 */
export async function dashboardMetrics(scopeIds: string[] | null): Promise<DashboardMetrics> {
  const txWhere = scopeIds === null ? {} : { closingAssociateId: { in: scopeIds } };
  const ledgerWhere = scopeIds === null ? {} : { associateId: { in: scopeIds } };
  const [tx, ledger] = await Promise.all([
    prisma.salesTransaction.findMany({ where: txWhere, select: { saleAmount: true } }),
    prisma.commissionLedger.findMany({ where: ledgerWhere, select: { amount: true, status: true, payout: { select: { payoutStatus: true } } } }),
  ]);
  return {
    totalTransactionValue: sum(tx.map((t) => t.saleAmount)),
    grossTransacted: sum(ledger.filter((l) => l.status !== LedgerStatus.Cancelled).map((l) => l.amount)),
    // Consistency fix (2026-10-01): match rank.ts/my-commissions.ts/my-share.ts,
    // which all exclude Cancelled from a "received" figure — this one didn't.
    // Dormant today (nothing creates a Cancelled ledger row yet), but this is
    // an associate-visible tile ("Gross Commission Received") one click away
    // from a correctly-filtered one on the same nav.
    grossReceived: sum(
      ledger.filter((l) => l.status !== LedgerStatus.Cancelled && l.payout?.payoutStatus === PayoutStatus.Paid).map((l) => l.amount),
    ),
  };
}

/**
 * B-1: "Total amount collected" (admin dashboard) — org-wide sum of
 * SalesTransaction.amountCollected, i.e. money actually collected from
 * customers (owner's ruling, 02 Oct: "Paid" means collected from customers,
 * not money paid OUT to associates — this tile previously summed Paid
 * MonthlyPayouts, the opposite direction, and its own sub-label said so:
 * "Paid out to associates"). amountCollected is maintained server-side in
 * the same transaction as recording a payment (server/transactions/
 * amount-collected.ts), never derived or re-aggregated here.
 */
export async function totalAmountCollected(): Promise<ReturnType<typeof sum>> {
  const tx = await prisma.salesTransaction.findMany({ select: { amountCollected: true } });
  return sum(tx.map((t) => t.amountCollected));
}

/**
 * A4/A-3: one associate's ledger lines settled in a Paid payout, bucketed by
 * the month the PAYOUT was paid (not the line's own payoutMonth, which is the
 * sale's earning month) — the "My Dashboard" target/remaining tiles need
 * "received this month/year" (lib/quota.ts inPeriod). With M5-CF catch-up a
 * line can earn in one month and settle in a later one, so filtering/bucketing
 * on the line's own payoutMonth undercounts: a July-earned line paid out in
 * October must reduce October's remaining, not July's (Architect review,
 * reviews/commissions-paid-derived-architect-review.md). Same Paid-payout
 * derivation as dashboardMetrics/lib/my-share.ts, just keyed on the payout's
 * month instead.
 */
export async function receivedInYear(associateId: string, year: string) {
  const lines = await prisma.commissionLedger.findMany({
    // Consistency fix (2026-10-01): match rank.ts/my-commissions.ts/my-share.ts
    // — see the comment on dashboardMetrics.grossReceived above.
    where: {
      associateId,
      status: { not: LedgerStatus.Cancelled },
      payout: { payoutStatus: PayoutStatus.Paid, payoutMonth: { startsWith: `${year}-` } },
    },
    select: { amount: true, payout: { select: { payoutMonth: true } } },
  });
  return lines.map((l) => ({ amount: l.amount, payoutMonth: l.payout!.payoutMonth }));
}
