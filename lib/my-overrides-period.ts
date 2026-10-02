import type { MyOverridesView } from "@/components/team/my-overrides-controls";

const YEAR_WINDOW = 4; // current year back 4 (5 years total) — no established range in the app; arbitrary, stated here.

export type MyOverridesPeriod = {
  view: MyOverridesView;
  month: number; // 1-12
  year: number;
  payoutMonth: string; // "YYYY-MM"
  yearOptions: number[];
};

/**
 * Resolves the My Overrides card's own view/month/year from this page's
 * query params, defaulting to the current month and year and to the
 * OVERALL view when a param is absent or malformed. Pure (takes `now`
 * explicitly) so it's testable without faking the system clock.
 */
export function resolveMyOverridesPeriod(
  sp: { moView?: string; moMonth?: string; moYear?: string },
  now: Date,
): MyOverridesPeriod {
  const view: MyOverridesView = sp.moView === "received" ? "received" : "overall";

  const monthNum = Number(sp.moMonth);
  const month = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : now.getMonth() + 1;

  const yearNum = Number(sp.moYear);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2999 ? yearNum : now.getFullYear();

  const payoutMonth = `${year}-${String(month).padStart(2, "0")}`;
  const yearOptions = Array.from({ length: YEAR_WINDOW + 1 }, (_, i) => now.getFullYear() - YEAR_WINDOW + i);

  return { view, month, year, payoutMonth, yearOptions };
}
