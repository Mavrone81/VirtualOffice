import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { visibleTransactions } from "@/server/transactions/queries";

export const metadata = { title: "Transaction receivable · Enshrine Portal" };

export default async function PortalTransactionsReceivablePage() {
  const t = await getTranslations("sales");
  const rows = (await visibleTransactions("receivable")) ?? [];
  return (
    <>
      <PageHeader title={t("transactions.receivableTitle")} subtitle={t("transactions.receivableSubtitle")} />
      <TransactionsTable rows={rows} variant="receivable" />
    </>
  );
}
