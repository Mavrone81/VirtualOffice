import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DocTemplateForm } from "./doc-template-form";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Doc Template · Enshrine Admin" };

export default async function AdminDocTemplatesPage() {
  const t = await getTranslations("docTemplateAdmin");
  const tc = await getTranslations("agreements");

  // Current (non-retired) upload per category only — no admin history UI,
  // no un-retire, per PD's ruling (reviews/b5-template-replace-design-note-2026-10-02.md).
  const current = await prisma.document.findMany({
    where: { category: { in: ["PetsAfterlife", "HumanAfterlife"] }, retiredAt: null },
    orderBy: { category: "asc" },
  });

  const CATEGORIES: { v: "PetsAfterlife" | "HumanAfterlife"; label: string }[] = [
    { v: "PetsAfterlife", label: tc("docTemplate.cat.pets") },
    { v: "HumanAfterlife", label: tc("docTemplate.cat.human") },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <DocTemplateForm />

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[17px] text-ink">{t("currentHeading")}</h2>
          </div>
          <div className="divide-y divide-line-200">
            {CATEGORIES.map((c) => {
              const doc = current.find((d) => d.category === c.v);
              return (
                <div key={c.v} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-2">{c.label}</div>
                    {doc ? (
                      <a href={`/documents/${doc.id}/download`} target="_blank" rel="noopener" className="font-medium text-action hover:underline">
                        {doc.title} ↗
                      </a>
                    ) : (
                      <p className="text-[13px] text-muted">{t("currentNone")}</p>
                    )}
                    {doc && <div className="mt-1 text-[11px] text-muted-2">{t("currentUploadedOn", { date: format(doc.createdAt, "dd MMM yyyy") })}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
