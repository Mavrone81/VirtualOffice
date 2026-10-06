import { D, round2, pctOf, ZERO, type Numeric } from "@/lib/money";

/** A value entered as a percentage (of the sales amount) or an absolute amount. */
export type PreviewField = { value: Numeric; percent: boolean };

export type ProductPreviewInput = {
  salesAmount: Numeric;
  closing: PreviewField;
  companyCutPool: PreviewField;
  smOverride: PreviewField;
  sdOverride: PreviewField;
  /** External product (2026-10): the retained base is a % of the sale instead
   *  of the whole sale, and the rest routes to the provider. Defaults false —
   *  omitting both this and externalRetainedPct keeps every existing call
   *  (internal) byte-identical. */
  isExternal?: boolean;
  /** Always a plain percentage (no absolute option) — mirrors the engine's
   *  and the schema's externalCompanyRetainedPct exactly. Ignored unless
   *  isExternal is true. */
  externalRetainedPct?: Numeric;
};

export type ProductPreview = {
  salesAmount: string;
  closing: string;
  companyCutPool: string;
  smOverride: string;
  sdOverride: string;
  netToCloser: string;
  companyRetained: string;
  /** The base companyRetained is computed from: the sale itself (internal),
   *  or its configured retained share (external). */
  retainedBase: string;
  /** What routes to the external provider (sale − retainedBase). Zero for
   *  an internal product. */
  externalPayable: string;
};

function amount(base: import("@prisma/client").Prisma.Decimal, f: PreviewField) {
  return f.percent ? pctOf(base, D(f.value)) : round2(f.value);
}

/**
 * Live product-creation preview (VO_System_Workflows_v7 §6A.2, extended
 * 2026-10 for external products). Every % field computes on the Sales
 * Amount. Mirrors the commission engine's product-level math exactly
 * (server/commission/engine.ts's computeLineCommission) so the admin sees
 * what the ledger will book — same formula, same variable names:
 *   Net to Closer     = Closing − Company Cut Pool
 *   Retained Base     = Sales (internal), or externalRetainedPct of Sales
 *   Company Retained  = Retained Base − Net to Closer − SM − SD overriding
 * i.e. the company's total take, the same figure the engine writes as the
 * CompanyRetained line — including going negative for an external product,
 * which is permitted (owner ruling; see the engine's own header comment for
 * the full worked arithmetic). When Closing is 100% and the product is
 * internal this is exactly Company Cut Pool − SM Overriding − SD Overriding.
 *
 * (It used to be Sales − Closing − overrides, which left the Cut Pool out and
 * went negative at 100% closing: $10,000 / 10% / 2% / 1% showed −$300 while the
 * engine booked $700. lib/commission-preview.test.ts pins this preview
 * against the real engine output so the two can never drift apart again —
 * for external products too, since a preview that disagrees with the engine
 * is worse than no preview.)
 */
export function computeProductPreview(i: ProductPreviewInput): ProductPreview {
  const sale = round2(i.salesAmount);
  const closing = amount(sale, i.closing);
  const cutPool = amount(sale, i.companyCutPool);
  const sm = amount(sale, i.smOverride);
  const sd = amount(sale, i.sdOverride);
  const netToCloser = round2(closing.sub(cutPool));
  const retainedBase = i.isExternal ? pctOf(sale, D(i.externalRetainedPct ?? 0)) : sale;
  const externalPayable = i.isExternal ? round2(sale.sub(retainedBase)) : ZERO;
  const companyRetained = round2(retainedBase.sub(netToCloser).sub(sm).sub(sd));
  return {
    salesAmount: sale.toString(),
    closing: closing.toString(),
    companyCutPool: cutPool.toString(),
    smOverride: sm.toString(),
    sdOverride: sd.toString(),
    netToCloser: netToCloser.toString(),
    companyRetained: companyRetained.toString(),
    retainedBase: retainedBase.toString(),
    externalPayable: externalPayable.toString(),
  };
}

/** True once the overrides eat into the cut pool enough that company retained goes negative (B-10). */
export function isOverAllocated(preview: ProductPreview): boolean {
  return Number(preview.companyRetained) < 0;
}
