import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { formatSGD } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export type TransactionRow = Prisma.SalesTransactionGetPayload<{
  include: { closingAssociate: true; lineItems: true };
}>;

/**
 * Shared transactions table (consolidated menu, Sep 2026) — used by the
 * portal + admin Transaction List / Received / Receivable pages.
 *  - "received":   adds an Amount Collected column (rows pre-filtered to
 *                  collected > 0 by the caller).
 *  - "receivable": adds an Outstanding column (sale amount − collected).
 */
export async function TransactionsTable({
  rows,
  variant = "list",
  showAgreementLink = false,
}: {
  rows: TransactionRow[];
  variant?: "list" | "received" | "receivable";
  showAgreementLink?: boolean;
}) {
  const t = await getTranslations("sales");

  return (
    <Card className="overflow-hidden">
      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-[13px] text-muted">{t("transactions.empty")}</div>
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
                {variant === "received" && (
                  <th className="px-5 py-3 font-medium">{t("transactions.col.collected")}</th>
                )}
                {variant === "receivable" && (
                  <th className="px-5 py-3 font-medium">{t("transactions.col.outstanding")}</th>
                )}
                <th className="px-5 py-3 font-medium">{t("transactions.col.closer")}</th>
                <th className="px-5 py-3 font-medium">{t("transactions.col.eligibility")}</th>
                {showAgreementLink && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                  <td className="px-5 py-3 font-medium text-ink">{r.transactionCode}</td>
                  <td className="px-5 py-3 text-muted">{format(r.salesDate, "dd MMM yyyy")}</td>
                  <td className="px-5 py-3 text-ink">{r.clientName}</td>
                  <td className="px-5 py-3 text-muted">{r.lineItems.map((l) => l.productName).join(", ")}</td>
                  <td className="px-5 py-3 text-ink">{formatSGD(r.saleAmount)}</td>
                  {variant === "received" && (
                    <td className="px-5 py-3 text-ink">{formatSGD(r.amountCollected)}</td>
                  )}
                  {variant === "receivable" && (
                    <td className="px-5 py-3 text-ink">{formatSGD(r.saleAmount.minus(r.amountCollected))}</td>
                  )}
                  <td className="px-5 py-3 text-muted">{r.closingAssociate.fullName}</td>
                  <td className="px-5 py-3"><StatusPill status={r.commissionEligibility} /></td>
                  {showAgreementLink && (
                    <td className="px-5 py-3 text-right">
                      <a href={`/agreements/${r.id}/pdf`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">
                        {t("transactions.agreement")}
                      </a>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
