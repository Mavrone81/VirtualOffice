import { parseDateOnly, parseDateOnlyExclusiveEnd } from "@/lib/url-filters";

export type Period = "month" | "quarter" | "year" | "custom";
export const PERIODS: Period[] = ["month", "quarter", "year", "custom"];

/** [from, to) — `to` is exclusive, matching the rest of the app's date-range convention. */
export type DateRange = { from: Date; to: Date };

/**
 * B-6's period selector (This month / This quarter / This year / Custom
 * range). All computed in UTC via Date.UTC, never date-fns' local-time
 * start-of-* helpers, so the boundary doesn't shift a day depending on the
 * server's timezone (see lib/url-filters.ts).
 */
export function resolvePeriod(period: Period, now: Date, custom?: { from?: string; to?: string }): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "quarter") {
    const q = Math.floor(m / 3);
    return { from: new Date(Date.UTC(y, q * 3, 1)), to: new Date(Date.UTC(y, q * 3 + 3, 1)) };
  }
  if (period === "year") {
    return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)) };
  }
  if (period === "custom") {
    const from = parseDateOnly(custom?.from) ?? new Date(Date.UTC(y, m, 1));
    const to = parseDateOnlyExclusiveEnd(custom?.to) ?? new Date(Date.UTC(y, m + 1, 1));
    return { from, to };
  }
  return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
}
