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

  // Official blank agreement templates, downloadable by every associate.
  const templates = [
    { title: t("documents.tplAssociate"), href: "/templates/associate-agreement.pdf" },
    { title: t("documents.tplReferral"), href: "/templates/referral-partnership-agreement.pdf" },
    { title: t("documents.tplAshes"), href: "/templates/storage-of-pets-ashes-agreement.pdf" },
  ];

  return (
    <>
      <PageHeader title={t("documents.pageTitle")} subtitle={t("documents.pageSubtitle")} />

      <h2 className="mb-3 font-display text-[16px] text-ink">{t("documents.templatesHeading")}</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {templates.map((tpl) => (
          <a key={tpl.href} href={tpl.href} target="_blank" rel="noopener" className="block">
            <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-100">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-action-50 text-action">
                <FileText className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{tpl.title}</div>
                <div className="mt-0.5 text-[11px] text-muted-2">{t("documents.templateTag")}</div>
              </div>
            </Card>
          </a>
        ))}
      </div>

      <h2 className="mb-3 font-display text-[16px] text-ink">{t("documents.filedHeading")}</h2>
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
