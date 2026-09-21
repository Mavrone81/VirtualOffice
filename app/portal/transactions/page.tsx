import { MyTransactionsView } from "@/components/transactions/my-transactions-view";

export const metadata = { title: "My transactions · Enshrine Portal" };

// My Transactions (Sep 2026 — A5): one page, three tabs; this is the "list" tab.
export default function PortalTransactionsPage() {
  return <MyTransactionsView variant="list" />;
}
