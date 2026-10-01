import { Prisma, ProductActiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FormProduct } from "@/app/portal/sales/new/sale-form";

// Sales wizard (2026-10-01): the new/edit sale pages only need a product's
// identity, its active add-on com codes, and its billing company — never
// commission, company cut, pricing or any other column on Product. An
// explicit select keeps that true at the query itself, not just at whatever
// the page later chooses to read off a full row. See
// sales-wizard-products.integration.test.ts for the proof (with controls
// that fail if this select is widened).
export const SALES_WIZARD_PRODUCT_SELECT = {
  id: true,
  productCode: true,
  productName: true,
  requiresAshesAgreement: true,
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
    comCodes: p.comCodes.map((c) => ({ id: c.id, label: c.label, valueType: c.valueType, value: c.value.toString() })),
  }));
}
