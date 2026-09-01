import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { humanize } from "@/lib/labels";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export type AssociateRow = Prisma.AssociateGetPayload<{ include: { directUpline: true } }>;

/** Read-only associates listing (consolidated menu, Sep 2026) — team-scoped
 *  or downline-scoped depending on the calling page. */
export async function AssociatesTable({ rows }: { rows: AssociateRow[] }) {
  const t = await getTranslations("recruitment");
  const tc = await getTranslations("common");
  return (
    <Card className="overflow-hidden">
      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-[13px] text-muted">{t("lists.empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("lists.colId")}</th>
                <th className="px-5 py-3 font-medium">{t("lists.colName")}</th>
                <th className="px-5 py-3 font-medium">{t("lists.colDesignation")}</th>
                <th className="px-5 py-3 font-medium">{t("lists.colTeam")}</th>
                <th className="px-5 py-3 font-medium">{t("lists.colUpline")}</th>
                <th className="px-5 py-3 font-medium">{tc("status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                  <td className="px-5 py-3 font-medium text-ink">{a.associateCode}</td>
                  <td className="px-5 py-3 text-ink">{a.fullName}</td>
                  <td className="px-5 py-3 text-muted">{humanize(a.designation)}</td>
                  <td className="px-5 py-3 text-muted">{a.teamName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>
                  <td className="px-5 py-3"><StatusPill status={a.associateStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
