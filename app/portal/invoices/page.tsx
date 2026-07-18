import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { SignedInvoiceUpload } from "./signed-upload";

export const dynamic = "force-dynamic";
export const metadata = { title: "My invoices · Enshrine Portal" };

// 16-Jul signed-invoice precursor: the closing associate's invoices. View the
// generated PDF, print + get the client to sign, then upload the signed copy.
export default async function PortalInvoicesPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  const t = await getTranslations("portal");
  const tc = await getTranslations("common");

  const invoices = associateId
    ? await prisma.invoice.findMany({
        where: { transaction: { closingAssociateId: associateId } },
        include: { company: true, transaction: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <>
      <PageHeader title={t("invoices.pageTitle")} subtitle={t("invoices.pageSubtitle")} />

      <Card className="overflow-hidden">
        {invoices.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("invoices.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("invoices.colInvoice")}</th>
                  <th className="px-5 py-3 font-medium">{t("invoices.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("invoices.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("invoices.colSigned")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{inv.invoiceNumber}</td>
                    <td className="px-5 py-3 text-muted">{inv.transaction.clientName}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(inv.amount)}</td>
                    <td className="px-5 py-3">
                      {inv.signedPdfFileKey ? (
                        <a href={`/portal/invoices/${inv.id}/signed`} target="_blank" rel="noopener" className="text-[12px] text-success hover:underline">
                          {t("invoices.signedOnFile")}
                        </a>
                      ) : (
                        <span className="text-[12px] text-muted">{t("invoices.notSigned")}</span>
                      )}
                    </td>
                    <td className="px-5 py-3"><StatusPill status={inv.status} /></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <a href={`/portal/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">{t("invoices.viewPdf")}</a>
                        <SignedInvoiceUpload invoiceId={inv.id} hasSigned={!!inv.signedPdfFileKey} />
                      </div>
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
