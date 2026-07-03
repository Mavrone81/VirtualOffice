import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "My payouts · Enshrine Portal" };

export default async function MyPayoutsPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const t = await getTranslations("portal");
  const tc = await getTranslations("common");

  const payouts = associateId
    ? await prisma.monthlyPayout.findMany({ where: { associateId }, orderBy: { payoutMonth: "desc" } })
    : [];

  return (
    <>
      <PageHeader title={t("payouts.pageTitle")} subtitle={t("payouts.pageSubtitle")} />
      <Card className="overflow-hidden">
        {payouts.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("payouts.noPayouts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("payouts.colMonth")}</th>
                  <th className="px-5 py-3 font-medium">{t("payouts.colPersonal")}</th>
                  <th className="px-5 py-3 font-medium">{t("payouts.colOverride")}</th>
                  <th className="px-5 py-3 font-medium">{t("payouts.colAddon")}</th>
                  <th className="px-5 py-3 font-medium">{t("payouts.colTotal")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{p.payoutMonth}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.personalCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.overrideCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.addonCommission)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(p.totalPayable)}</td>
                    <td className="px-5 py-3"><StatusPill status={p.payoutStatus} /></td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/payouts/${p.id}/statement`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">{t("payouts.statement")}</a>
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
