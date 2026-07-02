import { format } from "date-fns";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Sales agreements · Enshrine Portal" };

export default async function SalesAgreementsPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const transactions = associateId
    ? await prisma.salesTransaction.findMany({
        where: { closingAssociateId: associateId },
        orderBy: { salesDate: "desc" },
        include: { lineItems: { select: { productName: true } } },
      })
    : [];

  return (
    <>
      <PageHeader title="Sales agreements" subtitle="Printable agreements for the sales you've closed." />

      <Card className="overflow-hidden">
        {transactions.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">
            No confirmed sales yet. Agreements appear here once a sale is verified.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Txn</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Products</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{t.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{format(t.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{t.clientName}</td>
                    <td className="px-5 py-3 text-muted">{t.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-right text-ink">{formatSGD(t.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(t.paymentPlan)}</td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/agreements/${t.id}/pdf`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">Agreement ↗</a>
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
