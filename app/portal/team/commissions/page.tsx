import { LedgerStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { teamScopeIds, parseTeamSearchParam, resolveTeamSearchScope } from "@/lib/team";
import { formatSGD, sum } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { getTranslations } from "next-intl/server";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";
import { myOverridesSummary } from "@/server/dashboard/my-overrides";
import { MyOverridesControls } from "@/components/team/my-overrides-controls";
import { resolveMyOverridesPeriod } from "@/lib/my-overrides-period";
import { TeamSearchFilter, TEAM_SEARCH_KEY } from "@/components/team/team-search-filter";

export const metadata = { title: "Team commissions · Enshrine Portal" };

export default async function TeamCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ moView?: string; moMonth?: string; moYear?: string; [TEAM_SEARCH_KEY]?: string }>;
}) {
  const session = await auth();
  const t = await getTranslations("team");
  const tc = await getTranslations("common");

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("commissions.pageTitle")} subtitle={t("commissions.noProfile")} />;

  const sp = await searchParams;
  // Two independent mechanisms on this one page, deliberately kept apart
  // (owner ruling): moView/moMonth/moYear drive ONLY the My Overrides card
  // below; teamSearch drives ONLY teamTotal/eligible and the ledger table.
  // Neither reads the other's params.
  const { view, month, year, payoutMonth, yearOptions } = resolveMyOverridesPeriod(sp, new Date());

  const dlIds = await teamScopeIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId);

  // Same candidate-against-scope validation as team/sales — see lib/team.ts.
  const searchInput = parseTeamSearchParam(sp[TEAM_SEARCH_KEY]);
  const searchScope = await resolveTeamSearchScope(associateId, searchInput);
  const effectiveIds = searchScope ?? teamIds;

  const [members, teams, ledger, overrides] = await Promise.all([
    teamIds.length
      ? prisma.associate.findMany({ where: { id: { in: teamIds } }, select: { id: true, fullName: true, associateCode: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
    prisma.team.findMany({
      where: { active: true, OR: [{ directorId: associateId }, { members: { some: { associateId } } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
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

  const teamTotal = sum(ledger.map((l) => l.amount));
  const eligible = sum(ledger.filter((l) => l.status === LedgerStatus.Eligible).map((l) => l.amount));
  const myOverride = view === "received" ? overrides.received : overrides.overall;

  return (
    <>
      <PageHeader title={t("commissions.pageTitle")} subtitle={t("commissions.pageSubtitle")} />

      <div className="mb-4">
        <TeamSearchFilter
          individuals={members.map((m) => ({ id: m.id, label: `${m.fullName} · ${m.associateCode}` }))}
          teams={teams.map((tm) => ({ id: tm.id, label: tm.name }))}
          allLabel={t("search.all")}
          individualGroupLabel={t("search.individuals")}
          teamGroupLabel={t("search.teams")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatTile label={t("commissions.teamCommission")} value={formatSGD(teamTotal)} sub={t("commissions.earnedByDownline")} />
        <StatTile label={t("commissions.teamEligible")} value={formatSGD(eligible)} sub={t("commissions.readyForPayout")} />
      </div>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{t("commissions.myOverrides")}</div>
          <MyOverridesControls
            view={view}
            month={month}
            year={year}
            yearOptions={yearOptions}
            labels={{
              overall: t("commissions.overridesOverall"),
              received: t("commissions.overridesReceived"),
              month: t("commissions.overridesMonth"),
              year: t("commissions.overridesYear"),
            }}
          />
        </div>
        <div className="mt-1.5 font-display text-[26px] leading-none text-ink">{formatSGD(myOverride)}</div>
        {/* The card's own selected period, shown explicitly so this figure is
            never read against the other tiles above (which are all-time,
            unfiltered) — same raw "YYYY-MM" format the ledger table below
            already uses for its Month column. */}
        <div className="mt-1.5 text-[12px] text-muted-2">
          {t("commissions.yourEarningsFromTeam")} · {payoutMonth}
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        {ledger.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("commissions.noCommission")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colTxn")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colType")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colMonth")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colAmount")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-ink">
                      {l.associateName ?? "—"}
                      {l.associate?.associateCode ? <span className="ml-1 text-[11px] text-muted-2">{l.associate.associateCode}</span> : null}
                    </td>
                    <td className="px-5 py-3 font-medium text-ink">{l.transaction.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{humanize(l.lineType)}{l.comCode ? ` · ${l.comCode}` : ""}</td>
                    <td className="px-5 py-3 text-muted">{l.payoutMonth}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{formatSGD(l.amount)}</td>
                    <td className="px-5 py-3"><StatusPill status={l.status} /></td>
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
