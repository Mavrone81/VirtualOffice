"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProductBreakdownRow } from "@/server/commission/product-breakdown";

export function ProductBreakdownTable({ rows }: { rows: ProductBreakdownRow[] }) {
  const t = useTranslations("commission");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="font-display text-[18px] text-ink">{t("productBreakdownTitle")}</h3>
          <p className="text-[12px] text-muted">{t("productBreakdownSubtitle")}</p>
        </div>
        <div className="w-56">
          <Label htmlFor="product-search" className="sr-only">{t("productSearch")}</Label>
          <Input id="product-search" className="h-9" placeholder={t("productSearch")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={t("productEmptySearch", { query })} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("colProduct")}</th>
                <th className="px-5 py-3 font-medium">{t("colNetToCloser")}</th>
                <th className="px-5 py-3 font-medium">{t("colDirectOverride")}</th>
                <th className="px-5 py-3 font-medium">{t("colSecondOverride")}</th>
                <th className="px-5 py-3 font-medium">{t("colCompanyRetained")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.productCode} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                  <td className="px-5 py-3 font-medium text-ink">{r.productName}</td>
                  {r.kind === "external" ? (
                    <td className="px-5 py-3 text-muted" colSpan={4}>
                      {t("externalNote", { provider: r.providerKeepsPct, company: r.companyRetainedPct })}
                    </td>
                  ) : (
                    <>
                      <td className="px-5 py-3 text-ink">{r.kind === "uniform" ? r.netToCloser : t("dependsOnSaleAmount")}</td>
                      <td className="px-5 py-3 text-ink">{r.directOverride}</td>
                      <td className="px-5 py-3 text-ink">{r.secondOverride}</td>
                    </>
                  )}
                  {r.kind === "uniform" && (
                    <td className="px-5 py-3 font-medium text-ink">
                      {r.companyRetainedIsExpression ? `${t("saleWord")} − ${r.companyRetained}` : r.companyRetained}
                    </td>
                  )}
                  {r.kind === "mixed" && <td className="px-5 py-3 text-muted">{t("dependsOnSaleAmount")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[11px] text-muted-2">{t("overrideAssumptionNote")}</p>
    </Card>
  );
}
