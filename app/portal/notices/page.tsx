import { format } from "date-fns";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { noticeAudienceWhere } from "@/lib/notices";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { MarkReadButton } from "./mark-read-button";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Notices · Enshrine Portal" };

export default async function PortalNoticesPage() {
  const session = await auth();
  const t = await getTranslations("portal");

  if (!session?.user) return <PageHeader title={t("notices.pageTitle")} />;

  const assoc = session.user.associateId
    ? await prisma.associate.findUnique({ where: { id: session.user.associateId }, select: { teamName: true } })
    : null;

  const [notices, reads] = await Promise.all([
    prisma.notice.findMany({ where: noticeAudienceWhere(session.user.role, assoc?.teamName ?? null), orderBy: { publishedAt: "desc" }, take: 100 }),
    prisma.noticeRead.findMany({ where: { userId: session.user.id }, select: { noticeId: true } }),
  ]);
  const readSet = new Set(reads.map((r) => r.noticeId));

  return (
    <>
      <PageHeader title={t("notices.pageTitle")} subtitle={t("notices.pageSubtitle")} />

      {notices.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("notices.noNotices")}</Card>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => {
            const unread = !readSet.has(n.id);
            return (
              <Card key={n.id} className={`p-5 ${unread ? "border-l-2 border-l-action" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-action" />}
                      <h2 className="font-display text-[16px] text-ink">{n.title}</h2>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-body">{n.body}</p>
                    <div className="mt-2 text-[11px] text-muted-2">{format(n.publishedAt, "dd MMM yyyy, HH:mm")}</div>
                  </div>
                  {unread && <MarkReadButton id={n.id} />}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
