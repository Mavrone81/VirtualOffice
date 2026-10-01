import { MarketingCategory } from "@prisma/client";

// One slug per category, used in both admin and portal URLs. Kept in one
// place so a nav href and a page's [category] segment can never drift.
export const MARKETING_SLUGS: Record<string, MarketingCategory> = {
  flyers: MarketingCategory.Flyers,
  edms: MarketingCategory.EDMs,
  customisation: MarketingCategory.Customisation,
  greetings: MarketingCategory.Greetings,
};

export function categoryFromSlug(slug: string): MarketingCategory | null {
  return MARKETING_SLUGS[slug] ?? null;
}

export function slugForCategory(category: MarketingCategory): string {
  return category.toLowerCase();
}
