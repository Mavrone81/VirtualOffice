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
// Team Sales and Team Commissions (siblings under this same layout) still
// need their own real access check — each now carries it itself
// (isManagerRole, same authority as before), not inherited from here, so
// relaxing THIS gate for the dashboard can't accidentally relax theirs too.
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <>{children}</>;
}
