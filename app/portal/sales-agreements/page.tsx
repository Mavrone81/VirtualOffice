import { format } from "date-fns";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Sales agreements · Enshrine Portal" };

export default async function SalesAgreementsPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const t = await getTranslations("portal");

  const transactions = associateId
    ? await prisma.salesTransaction.findMany({
        where: { closingAssociateId: associateId },
        orderBy: { salesDate: "desc" },
        include: { lineItems: { select: { productName: true } } },
      })
    : [];

  return (
    <>
      <PageHeader title={t("salesAgreements.pageTitle")} subtitle={t("salesAgreements.pageSubtitle")} />

      <Card className="overflow-hidden">
        {transactions.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">
            {t("salesAgreements.noAgreements")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("salesAgreements.colTxn")}</th>
                  <th className="px-5 py-3 font-medium">{t("salesAgreements.colDate")}</th>
                  <th className="px-5 py-3 font-medium">{t("salesAgreements.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("salesAgreements.colProducts")}</th>
                  <th className="px-5 py-3 font-medium text-right">{t("salesAgreements.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("salesAgreements.colPlan")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr key={txn.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{txn.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{format(txn.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{txn.clientName}</td>
                    <td className="px-5 py-3 text-muted">{txn.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-right text-ink">{formatSGD(txn.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(txn.paymentPlan)}</td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/agreements/${txn.id}/pdf`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">{t("salesAgreements.agreement")}</a>
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
