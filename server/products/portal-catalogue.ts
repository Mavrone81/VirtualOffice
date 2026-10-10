import { Prisma, ProductActiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withCurrentRates } from "./current-rates";
import { closingPrice, deriveInstalmentSchedule } from "@/lib/money";

// Portal catalogue (2026-10-01): associates see commission only. Company cut
// AND the external-provider retained percentage are both internal commission
// structure that belongs in the admin-only views, not here — both are
// SELECTED OUT of this query, not merely left out of the client-side mapping
// below, so neither reaches the database result for this read path at all.
// See portal-catalogue.integration.test.ts for the proof (with controls that
// fail if this select is widened to include either field). Every product
// shows the same commission treatment regardless of how it's sourced, so
// isExternal itself isn't needed by this read either — dropped along with it.
export const PORTAL_PRODUCT_SELECT = {
  id: true,
  productCode: true,
  productName: true,
  productCategory: true,
  description: true,
  activeStatus: true,
  listedPrice: true,
  discountedPrice: true,
  closingBasis: true,
  bookingFee: true,
  instalmentPlans: { select: { months: true }, orderBy: { months: "asc" } },
  commissionType: true,
  closingCommPct: true,
  closingCommFixed: true,
  defaultCompany: { select: { name: true } },
} satisfies Prisma.ProductSelect;

export type PortalProductRow = Prisma.ProductGetPayload<{ select: typeof PORTAL_PRODUCT_SELECT }>;

/** The raw (pre-mapping) rows, using the select above — the boundary the
 *  integration test exercises directly, since the mapped shape below would
 *  never carry an extra key regardless of what the select fetches. */
export async function fetchPortalProductRows(now: Date = new Date()): Promise<PortalProductRow[]> {
  const rows = await prisma.product.findMany({
    where: { activeStatus: ProductActiveStatus.Active, archivedAt: null },
    orderBy: [{ productCategory: "asc" }, { productCode: "asc" }],
    select: PORTAL_PRODUCT_SELECT,
  });
  // Commission shown to associates is the rate IN FORCE today (the version
  // effective now), not the product row's mirror of the latest version — a
  // future-dated change must not be quotable before it takes effect.
  return withCurrentRates(rows, now);
}

export type PortalCatalogueProduct = {
  id: string;
  productCode: string;
  productName: string;
  productCategory: string | null;
  description: string | null;
  companyName: string;
  activeStatus: string;
  listedPrice: string | null;
  discountedPrice: string | null;
  closingBasis: "ListedPrice" | "DiscountedPrice";
  bookingFee: string | null;
  instalmentPlans: { months: number; regular: string | null; final: string | null }[];
  commissionType: "Percentage" | "Fixed";
  closingCommPct: string | null;
  closingCommFixed: string | null;
};

export async function getPortalProductCatalogue(now: Date = new Date()): Promise<PortalCatalogueProduct[]> {
  const rows = await fetchPortalProductRows(now);
  return rows.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    productCategory: p.productCategory,
    description: p.description,
    companyName: p.defaultCompany?.name ?? "—",
    activeStatus: p.activeStatus,
    listedPrice: p.listedPrice?.toFixed(2) ?? null,
    discountedPrice: p.discountedPrice?.toFixed(2) ?? null,
    closingBasis: p.closingBasis,
    bookingFee: p.bookingFee?.toFixed(2) ?? null,
    // Derived at read time (owner's "no override allowed" ruling, 2026-10-09
    // follow-up), never stored — blank booking fee reads as zero, matching
    // the admin form's own convention. No listedPrice (a legacy row predating
    // this feature) means nothing to derive from; such a row has no plans.
    instalmentPlans:
      p.listedPrice == null
        ? []
        : p.instalmentPlans.map((pl) => {
            const basis = closingPrice(p.listedPrice!, p.discountedPrice, p.closingBasis);
            const schedule = deriveInstalmentSchedule(basis, p.bookingFee ?? "0", pl.months);
            return { months: pl.months, regular: schedule?.regular.toFixed(2) ?? null, final: schedule?.final.toFixed(2) ?? null };
          }),
    commissionType: p.commissionType,
    closingCommPct: p.closingCommPct?.toFixed(4) ?? null,
    closingCommFixed: p.closingCommFixed?.toFixed(2) ?? null,
  }));
}
