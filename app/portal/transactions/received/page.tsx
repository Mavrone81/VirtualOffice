import { MyTransactionsView } from "@/components/transactions/my-transactions-view";

export const metadata = { title: "My transactions · Enshrine Portal" };

// My Transactions (Sep 2026 — A5): one page, three tabs; this is the "received" tab.
export default function PortalTransactionsReceivedPage() {
  return <MyTransactionsView variant="received" />;
}
