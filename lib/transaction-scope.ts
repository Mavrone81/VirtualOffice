import type { AppRole } from "@prisma/client";
import { downlineIds } from "./rbac";
import { teamScopeIds } from "./team";

/**
 * Which associates' transactions/submissions a viewer sees (consolidated-menu
 * rework, Sep 2026 — the user's visibility ladder):
 *  - Admin / Accounts   → everyone (callers skip the id filter entirely).
 *  - Sales Director     → every submission under their team(s).
 *  - SM / SAM / SA      → themselves + their recruited downline (self-inclusive;
 *                         an associate with no recruits sees only their own).
 *
 * Returns null for admin roles ("no filter"), else the associate-id allowlist.
 */
export async function transactionScopeIds(
  role: AppRole,
  associateId: string | null,
): Promise<string[] | null> {
  if (role === "Admin" || role === "Accounts") return null;
  if (!associateId) return [];
  if (role === "SalesDirector") return teamScopeIds(associateId);
  return downlineIds(associateId);
}
