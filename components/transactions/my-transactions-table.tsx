import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { PaymentPlan } from "@prisma/client";
import { formatSGD, sum } from "@/lib/money";
import { summariseMyShare } from "@/lib/my-share";
import type { MyTransactionRow, TransactionVariant } from "@/server/transactions/queries";
import type { VoucherListEntry } from "@/server/vouchers/get-or-create";
import { Card } from "@/components/ui/card";
import { VoucherDownloadButton } from "./voucher-download-button";

/**
 * Associate-portal "My Transactions" table (Sep 2026 — A5; A-6 build-plan
 * item). One layout for the List / Received / Receivable tabs, but the last
 * column is variant-specific per A-6's spec: List keeps the Invoice download
 * (A5 behaviour, unchanged); Receivable drops the column entirely (no
 * invoice/document exists to show yet — nothing has been invoiced against an
 * outstanding balance); Received shows the Payment Voucher (A-7) instead of
 * the Invoice. Every commission column is the signed-in associate's OWN
 * share on that transaction (closer, split, or override) — see
 * lib/my-share.ts.
 */
export async function MyTransactionsTable({
  rows, me, variant, vouchers,
}: {
  rows: MyTransactionRow[];
  me: string;
  variant: TransactionVariant;
  vouchers?: Map<string, VoucherListEntry[]>;
}) {
  const t = await getTranslations("sales.myTxn");

  const th = "px-3 py-3 font-medium";
  const num = "px-3 py-3 text-right tabular-nums";
  const showLastCol = variant !== "receivable";

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
                {showLastCol && <th className={th}>{variant === "received" ? t("col.voucher") : t("col.invoice")}</th>}
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
                    {showLastCol && (
                      <td className="px-3 py-3 whitespace-nowrap">
                        {variant === "received" ? (
                          (vouchers?.get(r.id) ?? []).length ? (
                            <span className="flex flex-col gap-1">
                              {(vouchers?.get(r.id) ?? []).map((v) => (
                                <VoucherDownloadButton
                                  key={v.payoutId}
                                  transactionId={r.id}
                                  payoutId={v.payoutId}
                                  label={v.issued ? t("download", { number: v.reference ?? "" }) : t("voucher.notIssued")}
                                  pendingLabel={t("voucher.pending")}
                                  failedLabel={t("voucher.failed")}
                                />
                              ))}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )
                        ) : isCloser && r.invoices.length ? (
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
                    )}
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
