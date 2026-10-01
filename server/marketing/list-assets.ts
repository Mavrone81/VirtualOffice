import type { MarketingCategory, MarketingCollection, MarketingAsset } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CollectionWithAssets = MarketingCollection & { assets: MarketingAsset[] };

// Associate-facing browse: only active collections, only active assets
// within them. "No expiry" (build plan B-9) means no TTL, not "always
// visible" — an archived collection or asset is hidden, never deleted.
export function listActiveCollections(category: MarketingCategory): Promise<CollectionWithAssets[]> {
  return prisma.marketingCollection.findMany({
    where: { category, archivedAt: null },
    include: { assets: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

// Admin-facing: everything, including archived collections/assets, so an
// admin can find and unarchive one.
export function listAllCollections(category: MarketingCategory): Promise<CollectionWithAssets[]> {
  return prisma.marketingCollection.findMany({
    where: { category },
    include: { assets: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export function canServeAsset(asset: { archivedAt: Date | null } | null, collection: { archivedAt: Date | null } | null): boolean {
  if (!asset || !collection) return false;
  return asset.archivedAt === null && collection.archivedAt === null;
}

// ADR-0002 decision 4: total size across every non-archived asset, in every
// category — the figure the admin-visible usage bar and the soft-cap check
// (server/marketing/upload.ts) are both driven by.
export async function getLibraryUsageBytes(): Promise<number> {
  const result = await prisma.marketingAsset.aggregate({ where: { archivedAt: null }, _sum: { sizeBytes: true } });
  return result._sum.sizeBytes ?? 0;
}
