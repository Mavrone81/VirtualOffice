import { isManagerRole } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { teamScopeIds, parseTeamSearchParam, resolveTeamSearchScope } from "@/lib/team";
import { fetchTeamSalesCommissionByTransaction } from "@/server/sales/team-commission-column";
import { myOverridesSummary } from "@/server/dashboard/my-overrides";
import type { AppRole } from "@prisma/client";

/**
 * Everything the manager view of Team Performance reads, in one place so
 * the role guard sits in front of EVERY team-wide query. The page also
 * branches on role, but a branch that only hides markup would leave this
 * running for anyone who reached the route -- and the rows would still ride
 * out in the server payload. So the guard is here, before the first query,
 * and a non-manager gets `null` having touched nothing.
 *
 * Scope is exactly what team/sales and team/commissions each computed
 * before they merged: the associate's own team scope minus self, narrowed by
 * a teamSearch candidate that is revalidated against that scope
 * (lib/team.ts). Nothing here widens either.
 */
export async function fetchTeamPerformance(input: {
  associateId: string;
  role: AppRole;
  teamSearch?: string;
  payoutMonth: string;
}) {
  if (!isManagerRole(input.role)) return null;
  const { associateId, teamSearch, payoutMonth } = input;

  const dlIds = await teamScopeIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId);

  // The search param is a CANDIDATE, revalidated against this associate's own
  // scope server-side (lib/team.ts's resolveTeamSearchScope) -- an
  // out-of-scope or malformed one falls back to the full team scope,
  // identically to no search at all.
  const searchScope = await resolveTeamSearchScope(associateId, parseTeamSearchParam(teamSearch));
  const effectiveIds = searchScope ?? teamIds;

  const [members, teams, submissions, ledger, overrides] = await Promise.all([
    teamIds.length
      ? prisma.associate.findMany({ where: { id: { in: teamIds } }, select: { id: true, fullName: true, associateCode: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
    prisma.team.findMany({
      where: { active: true, OR: [{ directorId: associateId }, { members: { some: { associateId } } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    effectiveIds.length
      ? prisma.salesSubmission.findMany({
          where: { closingAssociateId: { in: effectiveIds } },
          orderBy: { createdAt: "desc" },
          include: {
            lineItems: { select: { productName: true } },
            closingAssociate: { select: { fullName: true, associateCode: true } },
            transaction: { select: { id: true } },
          },
          take: 200,
        })
      : Promise.resolve([]),
    effectiveIds.length
      ? prisma.commissionLedger.findMany({
          where: { associateId: { in: effectiveIds } },
          orderBy: { createdAt: "desc" },
          include: { transaction: { select: { transactionCode: true } }, associate: { select: { associateCode: true } } },
          take: 200,
        })
      : Promise.resolve([]),
    myOverridesSummary(associateId, payoutMonth),
  ]);

  // C-9: a submission with no transaction yet (not verified) has no
  // commission to show at all -- the table renders that as "no commission
  // yet", not "$0". Looked up per ROW (closing associate), not per transaction.
  const txnIds = submissions.map((s) => s.transaction?.id).filter((id): id is string => !!id);
  const commissionByTxnAssociate = await fetchTeamSalesCommissionByTransaction(txnIds);

  return { members, teams, submissions, ledger, overrides, commissionByTxnAssociate };
}
