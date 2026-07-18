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
 * math so the admin sees exactly how a product will pay out:
 *   Net to Closer   = Closing − Company Cut Pool
 *   Company Retained = Sales − Closing − SM Overriding − SD Overriding
 * (Company's total take = Company Retained + Company Cut Pool.)
 */
export function computeProductPreview(i: ProductPreviewInput): ProductPreview {
  const sale = round2(i.salesAmount);
  const closing = amount(sale, i.closing);
  const cutPool = amount(sale, i.companyCutPool);
  const sm = amount(sale, i.smOverride);
  const sd = amount(sale, i.sdOverride);
  const netToCloser = round2(closing.sub(cutPool));
  const companyRetained = round2(sale.sub(closing).sub(sm).sub(sd));
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
