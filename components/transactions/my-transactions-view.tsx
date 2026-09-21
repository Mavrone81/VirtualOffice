import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { formatSGD } from "@/lib/money";
import { dashboardScopeIds, dashboardMetrics } from "@/server/dashboard/metrics";
import { myTransactionRows, type TransactionVariant } from "@/server/transactions/queries";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { MyTransactionsTable } from "./my-transactions-table";

const TABS: { variant: TransactionVariant; href: string; key: "list" | "received" | "receivable" }[] = [
  { variant: "list", href: "/portal/transactions", key: "list" },
  { variant: "received", href: "/portal/transactions/received", key: "received" },
  { variant: "receivable", href: "/portal/transactions/receivable", key: "receivable" },
];

/**
 * Associate-portal "My Transactions" (Sep 2026 — A5). One page, three tabs
 * (each tab is its own URL so it can be linked and bookmarked), the same three
 * headline figures as the dashboard, then the per-transaction table.
 */
export async function MyTransactionsView({ variant }: { variant: TransactionVariant }) {
  const t = await getTranslations("sales.myTxn");
  const tp = await getTranslations("portal");
  const session = await auth();
  const me = session?.user.associateId ?? null;

  const scopeIds = session && me ? await dashboardScopeIds(session.user.role, me) : me ? [me] : [];
  const [metrics, rows] = await Promise.all([dashboardMetrics(scopeIds), myTransactionRows(variant)]);

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <nav className="mb-5 flex flex-wrap gap-2" aria-label={t("title")}>
        {TABS.map((tab) => {
          const on = tab.variant === variant;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={on ? "page" : undefined}
              className={
                "rounded-xl border-2 border-ink px-5 py-2.5 text-[14px] font-semibold transition-colors " +
                (on ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper-100")
              }
            >
              {t(`tab.${tab.key}`)}
            </Link>
          );
        })}
      </nav>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatTile label={tp("dashboard.totalTransactionValue")} value={formatSGD(metrics.totalTransactionValue)} sub={tp("dashboard.totalTransactionValueSub")} />
        <StatTile label={tp("dashboard.grossCommissionTransacted")} value={formatSGD(metrics.grossTransacted)} sub={tp("dashboard.grossCommissionTransactedSub")} />
        <StatTile label={tp("dashboard.grossCommissionReceived")} value={formatSGD(metrics.grossReceived)} sub={tp("dashboard.grossCommissionReceivedSub")} />
      </div>

      {me ? (
        <MyTransactionsTable rows={rows ?? []} me={me} />
      ) : (
        <p className="text-[13px] text-muted">{tp("dashboard.noProfile")}</p>
      )}
    </>
  );
}
