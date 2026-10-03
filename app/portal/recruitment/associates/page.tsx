import { redirect } from "next/navigation";

// C-8 (owner ruling, 2026-10-03): this page is retired — "Recruitment
// Dashboard" and "Team Overview" are now one canonical page at /portal/team.
// A redirect (not a deleted route) so an old bookmark or external link still
// lands somewhere real; tab/mgr query params carry over unchanged since
// /portal/team reads the same two params for the same embedded view.
export default async function RecruitmentDashboardRedirect({ searchParams }: { searchParams: Promise<{ tab?: string; mgr?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.tab) q.set("tab", sp.tab);
  if (sp.mgr) q.set("mgr", sp.mgr);
  const qs = q.toString();
  redirect(qs ? `/portal/team?${qs}` : "/portal/team");
}
