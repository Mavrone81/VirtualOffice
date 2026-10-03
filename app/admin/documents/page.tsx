import { format } from "date-fns";
import { DocumentAssignment } from "@prisma/client";
import { listAdminDocuments } from "@/lib/admin-documents";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DocumentForm } from "./document-form";
import { DeleteDocumentButton } from "./delete-button";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Documents · Enshrine Admin" };

export default async function AdminDocumentsPage() {
  const t = await getTranslations("documents");
  const tc = await getTranslations("agreements");
  const docs = await listAdminDocuments();

  const CATEGORY_LABEL = { PetsAfterlife: tc("docTemplate.cat.pets"), HumanAfterlife: tc("docTemplate.cat.human") };
  // The list is non-retired only, so a category row here IS the current template.
  const currentTemplates: Record<string, string> = {};
  for (const d of docs) if (d.category) currentTemplates[d.category] = d.title;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <DocumentForm currentTemplates={currentTemplates} />

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[17px] text-ink">{t("library", { count: docs.length })}</h2>
          </div>
          {docs.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</p>
          ) : (
            <div className="divide-y divide-line-200">
              {docs.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <a href={`/documents/${d.id}/download`} target="_blank" rel="noopener" className="font-medium text-action hover:underline">
                      {d.title} ↗
                    </a>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-muted-2">
                      <span>{d.category ? t("templateTag", { category: CATEGORY_LABEL[d.category] }) : humanize(d.type)}</span>
                      <span>
                        {d.assignment === DocumentAssignment.Team
                          ? t("sharedTeam", { team: d.assignedTeam ?? "—" })
                          : d.assignment === DocumentAssignment.Associate
                          ? t("sharedAssociate", { code: d.assignedAssociate?.associateCode ?? "—" })
                          : t("sharedEveryone")}
                      </span>
                      <span>{format(d.createdAt, "dd MMM yyyy")}</span>
                    </div>
                  </div>
                  {/* Templates are replaced by uploading, never deleted: the retired row's supersededBy FK would refuse it. */}
                  {!d.category && <DeleteDocumentButton id={d.id} />}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
