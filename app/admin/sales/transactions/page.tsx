import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Transactions · Enshrine Admin" };

export default async function TransactionsPage() {
  const transactions = await prisma.salesTransaction.findMany({
    orderBy: { verifiedAt: "desc" },
    include: { closingAssociate: true, lineItems: true, invoices: true },
  });

  return (
    <>
      <PageHeader title="Sales transactions" subtitle="The verified, official record of confirmed sales." />

      <Card className="overflow-hidden">
        {transactions.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">
            No verified transactions yet — verify a submission to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Txn ID</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Products</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Closer</th>
                  <th className="px-5 py-3 font-medium">Eligibility</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{t.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{format(t.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{t.clientName}</td>
                    <td className="px-5 py-3 text-muted">{t.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(t.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{t.closingAssociate.fullName}</td>
                    <td className="px-5 py-3"><StatusPill status={t.commissionEligibility} /></td>
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
