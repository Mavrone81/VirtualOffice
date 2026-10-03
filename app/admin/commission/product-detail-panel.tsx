"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { ILLUSTRATIVE_SALE_AMOUNT, type ProductBreakdownRow } from "@/server/commission/product-breakdown";

function Field({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink">{value}</span>
        {badge && (
          <span className="inline-flex items-center rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gold">
            {badge}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * B6c (Admin deck p6): the slide circled this exact set of rows — keep them
 * — and showed TWO example products side by side; the client wants ONE
 * product-detail panel instead, with the product picked via B6b's
 * already-live all-products search (reused here, not rebuilt) rather than
 * two hardcoded examples.
 *
 * "Sale amount": no product stores one — computeProductBreakdown() only ever
 * produces rates or sale-independent constants (nothing to wire this to).
 * This shows ONE illustrative figure (ILLUSTRATIVE_SALE_AMOUNT, = the
 * S$10,000 base product-breakdown.ts already uses internally for
 * rounding-safe rate math — not a second invented number) for every
 * percentage product, so comparisons stay like-for-like, with an "Example"
 * badge visible on the card itself (not a tooltip) so nobody reads it as a
 * stored value. Fixed products get the SAME row/badge treatment for visual
 * consistency, with wording that makes clear their figures don't move with
 * it — they're sale-independent constants, shown as-is regardless of the
 * example amount. Do NOT wire this to a real field later without a product
 * schema change; there isn't one to wire it to.
 */
export function ProductDetailPanel({ rows }: { rows: ProductBreakdownRow[] }) {
  const t = useTranslations("commission");
  const [query, setQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState(rows[0]?.productCode ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => {
    if (!filtered.some((r) => r.productCode === selectedCode)) {
      setSelectedCode(filtered[0]?.productCode ?? "");
    }
  }, [filtered, selectedCode]);

  const selected = filtered.find((r) => r.productCode === selectedCode) ?? filtered[0];

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

      {filtered.length === 0 || !selected ? (
        <EmptyState message={t("productEmptySearch", { query })} />
      ) : (
        <div className="p-5">
          <Label htmlFor="product-select" className="sr-only">{t("colProduct")}</Label>
          <select
            id="product-select"
            value={selected.productCode}
            onChange={(e) => setSelectedCode(e.target.value)}
            className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[14px] font-medium text-ink focus:border-action focus:outline-none"
          >
            {filtered.map((r) => (
              <option key={r.productCode} value={r.productCode}>{r.productName}</option>
            ))}
          </select>

          <div className="mt-3 divide-y divide-line-200 border-t border-line-200">
            {selected.kind === "external" ? (
              <p className="py-3 text-[13px] text-muted">
                {t("externalNote", { provider: selected.providerKeepsPct, company: selected.companyRetainedPct })}
              </p>
            ) : (
              <>
                <Field label={t("colSaleAmount")} value={ILLUSTRATIVE_SALE_AMOUNT} badge={t("exampleBadge")} />
                <p className="pb-2 text-[11px] text-muted-2">{t("saleAmountNote", { amount: ILLUSTRATIVE_SALE_AMOUNT })}</p>
                <Field label={t("colNetToCloser")} value={selected.kind === "uniform" ? selected.netToCloser : t("dependsOnSaleAmount")} />
                <Field label={t("colDirectOverride")} value={selected.directOverride} />
                <Field label={t("colSecondOverride")} value={selected.secondOverride} />
                {selected.kind === "uniform" && (
                  <Field
                    label={t("colCompanyRetained")}
                    value={selected.companyRetainedIsExpression ? `${t("saleWord")} − ${selected.companyRetained}` : selected.companyRetained}
                  />
                )}
                {selected.kind === "mixed" && <Field label={t("colCompanyRetained")} value={t("dependsOnSaleAmount")} />}
              </>
            )}
          </div>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[11px] text-muted-2">{t("overrideAssumptionNote")}</p>
    </Card>
  );
}
