import { prisma } from "@/lib/db";
import { sum } from "@/lib/money";

export type ProductSales = { productCode: string; productName: string; total: ReturnType<typeof sum> };

/**
 * B-6's "Product sales" chart data: total sale amount per product, for
 * booked (closed) transactions whose salesDate falls in [from, to). A plain
 * sum aggregate (same groupBy+_sum pattern as server/assistant/system-context.ts),
 * not commission math. `from`/`to` are already-validated UTC Dates (to is
 * exclusive — the caller resolves the period the same way B-3/B-4 do).
 *
 * Grouped by productCode ONLY — SaleLineItem.productName is a snapshot taken
 * at submission time, so a renamed product would otherwise split into two
 * bars (DevLead review). The display name comes from the Product table's
 * current version for that code (same "current version at a date" lookup as
 * server/sales/actions.ts' line-item resolution, dated today); if the
 * product itself was deleted, it falls back to the most recent line item's
 * snapshot name for that code.
 */
export async function productSalesByPeriod(from: Date, to: Date): Promise<ProductSales[]> {
  const grouped = await prisma.saleLineItem.groupBy({
    by: ["productCode"],
    where: { transactionId: { not: null }, transaction: { salesDate: { gte: from, lt: to } } },
    _sum: { lineSaleAmount: true },
  });
  if (grouped.length === 0) return [];

  const codes = grouped.map((g) => g.productCode);
  const currentProducts = await prisma.product.findMany({
    where: { productCode: { in: codes }, effectiveDate: { lte: new Date() } },
    orderBy: { effectiveDate: "desc" },
    select: { productCode: true, productName: true },
  });
  const nameByCode = new Map<string, string>();
  for (const p of currentProducts) if (!nameByCode.has(p.productCode)) nameByCode.set(p.productCode, p.productName);

  const missingCodes = codes.filter((c) => !nameByCode.has(c));
  if (missingCodes.length > 0) {
    const fallbackRows = await prisma.saleLineItem.findMany({
      where: { productCode: { in: missingCodes }, transactionId: { not: null }, transaction: { salesDate: { gte: from, lt: to } } },
      orderBy: { createdAt: "desc" },
      select: { productCode: true, productName: true },
    });
    for (const r of fallbackRows) if (!nameByCode.has(r.productCode)) nameByCode.set(r.productCode, r.productName);
  }

  return grouped
    .map((g) => ({
      productCode: g.productCode,
      productName: nameByCode.get(g.productCode) ?? g.productCode,
      total: sum([g._sum.lineSaleAmount ?? 0]),
    }))
    .sort((a, b) => (a.total.lt(b.total) ? 1 : a.total.gt(b.total) ? -1 : 0));
}
