import { LedgerStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD, sum } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "My commissions · Enshrine Portal" };

export default async function MyCommissionsPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const t = await getTranslations("portal");
  const tc = await getTranslations("common");

  const ledger = associateId
    ? await prisma.commissionLedger.findMany({
        where: { associateId },
        include: { transaction: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  const eligible = sum(ledger.filter((l) => l.status === LedgerStatus.Eligible).map((l) => l.amount));
  const pending = sum(ledger.filter((l) => l.status === LedgerStatus.Pending).map((l) => l.amount));
  const paid = sum(ledger.filter((l) => l.status === LedgerStatus.Paid).map((l) => l.amount));

  return (
    <>
      <PageHeader title={t("commissions.pageTitle")} subtitle={t("commissions.pageSubtitle")} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label={t("commissions.eligible")} value={formatSGD(eligible)} sub={t("commissions.readyForPayout")} />
        <StatTile label={t("commissions.pending")} value={formatSGD(pending)} sub={t("commissions.awaitingCollection")} />
        <StatTile label={t("commissions.paid")} value={formatSGD(paid)} sub={t("commissions.received")} />
      </div>

      <Card className="mt-6 overflow-hidden">
        {ledger.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("commissions.noCommission")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("commissions.colTxn")}</th>
                  <th className="px-5 py-3 font-medium">{t("commissions.colType")}</th>
                  <th className="px-5 py-3 font-medium">{t("commissions.colMonth")}</th>
                  <th className="px-5 py-3 font-medium">{t("commissions.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{l.transaction.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{humanize(l.lineType)}{l.comCode ? ` · ${l.comCode}` : ""}</td>
                    <td className="px-5 py-3 text-muted">{l.payoutMonth}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(l.amount)}</td>
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
