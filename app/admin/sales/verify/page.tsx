import { format } from "date-fns";
import { SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { humanize } from "@/lib/labels";
import { isSdApproved } from "@/lib/approval";
import { VerifyButton } from "./verify-button";
import { ApproveSplitButton } from "./approve-split-button";

export const metadata = { title: "Verify sales · Enshrine Admin" };

export default async function VerifyQueuePage() {
  const t = await getTranslations("sales");

  const submissions = await prisma.salesSubmission.findMany({
    where: { status: SubmissionStatus.Submitted },
    orderBy: { createdAt: "asc" },
    include: { lineItems: true, closingAssociate: true },
  });

  return (
    <>
      <PageHeader title={t("verify.title")} subtitle={t("verify.subtitle")} />

      <Card className="overflow-hidden">
        {submissions.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("verify.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("verify.col.date")}</th>
                  <th className="px-5 py-3 font-medium">{t("verify.col.client")}</th>
                  <th className="px-5 py-3 font-medium">{t("verify.col.products")}</th>
                  <th className="px-5 py-3 font-medium">{t("verify.col.amount")}</th>
                  <th className="px-5 py-3 font-medium">{t("verify.col.plan")}</th>
                  <th className="px-5 py-3 font-medium">{t("verify.col.closer")}</th>
                  <th className="px-5 py-3 font-medium">{t("verify.col.sdApproval")}</th>
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
                    <td className="px-5 py-3">
                      {(() => {
                        const sd = isSdApproved(s);
                        if (sd.approved) return <span className="text-[12px] text-success">{sd.auto ? t("verify.autoApproved") : t("verify.sdApproved")}</span>;
                        return <ApproveSplitButton id={s.id} />;
                      })()}
                    </td>
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
