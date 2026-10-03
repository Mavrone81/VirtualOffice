import { Suspense } from "react";
import { LedgerLineType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { withCurrentRates } from "@/server/products/current-rates";
import { computeProductBreakdown } from "@/server/commission/product-breakdown";
import { productSalesByPeriod } from "@/server/commission/product-sales";
import { ledgerWhere, parseLedgerSearch, type LedgerSearch } from "@/server/commission/ledger-filters";
import { resolvePeriod, PERIODS, type Period } from "@/lib/period";
import { ProductDetailPanel } from "./product-detail-panel";
import { SalesChart } from "./sales-chart";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Commission Dashboard · Enshrine Admin" };

type Search = LedgerSearch & { period?: string; chartFrom?: string; chartTo?: string };

export default async function CommissionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations("commission");
  const tf = await getTranslations("filters");
  const tc = await getTranslations("common");
  const tStatus = await getTranslations("status");

  const rawSp = await searchParams;
  const ledgerSp = parseLedgerSearch(rawSp);
  const period: Period = rawSp.period && (PERIODS as string[]).includes(rawSp.period) ? (rawSp.period as Period) : "month";
  const { from: chartFrom, to: chartTo } = resolvePeriod(period, new Date(), { from: rawSp.chartFrom, to: rawSp.chartTo });

  const [products, ledger, associates, salesRows] = await Promise.all([
    prisma.product.findMany({ where: { archivedAt: null }, orderBy: { productCode: "asc" } }).then((rows) => withCurrentRates(rows)),
    prisma.commissionLedger.findMany({
      where: ledgerWhere(ledgerSp),
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { transaction: true, lineItem: true },
    }),
    prisma.associate.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    productSalesByPeriod(chartFrom, chartTo),
  ]);

  const breakdownRows = products.map(computeProductBreakdown);
  const ledgerFiltersActive = Boolean(rawSp.associate || rawSp.lineType || rawSp.from || rawSp.to);

  const ledgerFields: FilterField[] = [
    { type: "select", key: "associate", label: tf("associate"), options: associates.map((a) => ({ value: a.id, label: a.fullName })) },
    {
      type: "select", key: "lineType", label: tf("lineType"),
      options: Object.values(LedgerLineType).map((lt) => ({ value: lt, label: tStatus(lt) })),
    },
    { type: "date-range", fromKey: "from", toKey: "to", labelFrom: tf("dateFrom"), labelTo: tf("dateTo") },
  ];

  const LINE_TONE: Record<string, "info" | "success" | "neutral" | "warn"> = {
    Personal: "success", Override: "info", AddOn: "warn", CompanyRetained: "neutral", ExternalPayable: "neutral",
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* B6c (Admin deck p6): the slide circled the 5 breakdown rows as "keep
          this information" and asked to drop the SECOND hardcoded example
          product, collapsing two side-by-side examples into one
          product-detail panel (picked via B6b's existing all-products
          search) with a sales-comparison chart on the right — not a column
          trim. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProductDetailPanel rows={breakdownRows} />
        <SalesChart rows={salesRows} period={period} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-[18px] text-ink">{t("ledgerTitle")}</h3>
          <span className="text-[12px] text-muted">{t("ledgerLines", { count: ledger.length })}</span>
        </div>

        <div className="px-5 pt-4">
          <Suspense fallback={null}>
            <FilterBar fields={ledgerFields} clearAllLabel={tf("clearAll")} />
          </Suspense>
        </div>

        {ledger.length === 0 ? (
          ledgerFiltersActive ? (
            <EmptyState message={t("ledgerEmptyFiltered")} />
          ) : (
            <p className="px-5 py-10 text-center text-[13px] text-muted">{t("ledgerEmpty")}</p>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colTxn")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colLineType")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colGross")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colNett")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{l.transaction.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{l.associateName ?? "—"}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={l.lineType} tone={LINE_TONE[l.lineType] ?? "neutral"} />
                      {l.comCode ? <span className="ml-1 text-[11px] text-muted-2">{l.comCode}</span> : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{formatSGD(l.basisAmount)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(l.amount)}</td>
                    <td className="px-5 py-3"><StatusPill status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-5 py-3 text-[11px] text-muted-2">{t("grossNettHint")}</p>
      </Card>
    </>
  );
}
