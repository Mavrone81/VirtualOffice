import { notFound } from "next/navigation";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { MarketingCategory } from "@prisma/client";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { categoryFromSlug } from "@/lib/marketing-categories";
import { listActiveCollections } from "@/server/marketing/list-assets";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function PortalMarketingCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category: slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();

  // Customisation pre-dates B-9 and served this portal with no flag check —
  // today's shipping configuration (flag off) must keep it working exactly
  // as before. MARKETING_LIBRARY_ENABLED gates only the 3 categories B-9
  // actually adds (Flyers/EDMs/Greetings), never this pre-existing one.
  if (category !== MarketingCategory.Customisation && !env.MARKETING_LIBRARY_ENABLED) notFound();

  const session = await auth();
  if (!session?.user) notFound();

  const t = await getTranslations("portalMarketing");
  const collections = await listActiveCollections(category);

  return (
    <>
      <PageHeader title={t(`cat.${slug}`)} subtitle={t("subtitle")} />
      {collections.length === 0 || collections.every((c) => c.assets.length === 0) ? (
        <EmptyState message={t("empty")} />
      ) : (
        <div className="space-y-6">
          {collections.filter((c) => c.assets.length > 0).map((c) => (
            <div key={c.id}>
              <h2 className="mb-3 font-display text-[16px] text-ink">{c.name}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {c.assets.map((a) => (
                  <a key={a.id} href={`/marketing/files/${a.id}`} target="_blank" rel="noopener" className="block">
                    <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-100">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-action-50 text-action">
                        <FileText className="h-5 w-5" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{a.fileName}</div>
                        <div className="mt-0.5 text-[11px] text-muted-2">{format(a.createdAt, "dd MMM yyyy")}</div>
                      </div>
                    </Card>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
