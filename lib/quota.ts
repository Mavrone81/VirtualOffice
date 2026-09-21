import type { AppRole } from "@prisma/client";

/**
 * Authority for setting a monthly sales quota (16-Jul §3). Business Admin and
 * Sales Director rank highest, then Sales Manager, then Sales Assistant Manager.
 * Everyone else (Sales Associate, Accounts) has no quota-setting authority.
 */
function quotaAuthority(role: AppRole): number {
  switch (role) {
    case "Admin":
    case "SalesDirector":
      return 3;
    case "SalesManager":
      return 2;
    case "SalesAssistantManager":
      return 1;
    default:
      return 0;
  }
}

/** SAM and above may set a team member's quota. */
export const canSetQuota = (role: AppRole): boolean => quotaAuthority(role) > 0;

/**
 * Whether `newSetter` may overwrite a quota previously set by `existingSetByRole`.
 * A Director's value overrides a Manager's; equal authority can overwrite; a
 * lower authority cannot override a higher one.
 */
export function canOverrideQuota(existingSetByRole: AppRole, newSetter: AppRole): boolean {
  return quotaAuthority(newSetter) > 0 && quotaAuthority(newSetter) >= quotaAuthority(existingSetByRole);
}

/**
 * Targets (associate-portal changes, Sep 2026 — A4). The same SalesQuota row
 * holds both periods: `month` = "YYYY-MM" for a monthly target, "YYYY" for a
 * yearly one. Targets are measured in COMMISSION (not sales), so the amount
 * still to reach is the target less commission already received in that
 * period — never below zero.
 */
export const MONTH_KEY = /^\d{4}-\d{2}$/;
export const YEAR_KEY = /^\d{4}$/;
export const isTargetPeriod = (p: string): boolean => MONTH_KEY.test(p) || YEAR_KEY.test(p);

export function periodKeys(now: Date): { month: string; year: string } {
  const year = String(now.getFullYear());
  return { month: `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`, year };
}

/** Whether a ledger payout month ("YYYY-MM") falls in a target period ("YYYY-MM" or "YYYY"). */
export const inPeriod = (payoutMonth: string, period: string): boolean =>
  YEAR_KEY.test(period) ? payoutMonth.startsWith(period + "-") : payoutMonth === period;

export function remainingToTarget(target: number, received: number): number {
  return Math.max(0, Math.round((target - received) * 100) / 100);
}
