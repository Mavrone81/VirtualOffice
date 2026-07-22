import Link from "next/link";
import { format } from "date-fns";
import { SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotations · Enshrine Admin" };

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// Admin quotation-review queue (16-Jul quotation workflow): submissions whose
// split has been approved (by the team Director, or the 3-day auto-approve) and
// are waiting for a Business Admin to check the client + documents and approve
// the rep's right to generate the quotation.
export default async function AdminQuotationsPage() {
  const t = await getTranslations("quotations");
  const threeDaysAgo = new Date(Date.now() - THREE_DAYS_MS);

  const subs = await prisma.salesSubmission.findMany({
    where: {
      status: SubmissionStatus.Submitted,
      OR: [{ sdApprovedAt: { not: null } }, { createdAt: { lte: threeDaysAgo } }],
    },
    orderBy: { createdAt: "asc" },
    include: {
      lineItems: { select: { productName: true } },
      closingAssociate: { select: { fullName: true, associateCode: true } },
      _count: { select: { documents: true } },
    },
  });

  return (
    <>
      <PageHeader title={t("list.title")} subtitle={t("list.subtitle")} />
      <Card className="overflow-hidden">
        {subs.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("list.colDate")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colProducts")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colCloser")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colDocs")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colPlan")}</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{s.closingAssociate.fullName}</td>
                    <td className="px-5 py-3 text-muted">{s._count.documents}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/admin/quotations/${s.id}`} className="text-[12px] text-action hover:underline">{t("list.review")}</Link>
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
