import { CommissionType, ComValueType } from "@prisma/client";
import { D, round2, formatSGD, type Numeric } from "@/lib/money";
import { computeProductPreview } from "@/lib/commission-preview";

export type BreakdownProduct = {
  productCode: string;
  productName: string;
  isExternal: boolean;
  externalCompanyRetainedPct: Numeric | null;
  commissionType: CommissionType;
  closingCommPct: Numeric | null;
  closingCommFixed: Numeric | null;
  companyCutPct: Numeric;
  companyCutType: ComValueType;
  smOverridePct: Numeric;
  smOverrideType: ComValueType;
  sdOverridePct: Numeric;
  sdOverrideType: ComValueType;
};

export type ProductBreakdownRow =
  | {
      productCode: string; productName: string; kind: "external";
      providerKeepsPct: string;
      // Present only for the uniform-percentage case (the real case in
      // production, and the only one this computes through the engine's own
      // formula — see computeProductBreakdown's header comment). A Fixed or
      // mixed-type external product has no real instance to date; its row
      // carries providerKeepsPct only, same as before this change, rather
      // than a sale-dependent figure invented for a case nothing exercises.
      netToCloser?: string; directOverride?: string; secondOverride?: string; companyRetained?: string;
    }
  | {
      productCode: string; productName: string; kind: "uniform";
      netToCloser: string; directOverride: string; secondOverride: string;
      /** The plain rate/amount (percent case), or just the $X in "Sale − $X" when `companyRetainedIsExpression`. */
      companyRetained: string;
      /** True for the pure-Fixed case: the caller renders "Sale − {companyRetained}" (i18n'd), not a bare figure. */
      companyRetainedIsExpression?: boolean;
    }
  | { productCode: string; productName: string; kind: "mixed"; directOverride: string; secondOverride: string };

const pct = (v: Numeric) => `${Number(v)}%`;

// computeProductPreview rounds to 2dp at whatever base it's given. Rates are
// stored at Decimal(7,4), so a base of 100 (used for uniform-percent below)
// would truncate a 10.1234% rate to 10.12%. Using 10,000 instead and dividing
// the result back down by 100 keeps all 4dp (Architect review, 2026-09-26).
const RATE_BASE = "10000";

/**
 * B6c (Admin deck p6): the detail panel shows ONE illustrative sale amount
 * for every percentage product, so comparisons stay like-for-like — this IS
 * that figure, reusing the rounding-safe base above rather than inventing a
 * second number. No product stores a real sale amount; the UI must label
 * this as an example, not a stored value.
 */
export const ILLUSTRATIVE_SALE_AMOUNT = formatSGD(RATE_BASE);
const ratePct = (v: string) => `${D(v).div(100).toString()}%`;

/**
 * B-6: the product breakdown table's per-row "configured split", using the
 * product's CURRENT rates (not a historical version).
 *
 * Pure-percentage: reuses the existing, already-tested computeProductPreview()
 * at a base of 10,000, then divides the result by 100 to recover the rate —
 * no new formula, just a base large enough that computeProductPreview's
 * internal round2 doesn't truncate a Decimal(7,4) rate like 10.1234% down to
 * 10.12% (a base of 100 would; Architect review, 2026-09-26).
 *
 * Pure-Fixed/Absolute: closing/cut/direct/second are real dollar constants
 * that don't scale with any sale amount, so plugging a placeholder base into
 * computeProductPreview's `sale − netToCloser − sm − sd` would be wrong (the
 * engine's actual formula, server/commission/engine.ts `companyTake` — DevLead
 * confirmed retained is NOT "cut pool minus overrides", that only coincides at
 * 100% closing on a percentage product). Net to closer / direct / second ARE
 * sale-independent constants, so they're shown as-is; Company retained is
 * shown as the expression "Sale − X" where X = netToCloser + direct + second
 * — the same formula the engine books, written with the sale left as a
 * variable instead of assuming one.
 *
 * Mixed (some fields % others $ on the same product) can't resolve to either
 * without a concrete sale amount, so both derived figures show "depends on
 * sale amount" instead of guessing a basis.
 *
 * External, uniform-percentage (2026-10, the real case — PETCRE is the only
 * external product in production and it is Percentage/Percentage): the
 * engine now pays the associate on an external line exactly like internal,
 * so this reuses computeProductPreview at RATE_BASE exactly as the internal
 * uniform-percentage branch does below — NOT a second formula — passing
 * isExternal/externalRetainedPct through. The resulting companyRetained can
 * be negative; nothing here clamps it (owner ruling, server/commission/
 * engine.ts's own header comment has the full worked arithmetic). A Fixed or
 * mixed-type external product has no production instance; its row keeps the
 * pre-2026-10 flat providerKeepsPct only — see the type's own comment.
 */
export function computeProductBreakdown(p: BreakdownProduct): ProductBreakdownRow {
  const closingIsPercent = p.commissionType === CommissionType.Percentage;
  const uniform =
    closingIsPercent === (p.companyCutType === ComValueType.Percentage) &&
    closingIsPercent === (p.smOverrideType === ComValueType.Percentage) &&
    closingIsPercent === (p.sdOverrideType === ComValueType.Percentage);

  if (p.isExternal) {
    const retainedPct = Number(p.externalCompanyRetainedPct ?? 0);
    const providerKeepsPct = `${100 - retainedPct}%`;
    if (!uniform || !closingIsPercent) {
      return { productCode: p.productCode, productName: p.productName, kind: "external", providerKeepsPct };
    }
    const preview = computeProductPreview({
      salesAmount: RATE_BASE,
      closing: { value: p.closingCommPct ?? 0, percent: true },
      companyCutPool: { value: p.companyCutPct, percent: true },
      smOverride: { value: p.smOverridePct, percent: true },
      sdOverride: { value: p.sdOverridePct, percent: true },
      isExternal: true,
      externalRetainedPct: p.externalCompanyRetainedPct ?? 0,
    });
    return {
      productCode: p.productCode, productName: p.productName, kind: "external",
      providerKeepsPct: ratePct(preview.externalPayable),
      netToCloser: ratePct(preview.netToCloser),
      directOverride: ratePct(preview.smOverride),
      secondOverride: ratePct(preview.sdOverride),
      companyRetained: ratePct(preview.companyRetained),
    };
  }

  if (!uniform) {
    return {
      productCode: p.productCode, productName: p.productName, kind: "mixed",
      directOverride: p.smOverrideType === ComValueType.Percentage ? pct(p.smOverridePct) : formatSGD(p.smOverridePct),
      secondOverride: p.sdOverrideType === ComValueType.Percentage ? pct(p.sdOverridePct) : formatSGD(p.sdOverridePct),
    };
  }

  if (closingIsPercent) {
    const preview = computeProductPreview({
      salesAmount: RATE_BASE,
      closing: { value: p.closingCommPct ?? 0, percent: true },
      companyCutPool: { value: p.companyCutPct, percent: true },
      smOverride: { value: p.smOverridePct, percent: true },
      sdOverride: { value: p.sdOverridePct, percent: true },
    });
    return {
      productCode: p.productCode, productName: p.productName, kind: "uniform",
      netToCloser: ratePct(preview.netToCloser),
      directOverride: ratePct(preview.smOverride),
      secondOverride: ratePct(preview.sdOverride),
      companyRetained: ratePct(preview.companyRetained),
    };
  }

  // Pure-Fixed/Absolute: real dollar constants, matching the engine's own math exactly.
  const netToCloser = round2(D(p.closingCommFixed ?? 0).sub(D(p.companyCutPct)));
  const directOverride = round2(D(p.smOverridePct));
  const secondOverride = round2(D(p.sdOverridePct));
  const x = netToCloser.add(directOverride).add(secondOverride);
  return {
    productCode: p.productCode, productName: p.productName, kind: "uniform",
    netToCloser: formatSGD(netToCloser),
    directOverride: formatSGD(directOverride),
    secondOverride: formatSGD(secondOverride),
    companyRetained: formatSGD(x),
    companyRetainedIsExpression: true,
  };
}
