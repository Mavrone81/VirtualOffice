import { Prisma, ProductActiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// Portal catalogue (2026-09-30): associates see commission only, not company
// cut, which stays internal to the admin area. Company cut is SELECTED OUT
// here, not merely left out of the client-side mapping below, so
// companyCutPct/companyCutType never leave the database in the first place
// for this read path. See portal-catalogue.integration.test.ts for the
// proof (with a control that fails if this select is widened).
export const PORTAL_PRODUCT_SELECT = {
  id: true,
  productCode: true,
  productName: true,
  productCategory: true,
  activeStatus: true,
  listedPrice: true,
  discountedPrice: true,
  instalmentOption: true,
  bookingFee: true,
  monthlyInstalment12: true,
  monthlyInstalment24: true,
  commissionType: true,
  closingCommPct: true,
  closingCommFixed: true,
  isExternal: true,
  externalCompanyRetainedPct: true,
  defaultCompany: { select: { name: true } },
} satisfies Prisma.ProductSelect;

export type PortalProductRow = Prisma.ProductGetPayload<{ select: typeof PORTAL_PRODUCT_SELECT }>;

/** The raw (pre-mapping) rows, using the select above — the boundary the
 *  integration test exercises directly, since the mapped shape below would
 *  never carry an extra key regardless of what the select fetches. */
export async function fetchPortalProductRows(): Promise<PortalProductRow[]> {
  return prisma.product.findMany({
    where: { activeStatus: ProductActiveStatus.Active, archivedAt: null },
    orderBy: [{ productCategory: "asc" }, { productCode: "asc" }],
    select: PORTAL_PRODUCT_SELECT,
  });
}

export type PortalCatalogueProduct = {
  id: string;
  productCode: string;
  productName: string;
  productCategory: string | null;
  companyName: string;
  activeStatus: string;
  listedPrice: string | null;
  discountedPrice: string | null;
  instalmentOption: "None" | "Months12" | "Months12or24";
  bookingFee: string | null;
  monthlyInstalment12: string | null;
  monthlyInstalment24: string | null;
  commissionType: "Percentage" | "Fixed";
  closingCommPct: string | null;
  closingCommFixed: string | null;
  isExternal: boolean;
  externalCompanyRetainedPct: string | null;
};

export async function getPortalProductCatalogue(): Promise<PortalCatalogueProduct[]> {
  const rows = await fetchPortalProductRows();
  return rows.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    productCategory: p.productCategory,
    companyName: p.defaultCompany?.name ?? "—",
    activeStatus: p.activeStatus,
    listedPrice: p.listedPrice?.toFixed(2) ?? null,
    discountedPrice: p.discountedPrice?.toFixed(2) ?? null,
    instalmentOption: p.instalmentOption,
    bookingFee: p.bookingFee?.toFixed(2) ?? null,
    monthlyInstalment12: p.monthlyInstalment12?.toFixed(2) ?? null,
    monthlyInstalment24: p.monthlyInstalment24?.toFixed(2) ?? null,
    commissionType: p.commissionType,
    closingCommPct: p.closingCommPct?.toFixed(4) ?? null,
    closingCommFixed: p.closingCommFixed?.toFixed(2) ?? null,
    isExternal: p.isExternal,
    externalCompanyRetainedPct: p.externalCompanyRetainedPct?.toFixed(4) ?? null,
  }));
}
