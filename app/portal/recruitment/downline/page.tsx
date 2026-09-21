import { parseTab } from "@/lib/recruitment-view";
import { RecruitmentView } from "@/components/recruitment/recruitment-view";

export const metadata = { title: "Downline performance · Enshrine Portal" };

// Downline Performance (Sep 2026 — A10): same tabs as the Recruitment Dashboard,
// with transacted value, gross commission and my override (direct / 2nd upline).
export default async function DownlinePerformancePage({ searchParams }: { searchParams: Promise<{ tab?: string; mgr?: string }> }) {
  const sp = await searchParams;
  return <RecruitmentView mode="performance" basePath="/portal/recruitment/downline" tab={parseTab(sp.tab)} mgr={sp.mgr ?? null} />;
}
