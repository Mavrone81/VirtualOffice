import { redirect } from "next/navigation";
import { auth } from "@/auth";

// C-8 correction (2026-10-03): this used to also bounce anyone who wasn't
// isManagerRole to /portal/dashboard — but /portal/team is now the merged
// Team Dashboard (A8, Additional p8/p9/p10), which the client explicitly
// wants open to EVERY associate, differentiated by CONTENT inside the page
// (RecruitmentView's own canRecruit-eligible branch — the "not eligible for
// recruitment yet" card is a delivered, client-asked-for row, not a gap).
// Route-gating this whole subtree to managers would have silently erased
// that row for every associate below Manager.
//
// Team Performance (sibling under this same layout, C11) is open to every
// associate too and splits by role INSIDE the page: its team-wide data
// fetch carries its own isManagerRole guard (server/team/performance.ts),
// not inherited from here, so this layout stays login-only.
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <>{children}</>;
}
