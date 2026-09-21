import { parseTab } from "@/lib/recruitment-view";
import { RecruitmentView } from "@/components/recruitment/recruitment-view";

export const metadata = { title: "Recruitment dashboard · Enshrine Portal" };

// Recruitment Dashboard (Sep 2026 — A8): All / Direct / Downline associates.
export default async function RecruitmentDashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; mgr?: string }> }) {
  const sp = await searchParams;
  return <RecruitmentView mode="people" basePath="/portal/recruitment/associates" tab={parseTab(sp.tab)} mgr={sp.mgr ?? null} />;
}
