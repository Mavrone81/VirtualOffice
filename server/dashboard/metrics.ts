import type { AppRole } from "@prisma/client";
import { LedgerStatus } from "@prisma/client";
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
 *  - Gross Commission Received   = Σ paid commission-ledger lines
 */
export async function dashboardMetrics(scopeIds: string[] | null): Promise<DashboardMetrics> {
  const txWhere = scopeIds === null ? {} : { closingAssociateId: { in: scopeIds } };
  const ledgerWhere = scopeIds === null ? {} : { associateId: { in: scopeIds } };
  const [tx, ledger] = await Promise.all([
    prisma.salesTransaction.findMany({ where: txWhere, select: { saleAmount: true } }),
    prisma.commissionLedger.findMany({ where: ledgerWhere, select: { amount: true, status: true } }),
  ]);
  return {
    totalTransactionValue: sum(tx.map((t) => t.saleAmount)),
    grossTransacted: sum(ledger.filter((l) => l.status !== LedgerStatus.Cancelled).map((l) => l.amount)),
    grossReceived: sum(ledger.filter((l) => l.status === LedgerStatus.Paid).map((l) => l.amount)),
  };
}
