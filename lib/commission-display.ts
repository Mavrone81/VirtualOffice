import { D, formatPercent, formatSGD, type Numeric } from "./money";

// Whether a product's closing commission is real enough to show at all
// (2026-10-01): a null field (never configured) and an explicit zero (no
// commission by design, e.g. some external products) both mean "nothing to
// show" — a 0% or S$0.00 line reads as a real figure, not an absence.
export function hasCommission(
  commissionType: "Percentage" | "Fixed",
  closingCommPct: Numeric | null | undefined,
  closingCommFixed: Numeric | null | undefined,
): boolean {
  const raw = commissionType === "Fixed" ? closingCommFixed : closingCommPct;
  if (raw == null) return false;
  return !D(raw).isZero();
}

/** The formatted commission figure, or null when there's nothing to show
 *  (see hasCommission) — callers render nothing on null rather than a 0. */
export function commissionDisplay(
  commissionType: "Percentage" | "Fixed",
  closingCommPct: Numeric | null | undefined,
  closingCommFixed: Numeric | null | undefined,
): string | null {
  if (!hasCommission(commissionType, closingCommPct, closingCommFixed)) return null;
  return commissionType === "Fixed" ? formatSGD(closingCommFixed as Numeric) : formatPercent(closingCommPct as Numeric);
}
