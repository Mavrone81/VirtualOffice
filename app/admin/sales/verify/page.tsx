import { format } from "date-fns";
import { SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { humanize } from "@/lib/labels";
import { VerifyButton } from "./verify-button";

export const metadata = { title: "Verify sales · Enshrine Admin" };

export default async function VerifyQueuePage() {
  const submissions = await prisma.salesSubmission.findMany({
    where: { status: SubmissionStatus.Submitted },
    orderBy: { createdAt: "asc" },
    include: { lineItems: true, closingAssociate: true },
  });

  return (
    <>
      <PageHeader title="Verify sales" subtitle="Accounts/HR verification — commission flows only after approval." />

      <Card className="overflow-hidden">
        {submissions.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">Nothing awaiting verification.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Products</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Closer</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3 text-muted">{s.closingAssociate.fullName}</td>
                    <td className="px-5 py-3"><VerifyButton id={s.id} /></td>
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
