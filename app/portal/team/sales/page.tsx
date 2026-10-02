import { format } from "date-fns";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { teamScopeIds, parseTeamSearchParam, resolveTeamSearchScope } from "@/lib/team";
import { formatSGD, sum, ZERO } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { fetchTeamSalesCommissionByTransaction, teamSalesCommissionFor } from "@/server/sales/team-commission-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { getTranslations } from "next-intl/server";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";
import { TeamSearchFilter, TEAM_SEARCH_KEY } from "@/components/team/team-search-filter";

export const metadata = { title: "Team sales · Enshrine Portal" };

export default async function TeamSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ [TEAM_SEARCH_KEY]?: string }>;
}) {
  const session = await auth();
  const t = await getTranslations("team");
  const tc = await getTranslations("common");

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("sales.pageTitle")} subtitle={t("sales.noProfile")} />;

  const dlIds = await teamScopeIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId);

  const sp = await searchParams;
  // The search param is a CANDIDATE, revalidated against this associate's own
  // scope server-side — never trusted just because the dropdown only ever
  // renders ids already in that scope (a URL can be edited by hand). An
  // out-of-scope or malformed candidate falls back to the full team scope,
  // identically to no search at all (lib/team.ts's resolveTeamSearchScope).
  const searchInput = parseTeamSearchParam(sp[TEAM_SEARCH_KEY]);
  const searchScope = await resolveTeamSearchScope(associateId, searchInput);
  const effectiveIds = searchScope ?? teamIds;

  const [members, teams] = await Promise.all([
    teamIds.length
      ? prisma.associate.findMany({ where: { id: { in: teamIds } }, select: { id: true, fullName: true, associateCode: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
    prisma.team.findMany({
      where: { active: true, OR: [{ directorId: associateId }, { members: { some: { associateId } } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const submissions = effectiveIds.length
    ? await prisma.salesSubmission.findMany({
        where: { closingAssociateId: { in: effectiveIds } },
        orderBy: { createdAt: "desc" },
        include: {
          lineItems: { select: { productName: true } },
          closingAssociate: { select: { fullName: true, associateCode: true } },
          transaction: { select: { id: true } },
        },
        take: 200,
      })
    : [];

  // C-9: a submission with no transaction yet (not verified) has no
  // commission to show at all -- the table renders that as "no commission
  // yet", not "$0". Looking up must use the ROW'S OWN closing associate
  // (teamSalesCommissionFor), not the transaction alone -- a split sale can
  // carry more than one associate's Personal line on the same transaction.
  const txnIds = submissions.map((s) => s.transaction?.id).filter((id): id is string => !!id);
  const commissionByTxnAssociate = await fetchTeamSalesCommissionByTransaction(txnIds);

  const verified = submissions.filter((s) => s.status === "QuotationApproved");
  const total = sum(submissions.map((s) => s.saleAmount));
  const verifiedTotal = sum(verified.map((s) => s.saleAmount));

  return (
    <>
      <PageHeader title={t("sales.pageTitle")} subtitle={t("sales.pageSubtitle")} />

      <div className="mb-4">
        <TeamSearchFilter
          individuals={members.map((m) => ({ id: m.id, label: `${m.fullName} · ${m.associateCode}` }))}
          teams={teams.map((tm) => ({ id: tm.id, label: tm.name }))}
          allLabel={t("search.all")}
          individualGroupLabel={t("search.individuals")}
          teamGroupLabel={t("search.teams")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label={t("sales.submissions")} value={submissions.length} sub={t("sales.fromDownline")} />
        <StatTile label={t("sales.totalSubmitted")} value={formatSGD(total)} sub={t("sales.allStatuses")} />
        <StatTile label={t("sales.verified")} value={formatSGD(verifiedTotal)} sub={t("sales.verifiedCount", { count: verified.length })} />
      </div>

      <Card className="mt-6 overflow-hidden">
        {submissions.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("sales.noSales")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colDate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colClient")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colProducts")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colAmount")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colPlan")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colCommission")}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">
                      {s.closingAssociate.fullName}
                      <span className="ml-1 text-[11px] text-muted-2">{s.closingAssociate.associateCode}</span>
                    </td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-right text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-5 py-3 text-right text-ink">
                      {s.transaction
                        ? formatSGD(teamSalesCommissionFor(commissionByTxnAssociate, s.transaction.id, s.closingAssociateId) ?? ZERO)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
