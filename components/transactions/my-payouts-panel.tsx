import { getTranslations } from "next-intl/server";
import { formatSGD } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";
import type { MyPayoutRow } from "@/server/payouts/my-payouts";

/**
 * A15 follow-up: the per-month payout breakdown + statement download, moved
 * onto My Transactions' "Received" tab (the associate's own money actually
 * received) now that the Finance menu is gone. Same table/columns as the
 * retired /portal/payouts page — content unchanged, only the surface moved.
 * `rows` is pre-scoped by the caller (myPayoutsForAssociate) to the
 * signed-in associate's own payouts; this component renders what it's given.
 */
export async function MyPayoutsPanel({ rows }: { rows: MyPayoutRow[] }) {
  const t = await getTranslations("portal.payouts");
  const ts = await getTranslations("sales.myTxn");
  const tc = await getTranslations("common");

  return (
    <div className="mt-8">
      <h2 className="mb-1 font-display text-[16px] text-ink">{ts("payoutsHeading")}</h2>
      <p className="mb-3 text-[12.5px] text-muted">{ts("payoutsSubtitle")}</p>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("noPayouts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colMonth")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colPersonal")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colOverride")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colAddon")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colTotal")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">
                      {p.payoutMonth}
                      {p.seq > 0 && <span className="ml-2 rounded-full font-normal bg-gold/10 px-2 py-0.5 text-[11px] text-gold">{t("adjustment", { seq: p.seq })}</span>}
                    </td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.personalCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.overrideCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.addonCommission)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(p.totalPayable)}</td>
                    <td className="px-5 py-3"><StatusPill status={p.payoutStatus} /></td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/payouts/${p.id}/statement`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">{t("statement")}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
