import { Suspense } from "react";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { CommissionEligibility, Designation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { teamScopeIds } from "@/lib/team";
import { transactionWhere, parseTransactionSearch, type TransactionSearch } from "@/server/sales/transaction-filters";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Transactions · Enshrine Admin" };

const MANAGER_DESIGNATIONS: Designation[] = [Designation.SalesManager, Designation.SalesDirector];

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<TransactionSearch> }) {
  const t = await getTranslations("sales");
  const tf = await getTranslations("filters");
  const tStatus = await getTranslations("status");

  const rawSp = await searchParams;
  const sp = parseTransactionSearch(rawSp);

  const [products, closers, managers, teamMemberIds] = await Promise.all([
    prisma.product.findMany({ select: { productCode: true, productName: true }, orderBy: { productName: "asc" } }),
    prisma.associate.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    sp.designation && MANAGER_DESIGNATIONS.includes(sp.designation)
      ? prisma.associate.findMany({ where: { designation: sp.designation }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
    sp.team ? teamScopeIds(sp.team) : Promise.resolve(undefined),
  ]);

  const filtersActive = Boolean(sp.designation || sp.team || sp.from || sp.to || sp.product || sp.eligibility || sp.closer);

  const transactions = await prisma.salesTransaction.findMany({
    where: transactionWhere({ ...sp, teamMemberIds }),
    orderBy: { verifiedAt: "desc" },
    include: { closingAssociate: true, lineItems: true, invoices: true },
  });

  const fields: FilterField[] = [
    {
      type: "select", key: "designation", label: tf("designation"),
      options: Object.values(Designation).map((d) => ({ value: d, label: humanize(d) })),
    },
    ...(sp.designation && MANAGER_DESIGNATIONS.includes(sp.designation)
      ? [{
          type: "select" as const, key: "team", label: tf("team"),
          options: managers.map((m) => ({ value: m.id, label: m.fullName })),
          emptyLabel: managers.length === 0 ? tf("teamNoDownline") : undefined,
        }]
      : []),
    { type: "date-range", fromKey: "from", toKey: "to", labelFrom: tf("dateFrom"), labelTo: tf("dateTo") },
    { type: "select", key: "product", label: tf("product"), options: products.map((p) => ({ value: p.productCode, label: p.productName })) },
    {
      type: "select", key: "eligibility", label: tf("eligibility"),
      options: Object.values(CommissionEligibility).map((e) => ({ value: e, label: tStatus(e) })),
    },
    { type: "select", key: "closer", label: tf("closer"), options: closers.map((c) => ({ value: c.id, label: c.fullName })) },
  ];

  return (
    <>
      <PageHeader title={t("transactions.title")} subtitle={t("transactions.subtitle")} />

      <Suspense fallback={null}>
        <FilterBar fields={fields} clearAllLabel={tf("clearAll")} />
      </Suspense>

      <Card className="overflow-hidden">
        {transactions.length === 0 ? (
          filtersActive ? (
            <EmptyState message={t("transactions.emptyFiltered")} />
          ) : (
            <div className="px-5 py-12 text-center text-[13px] text-muted">{t("transactions.empty")}</div>
          )
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
                  <th className="px-5 py-3 font-medium">{t("transactions.col.closer")}</th>
                  <th className="px-5 py-3 font-medium">{t("transactions.col.eligibility")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t_row) => (
                  <tr key={t_row.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{t_row.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{format(t_row.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{t_row.clientName}</td>
                    <td className="px-5 py-3 text-muted">{t_row.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(t_row.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{t_row.closingAssociate.fullName}</td>
                    <td className="px-5 py-3"><StatusPill status={t_row.commissionEligibility} /></td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/agreements/${t_row.id}/pdf`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">{t("transactions.agreement")}</a>
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
