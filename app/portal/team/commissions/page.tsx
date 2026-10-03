import { redirect } from "next/navigation";
import { TEAM_SEARCH_KEY } from "@/lib/team-search-params";

// C11 (2026-10-03): see ../sales/page.tsx. The My Overrides card's own
// period params (moView/moMonth/moYear) and teamSearch all keep their names
// on the combined page, so they carry over unchanged.
export default async function TeamCommissionsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ moView?: string; moMonth?: string; moYear?: string; [TEAM_SEARCH_KEY]?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ["moView", "moMonth", "moYear", TEAM_SEARCH_KEY] as const) {
    if (sp[k]) q.set(k, sp[k]);
  }
  const qs = q.toString();
  redirect(qs ? `/portal/team/performance?${qs}` : "/portal/team/performance");
}
