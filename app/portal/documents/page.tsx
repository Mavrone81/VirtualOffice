import { format } from "date-fns";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { documentVisibilityWhere } from "@/lib/documents";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Documents · Enshrine Portal" };

export default async function PortalDocumentsPage() {
  const session = await auth();
  const t = await getTranslations("portal");

  if (!session?.user) return <PageHeader title={t("documents.pageTitle")} />;

  const assoc = session.user.associateId
    ? await prisma.associate.findUnique({ where: { id: session.user.associateId }, select: { teamName: true } })
    : null;

  const docs = await prisma.document.findMany({
    where: documentVisibilityWhere(session.user.associateId, assoc?.teamName ?? null),
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader title={t("documents.pageTitle")} subtitle={t("documents.pageSubtitle")} />

      {docs.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("documents.noDocs")}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {docs.map((d) => (
            <a key={d.id} href={`/documents/${d.id}/download`} target="_blank" rel="noopener" className="block">
              <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-100">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-action-50 text-action">
                  <FileText className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{d.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-2">{humanize(d.type)} · {format(d.createdAt, "dd MMM yyyy")}</div>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
