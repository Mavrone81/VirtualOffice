import { format } from "date-fns";
import { InvoiceStatus, SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DocketUpload } from "./docket-upload";

export const dynamic = "force-dynamic";
export const metadata = { title: "My quotations · Enshrine Portal" };

// Rep-facing quotations (16-Jul quotation workflow): once a sale is approved,
// the rep downloads the quotation, sends it to the client to sign, and uploads
// the signed documents into the docket. A Paid invoice link appears once the
// admin marks it Paid.
export default async function PortalQuotationsPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  const t = await getTranslations("portal");

  const subs = associateId
    ? await prisma.salesSubmission.findMany({
        where: { closingAssociateId: associateId, status: SubmissionStatus.QuotationApproved },
        orderBy: { createdAt: "desc" },
        include: {
          documents: { where: { kind: "Signed" }, orderBy: { createdAt: "asc" } },
          transaction: { include: { invoices: true } },
        },
      })
    : [];

  return (
    <>
      <PageHeader title={t("quotations.pageTitle")} subtitle={t("quotations.pageSubtitle")} />

      {subs.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("quotations.empty")}</Card>
      ) : (
        <div className="space-y-4">
          {subs.map((s) => {
            const paidInvoice = s.transaction?.invoices.find((i) => i.status === InvoiceStatus.Paid) ?? null;
            return (
              <Card key={s.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px]">
                    <span className="font-medium text-ink">{s.clientName}</span>
                    <span className="text-muted"> · {formatSGD(s.saleAmount)} · {format(s.salesDate, "d MMM yyyy")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {paidInvoice
                      ? <span className="text-[11px] font-medium text-success">✓ {t("quotations.paid")}</span>
                      : <span className="text-[11px] text-muted">{t("quotations.awaitingPayment")}</span>}
                    <a href={`/portal/quotations/${s.id}/pdf`} target="_blank" rel="noopener" className="text-[12px] font-medium text-action hover:underline">
                      {t("quotations.downloadQuotation")}
                    </a>
                    {paidInvoice && (
                      <a href={`/portal/invoices/${paidInvoice.id}/pdf`} target="_blank" rel="noopener" className="text-[12px] text-success hover:underline">
                        {t("quotations.viewInvoice")}
                      </a>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-paper-100 px-4 py-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("quotations.docketTitle")}</div>
                  {s.documents.length > 0 ? (
                    <ul className="mb-3 space-y-1 text-[12px]">
                      {s.documents.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-3">
                          <span className="text-ink">{d.fileName}</span>
                          <a href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener" className="text-[11px] text-action hover:underline">{t("quotations.viewDoc")}</a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-3 text-[12px] text-muted">{t("quotations.noSigned")}</p>
                  )}
                  <DocketUpload submissionId={s.id} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
