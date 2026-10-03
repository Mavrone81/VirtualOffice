import { prisma } from "@/lib/db";
import { round2, sum } from "@/lib/money";
import { VERSION_RESOLUTION_ORDER } from "@/server/commission/version-order";
import type { RateSnapshot } from "@/server/commission/inputs";

/** Resolve submitted lines into persisted line-item data + the total. Shared by
 * submitSale + editSale so both build line items identically; also used by
 * A-17's createQuotation, which server-prices its lines the exact same way.
 * Not a server action: this file has no `"use server"` directive, so nothing
 * here is a client-callable endpoint — the callers import it as a plain
 * function.
 *
 * `onDate` is the sale's date. Each line's `commissionType` and `isExternal` come
 * from the rate version in force on that date — the SAME version (same ordering)
 * the sale resolves its rates from at verify and in the split-bound check — so a
 * line's shape and its rates have one source and cannot disagree. Reading them
 * from the product row's current columns instead (which mirror the LATEST
 * version) let a sale dated before a rate change carry the new type with the old
 * rates. With no version in force (a legacy product, or no date given) the
 * product's own columns are used, as before. */
export async function resolveSaleLines(lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[], onDate?: string | Date) {
  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, include: { comCodes: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const inForce = new Map<string, RateSnapshot>();
  if (onDate !== undefined && products.length > 0) {
    const versions = await prisma.commissionStructureVersion.findMany({
      where: { productCode: { in: products.map((p) => p.productCode) }, effectiveDate: { lte: new Date(onDate) } },
      orderBy: [{ productCode: "asc" }, ...VERSION_RESOLUTION_ORDER],
      select: { productCode: true, rateSnapshot: true },
    });
    for (const v of versions) if (!inForce.has(v.productCode)) inForce.set(v.productCode, v.rateSnapshot as unknown as RateSnapshot);
  }
  const lineData = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) throw new Error("Unknown product");
    const selected = p.comCodes
      .filter((c) => l.comCodeIds.includes(c.id))
      .map((c) => ({ comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString() }));
    const rs = inForce.get(p.productCode);
    return {
      companyId: p.defaultCompanyId ?? products[0].defaultCompanyId!,
      productCode: p.productCode,
      productName: p.productName,
      commissionType: rs?.commissionType ?? p.commissionType,
      lineSaleAmount: round2(l.lineSaleAmount),
      isExternal: rs?.isExternal ?? p.isExternal,
      selectedComCodes: selected,
    };
  });
  // A-17 §4: lineData feeds straight into SaleLineItem.create (no such column
  // there), so the ashes flag is surfaced separately rather than added to it.
  const needsAshesAgreement = lines.some((l) => byId.get(l.productId)?.requiresAshesAgreement === true);
  return { lineData, saleAmount: sum(lineData.map((l) => l.lineSaleAmount)), needsAshesAgreement };
}
