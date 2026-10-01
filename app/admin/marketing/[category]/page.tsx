import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { categoryFromSlug } from "@/lib/marketing-categories";
import { listAllCollections, getLibraryUsageBytes } from "@/server/marketing/list-assets";
import { PageHeader } from "@/components/ui/page-header";
import { AdminMarketingLibrary } from "./library-client";

export const dynamic = "force-dynamic";

// Build-now-ship-later (build plan B-9): with the flag off this page 404s,
// same as the routes/actions underneath it — nothing about the feature is
// reachable in prod before the owner's nginx + backup changes land.
export default async function AdminMarketingCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  if (!env.MARKETING_LIBRARY_ENABLED) notFound();

  const { category: slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();

  const t = await getTranslations("adminMarketing");
  const [collections, usageBytes] = await Promise.all([listAllCollections(category), getLibraryUsageBytes()]);
  const capBytes = env.MARKETING_LIBRARY_SOFT_CAP_MB * 1_000_000;

  return (
    <>
      <PageHeader title={t(`cat.${slug}`)} subtitle={t("subtitle")} />
      <AdminMarketingLibrary category={category} collections={collections} usageBytes={usageBytes} capBytes={capBytes} />
    </>
  );
}
