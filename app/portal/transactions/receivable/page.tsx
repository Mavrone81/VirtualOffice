import { MyTransactionsView } from "@/components/transactions/my-transactions-view";

export const metadata = { title: "My transactions · Enshrine Portal" };

// My Transactions (Sep 2026 — A5): one page, three tabs; this is the "receivable" tab.
export default function PortalTransactionsReceivablePage() {
  return <MyTransactionsView variant="receivable" />;
}
