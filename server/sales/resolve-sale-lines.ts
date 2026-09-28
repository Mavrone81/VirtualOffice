import { prisma } from "@/lib/db";
import { round2, sum } from "@/lib/money";

/** Resolve submitted lines into persisted line-item data + the total. Shared by
 * submitSale + editSale so both build line items identically; also used by
 * A-17's createQuotation, which server-prices its lines the exact same way.
 * Not a server action: this file has no `"use server"` directive, so nothing
 * here is a client-callable endpoint — the two callers import it as a plain
 * function. */
export async function resolveSaleLines(lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[]) {
  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, include: { comCodes: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const lineData = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) throw new Error("Unknown product");
    const selected = p.comCodes
      .filter((c) => l.comCodeIds.includes(c.id))
      .map((c) => ({ comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString() }));
    return {
      companyId: p.defaultCompanyId ?? products[0].defaultCompanyId!,
      productCode: p.productCode,
      productName: p.productName,
      commissionType: p.commissionType,
      lineSaleAmount: round2(l.lineSaleAmount),
      isExternal: p.isExternal,
      selectedComCodes: selected,
    };
  });
  // A-17 §4: lineData feeds straight into SaleLineItem.create (no such column
  // there), so the ashes flag is surfaced separately rather than added to it.
  const needsAshesAgreement = lines.some((l) => byId.get(l.productId)?.requiresAshesAgreement === true);
  return { lineData, saleAmount: sum(lineData.map((l) => l.lineSaleAmount)), needsAshesAgreement };
}
