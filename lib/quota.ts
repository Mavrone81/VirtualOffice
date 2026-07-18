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
