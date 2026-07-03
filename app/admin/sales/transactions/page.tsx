import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Transactions · Enshrine Admin" };

export default async function TransactionsPage() {
  const t = await getTranslations("sales");

  const transactions = await prisma.salesTransaction.findMany({
    orderBy: { verifiedAt: "desc" },
    include: { closingAssociate: true, lineItems: true, invoices: true },
  });

  return (
    <>
      <PageHeader title={t("transactions.title")} subtitle={t("transactions.subtitle")} />

      <Card className="overflow-hidden">
        {transactions.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">
            {t("transactions.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("transactions.col.txnId")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.date")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.client")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.products")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.amount")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.closer")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.eligibility")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t_row) => (
                  <tr key={t_row.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{t_row.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{format(t_row.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{t_row.clientName}</td>
                    <td className="px-5 py-3 text-muted">{t_row.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(t_row.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{t_row.closingAssociate.fullName}</td>
                    <td className="px-5 py-3"><StatusPill status={t_row.commissionEligibility} /></td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/agreements/${t_row.id}/pdf`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">{t("transactions.agreement")}</a>
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
