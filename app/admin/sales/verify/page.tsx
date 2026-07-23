import { format } from "date-fns";
import { InvoiceStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { MarkPaidButton } from "@/app/admin/invoices/mark-paid-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales & verify · Enshrine Admin" };

// Admin Sales & Verify (23-Jul parallel workflow, issue 3): sales the associate
// has closed (a transaction exists). The admin sees every related document and
// records payment against the plan chosen at submission — a Paid full invoice or
// each installment — which flips commission Eligible at the release threshold.
export default async function SalesVerifyPage() {
  const t = await getTranslations("verify");
  const threshold = env.COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD;

  const sales = await prisma.salesTransaction.findMany({
    orderBy: { verifiedAt: "desc" },
    include: {
      closingAssociate: { select: { fullName: true, associateCode: true } },
      lineItems: { select: { productName: true } },
      invoices: { include: { company: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } },
      submission: { include: { documents: { orderBy: { createdAt: "asc" } } } },
    },
  });

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {sales.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</Card>
      ) : (
        <div className="space-y-4">
          {sales.map((s) => {
            const docs = s.submission?.documents ?? [];
            const paidInstallments = s.installmentPlan?.schedule.filter((x) => x.paid).length ?? 0;
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
                  <div className="text-[13px]">
                    <span className="font-medium text-ink">{s.transactionCode}</span>
                    <span className="text-muted"> · {s.clientName} · {formatSGD(s.saleAmount)} · {format(s.salesDate, "d MMM yyyy")}</span>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {s.closingAssociate.fullName} · {humanize(s.paymentPlan)} · {s.lineItems.map((l) => l.productName).join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-2">{t("commission")}</span>
                    <StatusPill status={s.commissionEligibility} />
                  </div>
                </div>

                <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-line-200">
                  {/* Documents */}
                  <div className="px-5 py-4">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("documents")}</div>
                    {docs.length === 0 ? (
                      <p className="text-[12px] text-muted">{t("noDocuments")}</p>
                    ) : (
                      <ul className="space-y-1.5 text-[12px]">
                        {docs.map((d) => (
                          <li key={d.id} className="flex items-center justify-between gap-3">
                            <span className="text-ink">{d.fileName} <span className="text-[11px] text-muted">· {humanize(d.kind)}</span></span>
                            <a href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener" className="text-[11px] text-action hover:underline">{t("view")}</a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Payments */}
                  <div className="px-5 py-4">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("payments")}</div>
                    {s.installmentPlan ? (
                      <>
                        <p className="mb-2 text-[12px] text-muted">{t("installmentProgress", { paid: paidInstallments, total: s.installmentPlan.installmentCount, threshold })}</p>
                        <div className="flex flex-wrap gap-2">
                          {s.installmentPlan.schedule.map((x) => (
                            <div key={x.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${x.paid ? "border-success/30 bg-success-50" : "border-line bg-paper-100"}`}>
                              <span className="text-muted">#{x.sequence}</span>
                              <span className="font-medium text-ink">{formatSGD(x.dueAmount)}</span>
                              <MarkPaidButton id={x.id} kind="installment" paid={x.paid} />
                            </div>
                          ))}
                        </div>
                      </>
                    ) : s.invoices.length > 0 ? (
                      <div className="space-y-2">
                        {s.invoices.map((inv) => (
                          <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper-100 px-3 py-2 text-[12px]">
                            <div>
                              <span className="font-medium text-ink">{inv.invoiceNumber}</span>
                              <span className="text-muted"> · {inv.company.name} · {formatSGD(inv.amount)}</span>
                              {inv.paidMethod && <span className="text-muted"> · {humanize(inv.paidMethod)}{inv.paidReference ? ` · ${inv.paidReference}` : ""}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={inv.status} />
                              {inv.status !== InvoiceStatus.Cancelled && <MarkPaidButton id={inv.id} kind="invoice" paid={inv.status === InvoiceStatus.Paid} />}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted">{t("noInvoice")}</p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
