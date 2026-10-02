import { InvoiceStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatSGD } from "@/lib/money";
import { isFullAdmin } from "@/lib/rbac";
import { findSettledReasons } from "@/server/invoices/settled-check";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { MarkPaidButton, UnmarkButton } from "./mark-paid-button";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Invoices & installments · Enshrine Admin" };

export default async function InvoicesPage() {
  const t = await getTranslations("invoices");
  const tc = await getTranslations("common");
  const session = await auth();
  const canUnmark = !!session?.user && isFullAdmin(session.user.role);
  const threshold = env.COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD;

  const [plans, invoices] = await Promise.all([
    prisma.installmentPlan.findMany({
      include: { transaction: { include: { closingAssociate: true } }, schedule: { orderBy: { sequence: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({ include: { company: true, transaction: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const transactionIds = [...new Set([...plans.map((p) => p.transactionId), ...invoices.map((i) => i.transactionId)])];
  const settledReasons = canUnmark ? await findSettledReasons(transactionIds) : new Map();

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { threshold })}
      />

      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">{t("installmentPlans")}</h2>
        </div>
        {plans.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">{t("noInstallmentPlans")}</p>
        ) : (
          <div className="divide-y divide-line-200">
            {plans.map((p) => {
              const paid = p.schedule.filter((s) => s.paid).length;
              const eligible = paid >= threshold;
              return (
                <div key={p.id} className="px-5 py-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px]">
                      <span className="font-medium text-ink">{p.transaction.transactionCode}</span>
                      <span className="text-muted"> · {p.transaction.clientName} · </span>
                      <span className="text-muted">{p.transaction.closingAssociate.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-muted">{t("installmentProgress", { total: formatSGD(p.totalAmount), paid, threshold })}</span>
                      <StatusPill status={eligible ? "Eligible" : "PendingCollection"} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.schedule.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${
                          s.paid ? "border-success/30 bg-success-50" : "border-line bg-paper-100"
                        }`}
                      >
                        <span className="text-muted">#{s.sequence}</span>
                        <span className="font-medium text-ink">{formatSGD(s.dueAmount)}</span>
                        {s.paid ? (
                          <>
                            <span className="text-[11px] font-medium text-success">{t("paidMark")}</span>
                            <a href={`/admin/invoices/installments/${s.id}/ack`} target="_blank" rel="noopener" className="text-[11px] text-action hover:underline">{t("viewAck")}</a>
                            <UnmarkButton id={s.id} kind="installment" canUnmark={canUnmark} blockedReason={settledReasons.get(p.transactionId)} />
                          </>
                        ) : (
                          <MarkPaidButton id={s.id} kind="installment" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">{t("issuedInvoices")}</h2>
        </div>
        {invoices.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">{t("noInvoices")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colInvoice")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colClient")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colCompany")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colAmount")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colPayment")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{inv.invoiceNumber}</td>
                    <td className="px-5 py-3 text-muted">{inv.transaction.clientName}</td>
                    <td className="px-5 py-3 text-muted">{inv.company.name}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(inv.amount)}</td>
                    <td className="px-5 py-3"><StatusPill status={inv.status} /></td>
                    <td className="px-5 py-3 text-muted">
                      {inv.paidMethod ? (
                        <span>
                          <span className="text-ink">{t(`payment.${inv.paidMethod.toLowerCase()}`)}</span>
                          {inv.paidReference && <span className="text-muted"> · {inv.paidReference}</span>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <a href={`/admin/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">{t("pdfLink")}</a>
                        {inv.status === InvoiceStatus.Paid && (
                          <a href={`/admin/invoices/${inv.id}/ack`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">{t("viewAck")}</a>
                        )}
                        {inv.status === InvoiceStatus.Outstanding && <MarkPaidButton id={inv.id} kind="invoice" />}
                        {inv.status === InvoiceStatus.Paid && (
                          <UnmarkButton id={inv.id} kind="invoice" canUnmark={canUnmark} blockedReason={settledReasons.get(inv.transactionId)} />
                        )}
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
