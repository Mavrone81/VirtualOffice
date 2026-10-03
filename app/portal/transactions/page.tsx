import { DOWNLINE_FILTER_KEY } from "@/lib/downline-search-params";
import { MyTransactionsView } from "@/components/transactions/my-transactions-view";

export const metadata = { title: "My transactions · Enshrine Portal" };

// My Transactions (Sep 2026 — A5): one page, three tabs; this is the "list" tab.
export default async function PortalTransactionsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  return <MyTransactionsView variant="list" downline={sp[DOWNLINE_FILTER_KEY]} />;
}
