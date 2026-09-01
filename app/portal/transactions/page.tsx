import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { visibleTransactions } from "@/server/transactions/queries";

export const metadata = { title: "My transactions · Enshrine Portal" };

export default async function PortalTransactionsPage() {
  const t = await getTranslations("sales");
  const rows = (await visibleTransactions("list")) ?? [];
  return (
    <>
      <PageHeader title={t("transactions.myTitle")} subtitle={t("transactions.mySubtitle")} />
      <TransactionsTable rows={rows} />
    </>
  );
}
