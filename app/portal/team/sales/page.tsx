import { redirect } from "next/navigation";
import { TEAM_SEARCH_KEY } from "@/lib/team-search-params";

// C11 (2026-10-03): Team Sales and Team Commissions are now ONE page, Team
// Performance. A redirect (not a deleted route) so an old bookmark still
// lands somewhere real. The target renders content for every role (the
// manager view, or the downline / not-eligible branch), so this is never a
// bounce into another redirect. teamSearch carries over: it is the same
// param, read the same way, on the combined page.
export default async function TeamSalesRedirect({ searchParams }: { searchParams: Promise<{ [TEAM_SEARCH_KEY]?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp[TEAM_SEARCH_KEY]) q.set(TEAM_SEARCH_KEY, sp[TEAM_SEARCH_KEY]);
  const qs = q.toString();
  redirect(qs ? `/portal/team/performance?${qs}` : "/portal/team/performance");
}
