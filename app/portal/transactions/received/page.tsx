import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { visibleTransactions } from "@/server/transactions/queries";

export const metadata = { title: "Transaction received · Enshrine Portal" };

export default async function PortalTransactionsReceivedPage() {
  const t = await getTranslations("sales");
  const rows = (await visibleTransactions("received")) ?? [];
  return (
    <>
      <PageHeader title={t("transactions.receivedTitle")} subtitle={t("transactions.receivedSubtitle")} />
      <TransactionsTable rows={rows} variant="received" />
    </>
  );
}
