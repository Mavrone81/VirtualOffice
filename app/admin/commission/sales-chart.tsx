import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { formatSGD } from "@/lib/money";
import type { ProductSales } from "@/server/commission/product-sales";
import type { Period } from "@/lib/period";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";

export async function SalesChart({ rows, period }: { rows: ProductSales[]; period: Period }) {
  const t = await getTranslations("commission");
  const tf = await getTranslations("filters");

  const max = rows.reduce((m, r) => Math.max(m, r.total.toNumber()), 0) || 1;

  const fields: FilterField[] = [
    {
      type: "select", key: "period", label: tf("period"),
      options: [
        { value: "month", label: tf("periodMonth") },
        { value: "quarter", label: tf("periodQuarter") },
        { value: "year", label: tf("periodYear") },
        { value: "custom", label: tf("periodCustom") },
      ],
    },
    ...(period === "custom"
      ? [{ type: "date-range" as const, fromKey: "chartFrom", toKey: "chartTo", labelFrom: tf("dateFrom"), labelTo: tf("dateTo") }]
      : []),
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h3 className="font-display text-[18px] text-ink">{t("salesChartTitle")}</h3>
        <Suspense fallback={null}>
          <FilterBar fields={fields} clearAllLabel={tf("clearAll")} />
        </Suspense>
      </div>

      {rows.length === 0 ? (
        <EmptyState message={t("salesChartEmpty")} />
      ) : (
        <div className="space-y-2.5 p-5">
          {rows.map((r) => {
            const value = formatSGD(r.total);
            const widthPct = Math.max((r.total.toNumber() / max) * 100, 2);
            return (
              <div key={r.productCode} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-[13px] text-ink">{r.productName}</span>
                <div className="h-4 flex-1 rounded bg-paper-100" role="img" aria-label={`${r.productName}: ${value}`}>
                  <div className="h-4 rounded bg-action" style={{ width: `${widthPct}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right text-[13px] font-medium text-ink">{value}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
