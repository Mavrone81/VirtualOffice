import { Prisma } from "@prisma/client";

// Money is always Prisma.Decimal (NUMERIC(14,2)) — never JS float.
// Round half-up to 2dp; residual is pushed into Company Retained by the engine
// so the per-line split always reconciles to the closing commission.
export type Money = Prisma.Decimal;

export type Numeric = Prisma.Decimal | number | string;

export const D = (v: Numeric): Prisma.Decimal => new Prisma.Decimal(v);

export const ZERO = new Prisma.Decimal(0);

/** Round to 2 decimal places, half-up. */
export function round2(v: Numeric): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** `amount * percentage%`, rounded to 2dp. */
export function pctOf(amount: Numeric, percentage: Numeric): Prisma.Decimal {
  return round2(D(amount).mul(D(percentage)).div(100));
}

export function sum(values: Numeric[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.add(D(v)), new Prisma.Decimal(0));
}

export function eq(a: Numeric, b: Numeric): boolean {
  return D(a).equals(D(b));
}

/** Clamp v into [min, max] (inclusive). */
export function clamp(v: Numeric, min: Numeric, max: Numeric): Prisma.Decimal {
  return Prisma.Decimal.max(D(min), Prisma.Decimal.min(D(v), D(max)));
}

/** "1234.5" -> "1,234.50" */
export function formatSGD(v: Numeric): string {
  return (
    "S$" +
    round2(v)
      .toNumber()
      .toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** "12.5000" -> "12.50%", "7.1250" -> "7.13%" (half-up, via round2 — Decimal-
 *  safe, never Number().toFixed on a float string). Display only: the stored
 *  value keeps its full precision, and no calculation rounds through this. */
export function formatPercent(v: Numeric): string {
  return round2(v).toFixed(2) + "%";
}

/** Several fields on Product (companyCutPct, smOverridePct, sdOverridePct)
 *  can each be configured as a % of the sale OR an absolute $ amount — the
 *  *Type column next to each records which. Render by that type, not by
 *  assuming %: an Absolute value run through formatPercent would print a
 *  dollar figure with a "%" sign after it. */
export function formatByValueType(v: Numeric, valueType: "Percentage" | "Absolute"): string {
  return valueType === "Absolute" ? formatSGD(v) : formatPercent(v);
}

// ---------------------------------------------------------------------------
// Product pricing (2026-09-30) — the one place this arithmetic happens, so
// the portal/admin UI never computes money itself.
// ---------------------------------------------------------------------------

/** The price a buyer actually pays: the discount if one is set, else the
 *  listed price. A selection, not a calculation — nothing to round here. */
export function effectivePrice(listed: Numeric, discounted: Numeric | null | undefined): Prisma.Decimal {
  return discounted == null ? D(listed) : D(discounted);
}

export type ClosingBasis = "ListedPrice" | "DiscountedPrice";

/** Closing basis (2026-10-01): commission, company cut and the overrides are
 *  all calculated against WHICHEVER price the product's `closingBasis`
 *  names — an explicit per-product choice, unlike `effectivePrice` above
 *  (which always prefers a discount when one exists). Falls back to
 *  `listed` when `basis` is `DiscountedPrice` but `discounted` is missing:
 *  the server rejects that combination at write time (lib/schemas.ts
 *  pricingRefine), so this function should never see it in practice, but a
 *  "should never" is not a guarantee a row from before this invariant
 *  existed, or a caller that bypasses validation, can rely on. */
export function closingPrice(listed: Numeric, discounted: Numeric | null | undefined, basis: ClosingBasis): Prisma.Decimal {
  return basis === "DiscountedPrice" && discounted != null ? D(discounted) : D(listed);
}

export type InstalmentSchedule = { regular: Prisma.Decimal; final: Prisma.Decimal };

/**
 * THE one place an instalment schedule is computed (owner's change,
 * 2026-10-09 follow-up) — the product no longer stores a monthly figure;
 * every surface that shows one derives it here, from (closing price,
 * booking fee, months) at render/read time, so it can never go stale
 * against a later price edit.
 *
 * basis = closingPrice − bookingFee, in CENTS, as an exact Prisma.Decimal
 * operation throughout — never a JavaScript float. `D(v).mul(100)` on a
 * 2dp-precision Decimal is exact (no `0.29 * 100 = 28.999999999999996`
 * artifact is possible, because Decimal multiplication isn't binary
 * floating point), so the `.toDecimalPlaces(0, ROUND_HALF_UP)` below is a
 * defensive no-op on this input shape, not the load-bearing step it would
 * be on a float path — stated explicitly rather than silently relied on.
 *
 * `regular` is floor(basisCents / months) — safe as plain integer
 * division (dividedToIntegerBy truncates toward zero, which equals floor
 * for the non-negative basis this function guarantees) — applied to
 * months−1 payments; `final` absorbs whatever floor() left over, so the
 * schedule always sums to EXACTLY basis, never basis ± a rounding cent.
 * Floor, not round-to-nearest: rounding the regular to the nearest cent can
 * push it ABOVE the true average, which then forces `final` BELOW
 * `regular` — a customer's last payment reading smaller than every other
 * one, which is the shape of error this function exists to remove.
 *
 * Returns null when bookingFee exceeds closingPrice (a negative basis is
 * refused outright, not computed — floor() on a negative tends toward
 * minus infinity, so it would not even fail loudly). bookingFee EQUAL to
 * closingPrice is allowed through to a well-defined (if commercially odd)
 * $0.00-every-instalment schedule: it is arithmetically consistent, and
 * rejecting it would be a business rule nobody asked for, not a safety
 * guarantee like the negative-basis case.
 */
export function deriveInstalmentSchedule(closingPriceAmt: Numeric, bookingFee: Numeric, months: number): InstalmentSchedule | null {
  if (!Number.isInteger(months) || months < 1) return null;
  const basis = D(closingPriceAmt).sub(D(bookingFee));
  if (basis.isNegative()) return null;
  const basisCents = basis.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const regularCents = basisCents.dividedToIntegerBy(months);
  const finalCents = basisCents.sub(regularCents.mul(months - 1));
  return { regular: regularCents.div(100), final: finalCents.div(100) };
}

/** Soft admin hint only (no DB constraint behind it, 2026-09-30): the
 *  total a buyer pays across the instalment plan. `monthly * months` is
 *  exact for Decimal(14,2) inputs and a whole-number `months` (no fractional
 *  digits are introduced), so ALL rounding in this function happens exactly
 *  once, at the very end, on the summed total — never per-term. Stated
 *  explicitly because rounding before vs. after summing can give different
 *  money for other shapes of this calculation, even though this one exact
 *  input shape doesn't currently exercise that difference. */
export function instalmentTotal(bookingFee: Numeric, monthly: Numeric, months: number): Prisma.Decimal {
  return round2(D(bookingFee).add(D(monthly).mul(months)));
}
