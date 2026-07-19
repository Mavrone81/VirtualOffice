import { LedgerLineType, LedgerStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { teamScopeIds } from "@/lib/team";
import { formatSGD, sum } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Team commissions · Enshrine Portal" };

export default async function TeamCommissionsPage() {
  const session = await auth();
  const t = await getTranslations("team");
  const tc = await getTranslations("common");

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("commissions.pageTitle")} subtitle={t("commissions.noProfile")} />;

  const dlIds = await teamScopeIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId);

  const [ledger, myOverrides] = await Promise.all([
    teamIds.length
      ? prisma.commissionLedger.findMany({
          where: { associateId: { in: teamIds } },
          orderBy: { createdAt: "desc" },
          include: { transaction: { select: { transactionCode: true } }, associate: { select: { associateCode: true } } },
          take: 200,
        })
      : Promise.resolve([]),
    prisma.commissionLedger.findMany({ where: { associateId, lineType: LedgerLineType.Override }, select: { amount: true } }),
  ]);

  const teamTotal = sum(ledger.map((l) => l.amount));
  const eligible = sum(ledger.filter((l) => l.status === LedgerStatus.Eligible).map((l) => l.amount));
  const myOverride = sum(myOverrides.map((l) => l.amount));

  return (
    <>
      <PageHeader title={t("commissions.pageTitle")} subtitle={t("commissions.pageSubtitle")} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label={t("commissions.teamCommission")} value={formatSGD(teamTotal)} sub={t("commissions.earnedByDownline")} />
        <StatTile label={t("commissions.teamEligible")} value={formatSGD(eligible)} sub={t("commissions.readyForPayout")} />
        <StatTile label={t("commissions.myOverrides")} value={formatSGD(myOverride)} sub={t("commissions.yourEarningsFromTeam")} />
      </div>

      <Card className="mt-6 overflow-hidden">
        {ledger.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("commissions.noCommission")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("commissions.colAssociate")}</th>
                  <th className="px-5 py-3 font-medium">{t("commissions.colTxn")}</th>
                  <th className="px-5 py-3 font-medium">{t("commissions.colType")}</th>
                  <th className="px-5 py-3 font-medium">{t("commissions.colMonth")}</th>
                  <th className="px-5 py-3 font-medium text-right">{t("commissions.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
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
