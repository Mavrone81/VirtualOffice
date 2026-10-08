import { Prisma, ProductActiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FormProduct } from "@/app/portal/sales/new/sale-form";

// Sales wizard (2026-10-01, pricing added 2026-10-08): the new/edit sale pages
// need a product's identity, its active add-on com codes, its billing company
// and its PRICING — never commission, company cut, or any other column on
// Product.
//
// Pricing was originally excluded with commission, but the two are not alike.
// Commission rates are admin-only business data and must never reach an
// associate's browser; listed and discounted price are what the customer is
// quoted, and the person submitting the sale has to see them — without them the
// amount field cannot be filled in and the form showed a blank price with a
// S$0.00 total (owner, 2026-10-08). The integration test's controls still prove
// no commission field leaks; only the allow-list grew. An
// explicit select keeps that true at the query itself, not just at whatever
// the page later chooses to read off a full row. See
// sales-wizard-products.integration.test.ts for the proof (with controls
// that fail if this select is widened).
export const SALES_WIZARD_PRODUCT_SELECT = {
  id: true,
  productCode: true,
  productName: true,
  requiresAshesAgreement: true,
  listedPrice: true,
  discountedPrice: true,
  comCodes: {
    where: { active: true },
    select: { id: true, comCode: true, label: true, valueType: true, value: true },
  },
  defaultCompany: { select: { name: true } },
} satisfies Prisma.ProductSelect;

export type SalesWizardProductRow = Prisma.ProductGetPayload<{ select: typeof SALES_WIZARD_PRODUCT_SELECT }>;

/** The raw (pre-mapping) rows — the boundary the integration test exercises
 *  directly. Callers that need to match a saved line's comCode (the
 *  quotation-prefill and edit-reconciliation paths) use these rows directly;
 *  `toFormProducts` below narrows further for the client component, which
 *  never needs the comCode string itself (just id/label/valueType/value). */
export async function fetchActiveSalesWizardProducts(): Promise<SalesWizardProductRow[]> {
  return prisma.product.findMany({
    where: { activeStatus: ProductActiveStatus.Active, archivedAt: null },
    select: SALES_WIZARD_PRODUCT_SELECT,
    orderBy: { productCode: "asc" },
  });
}

export function toFormProducts(rows: SalesWizardProductRow[]): FormProduct[] {
  return rows.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    companyName: p.defaultCompany?.name ?? "—",
    requiresAshesAgreement: p.requiresAshesAgreement,
    listedPrice: p.listedPrice?.toString() ?? null,
    // No discount set means the discounted price IS the listed price (owner's
    // rule), so the card never shows a blank where a figure belongs.
    discountedPrice: (p.discountedPrice ?? p.listedPrice)?.toString() ?? null,
    comCodes: p.comCodes.map((c) => ({ id: c.id, label: c.label, valueType: c.valueType, value: c.value.toString() })),
  }));
}
