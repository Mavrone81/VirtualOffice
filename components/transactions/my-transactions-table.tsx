import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { PaymentPlan } from "@prisma/client";
import { formatSGD, sum } from "@/lib/money";
import { summariseMyShare } from "@/lib/my-share";
import type { MyTransactionRow } from "@/server/transactions/queries";
import { Card } from "@/components/ui/card";

/**
 * Associate-portal "My Transactions" table (Sep 2026 — A5/A6). One layout for
 * the List / Received / Receivable tabs. Every commission column is the
 * signed-in associate's OWN share on that transaction (closer, split, or
 * override) — see lib/my-share.ts. The Invoice column downloads the customer
 * invoice, which only the closing associate may do (lib/invoice-access.ts).
 */
export async function MyTransactionsTable({ rows, me }: { rows: MyTransactionRow[]; me: string }) {
  const t = await getTranslations("sales.myTxn");

  const th = "px-3 py-3 font-medium";
  const num = "px-3 py-3 text-right tabular-nums";

  return (
    <Card className="overflow-hidden">
      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-ink text-[11px] uppercase tracking-wide text-white/85">
                <th className={th}>{t("col.sno")}</th>
                <th className={th}>{t("col.txnId")}</th>
                <th className={th}>{t("col.type")}</th>
                <th className={th}>{t("col.description")}</th>
                <th className={th}>{t("col.submitted")}</th>
                <th className={`${th} text-right`}>{t("col.price")}</th>
                <th className={`${th} text-right`}>{t("col.invoiceAmount")}</th>
                <th className={th}>{t("col.scheme")}</th>
                <th className={`${th} text-right`}>{t("col.share")}</th>
                <th className={`${th} text-right`}>{t("col.received")}</th>
                <th className={`${th} text-right`}>{t("col.balance")}</th>
                <th className={th}>{t("col.invoice")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const mine = summariseMyShare(r.ledgerLines, me, r);
                const isCloser = r.closingAssociateId === me;
                return (
                  <tr key={r.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-3 py-3 text-muted tabular-nums">{i + 1}</td>
                    <td className="px-3 py-3 font-medium text-ink whitespace-nowrap">{r.transactionCode}</td>
                    <td className="px-3 py-3 text-muted">{r.paymentPlan === PaymentPlan.Installment ? t("type.installment") : t("type.full")}</td>
                    <td className="px-3 py-3 text-ink">{r.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-3 py-3 text-muted whitespace-nowrap">{format(r.submission.createdAt, "dd MMM yyyy")}</td>
                    <td className={`${num} text-ink`}>{formatSGD(r.saleAmount)}</td>
                    <td className={`${num} text-ink`}>{r.invoices.length ? formatSGD(sum(r.invoices.map((v) => v.amount))) : "—"}</td>
                    <td className="px-3 py-3 text-muted">{mine.schemes.length ? mine.schemes.map((s) => t(`scheme.${s}`)).join(", ") : "—"}</td>
                    <td className={`${num} text-ink`}>{formatSGD(mine.share)}</td>
                    <td className={`${num} text-ink`}>{formatSGD(mine.received)}</td>
                    <td className={`${num} font-medium text-ink`}>{formatSGD(mine.balance)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {isCloser && r.invoices.length ? (
                        <span className="flex flex-col gap-0.5">
                          {r.invoices.map((v) => (
                            <a key={v.id} href={`/portal/invoices/${v.id}/pdf`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">
                              {t("download", { number: v.invoiceNumber })}
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
