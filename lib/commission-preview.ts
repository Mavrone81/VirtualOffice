import { D, round2, pctOf, type Numeric } from "@/lib/money";

/** A value entered as a percentage (of the sales amount) or an absolute amount. */
export type PreviewField = { value: Numeric; percent: boolean };

export type ProductPreviewInput = {
  salesAmount: Numeric;
  closing: PreviewField;
  companyCutPool: PreviewField;
  smOverride: PreviewField;
  sdOverride: PreviewField;
};

export type ProductPreview = {
  salesAmount: string;
  closing: string;
  companyCutPool: string;
  smOverride: string;
  sdOverride: string;
  netToCloser: string;
  companyRetained: string;
};

function amount(base: import("@prisma/client").Prisma.Decimal, f: PreviewField) {
  return f.percent ? pctOf(base, D(f.value)) : round2(f.value);
}

/**
 * Live product-creation preview (VO_System_Workflows_v7 §6A.2). Every % field
 * computes on the Sales Amount. Mirrors the commission engine's product-level
 * math (server/commission/engine.ts) so the admin sees exactly what the ledger
 * will book:
 *   Net to Closer    = Closing − Company Cut Pool
 *   Company Retained = Sales − Net to Closer − SM Overriding − SD Overriding
 * i.e. the company's total take, the same figure the engine writes as the
 * CompanyRetained line. When Closing is 100% this is exactly
 * Company Cut Pool − SM Overriding − SD Overriding.
 *
 * (It used to be Sales − Closing − overrides, which left the Cut Pool out and
 * went negative at 100% closing: $10,000 / 10% / 2% / 1% showed −$300 while the
 * engine booked $700.)
 */
export function computeProductPreview(i: ProductPreviewInput): ProductPreview {
  const sale = round2(i.salesAmount);
  const closing = amount(sale, i.closing);
  const cutPool = amount(sale, i.companyCutPool);
  const sm = amount(sale, i.smOverride);
  const sd = amount(sale, i.sdOverride);
  const netToCloser = round2(closing.sub(cutPool));
  const companyRetained = round2(sale.sub(netToCloser).sub(sm).sub(sd));
  return {
    salesAmount: sale.toString(),
    closing: closing.toString(),
    companyCutPool: cutPool.toString(),
    smOverride: sm.toString(),
    sdOverride: sd.toString(),
    netToCloser: netToCloser.toString(),
    companyRetained: companyRetained.toString(),
  };
}
