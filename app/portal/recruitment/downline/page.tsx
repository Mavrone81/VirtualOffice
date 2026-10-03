import { redirect } from "next/navigation";

// C11 (2026-10-03): Team Performance moved to /portal/team/performance, where
// the manager view (team sales + commissions) and the downline view (this
// route's old content, for everyone else) share one page. A redirect so an
// old bookmark still lands on content; tab/mgr carry over unchanged since the
// downline branch reads the same two params.
export default async function DownlinePerformanceRedirect({ searchParams }: { searchParams: Promise<{ tab?: string; mgr?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.tab) q.set("tab", sp.tab);
  if (sp.mgr) q.set("mgr", sp.mgr);
  const qs = q.toString();
  redirect(qs ? `/portal/team/performance?${qs}` : "/portal/team/performance");
}
