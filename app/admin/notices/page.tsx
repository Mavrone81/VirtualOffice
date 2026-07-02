import { format } from "date-fns";
import { NoticeAudience } from "@prisma/client";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { NoticeForm } from "./notice-form";
import { DeleteNoticeButton } from "./delete-button";

export const metadata = { title: "Notices · Enshrine Admin" };

function audienceText(n: { audience: NoticeAudience; audienceTeam: string | null; audienceRole: string | null }): string {
  if (n.audience === NoticeAudience.Team) return `Team · ${n.audienceTeam ?? "—"}`;
  if (n.audience === NoticeAudience.Role) return `Role · ${n.audienceRole ? roleLabel[n.audienceRole as keyof typeof roleLabel] : "—"}`;
  return "Everyone";
}

export default async function AdminNoticesPage() {
  const notices = await prisma.notice.findMany({
    orderBy: { publishedAt: "desc" },
    include: { _count: { select: { reads: true } } },
  });

  return (
    <>
      <PageHeader title="Notices" subtitle="Broadcast announcements to associates — everyone, a team, or a role." />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <NoticeForm />

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[17px] text-ink">Published ({notices.length})</h2>
          </div>
          {notices.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">No notices yet.</p>
          ) : (
            <div className="divide-y divide-line-200">
              {notices.map((n) => (
                <div key={n.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{n.title}</div>
                      <p className="mt-1 whitespace-pre-line text-[13px] text-muted">{n.body}</p>
                    </div>
                    <DeleteNoticeButton id={n.id} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-muted-2">
                    <span>{audienceText(n)}</span>
                    <span>{format(n.publishedAt, "dd MMM yyyy, HH:mm")}</span>
                    <span>{n._count.reads} read</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
