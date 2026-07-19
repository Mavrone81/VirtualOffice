import { format } from "date-fns";
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

export const metadata = { title: "Team sales · Enshrine Portal" };

export default async function TeamSalesPage() {
  const session = await auth();
  const t = await getTranslations("team");
  const tc = await getTranslations("common");

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("sales.pageTitle")} subtitle={t("sales.noProfile")} />;

  const dlIds = await teamScopeIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId);

  const submissions = teamIds.length
    ? await prisma.salesSubmission.findMany({
        where: { closingAssociateId: { in: teamIds } },
        orderBy: { createdAt: "desc" },
        include: { lineItems: { select: { productName: true } }, closingAssociate: { select: { fullName: true, associateCode: true } } },
        take: 200,
      })
    : [];

  const verified = submissions.filter((s) => s.status === "Verified");
  const total = sum(submissions.map((s) => s.saleAmount));
  const verifiedTotal = sum(verified.map((s) => s.saleAmount));

  return (
    <>
      <PageHeader title={t("sales.pageTitle")} subtitle={t("sales.pageSubtitle")} />

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
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("sales.colDate")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colAssociate")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colProducts")}</th>
                  <th className="px-5 py-3 font-medium text-right">{t("sales.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colPlan")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
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
