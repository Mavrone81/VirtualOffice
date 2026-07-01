import Link from "next/link";
import { format } from "date-fns";
import { OnboardingStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Recruitment · Enshrine Admin" };

// Pipeline columns, in flow order. FormSubmitted + SignedPendingApproval both
// land in the "Pending review" bucket the admin acts on.
const COLUMNS: { title: string; stages: OnboardingStage[]; tone: "info" | "warn" | "success" | "neutral" }[] = [
  { title: "Invited", stages: [OnboardingStage.Invited], tone: "info" },
  { title: "Pending review", stages: [OnboardingStage.FormSubmitted, OnboardingStage.SignedPendingApproval], tone: "warn" },
  { title: "Approved", stages: [OnboardingStage.Approved], tone: "success" },
  { title: "Rejected", stages: [OnboardingStage.Rejected], tone: "neutral" },
];

export default async function RecruitmentPage() {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" },
    include: { intendedDirectUpline: { select: { associateCode: true, fullName: true } } },
  });

  return (
    <>
      <PageHeader title="Recruitment" subtitle="Invite candidates, track onboarding, and approve to convert them into associates.">
        <Button asChild>
          <Link href="/admin/recruitment/new">+ Invite candidate</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
        {COLUMNS.map((col) => {
          const items = candidates.filter((c) => col.stages.includes(c.onboardingStage));
          return (
            <div key={col.title} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-[13px] font-medium text-ink">{col.title}</h2>
                <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] text-muted">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-muted-2">
                  None
                </div>
              ) : (
                items.map((c) => (
                  <Link key={c.id} href={`/admin/recruitment/${c.id}`} className="block">
                    <Card className="p-4 transition-colors hover:bg-paper-100">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{c.fullName}</div>
                          <div className="mt-0.5 truncate text-[12px] text-muted">{c.email}</div>
                        </div>
                        <StatusPill status={c.onboardingStage} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-2">
                        <span>{humanize(c.intendedDesignation ?? "")}</span>
                        {c.intendedDirectUpline && <span>↑ {c.intendedDirectUpline.associateCode}</span>}
                        {c.intendedTeam && <span>{c.intendedTeam}</span>}
                      </div>
                      <div className="mt-2 text-[11px] text-muted-2">Invited {format(c.createdAt, "dd MMM")}</div>
                    </Card>
                  </Link>
                ))
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
