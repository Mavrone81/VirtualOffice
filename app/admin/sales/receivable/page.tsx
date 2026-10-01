import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { CommissionEligibility, Designation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { transactionWhere, parseTransactionSearch, type TransactionSearch } from "@/server/sales/transaction-filters";
import { transactionFilterOptions, MANAGER_DESIGNATIONS } from "@/server/sales/transaction-filter-options";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { TransactionsTable } from "@/components/transactions/transactions-table";

export const metadata = { title: "Transaction receivable · Enshrine Admin" };

export default async function AdminTransactionsReceivablePage({ searchParams }: { searchParams: Promise<TransactionSearch> }) {
  const t = await getTranslations("sales");
  const tf = await getTranslations("filters");
  const tStatus = await getTranslations("status");

  const rawSp = await searchParams;
  const sp = parseTransactionSearch(rawSp);
  const { products, closers, managers, teamMemberIds } = await transactionFilterOptions(sp);

  const filtersActive = Boolean(sp.designation || sp.team || sp.from || sp.to || sp.product || sp.eligibility || sp.closer);

  // "Receivable" = an outstanding balance remains. Outstanding compares two
  // columns (saleAmount vs amountCollected), which Prisma's `where` can't
  // express, so — same as "received" and as visibleTransactions always did
  // — the B-3 filters narrow via the Prisma where first, this predicate
  // applies in JS after.
  const rows = (
    await prisma.salesTransaction.findMany({
      where: transactionWhere({ ...sp, teamMemberIds }),
      orderBy: { verifiedAt: "desc" },
      include: { closingAssociate: true, lineItems: true },
    })
  ).filter((r) => r.saleAmount.gt(r.amountCollected));

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
      <PageHeader title={t("transactions.receivableTitle")} subtitle={t("transactions.receivableSubtitle")} />

      <Suspense fallback={null}>
        <FilterBar fields={fields} clearAllLabel={tf("clearAll")} />
      </Suspense>

      {rows.length === 0 && filtersActive ? (
        <Card className="overflow-hidden">
          <EmptyState message={t("transactions.emptyFiltered")} />
        </Card>
      ) : (
        <TransactionsTable rows={rows} variant="receivable" showAgreementLink />
      )}
    </>
  );
}
