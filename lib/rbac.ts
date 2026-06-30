import { AppRole } from "@prisma/client";
import { prisma } from "./db";

// Where each role lands after login.
export const ROLE_HOME: Record<AppRole, string> = {
  Admin: "/admin/dashboard",
  Accounts: "/admin/dashboard",
  SalesDirector: "/portal/dashboard",
  SalesManager: "/portal/dashboard",
  Consultant: "/portal/dashboard",
};

export const ADMIN_ROLES: AppRole[] = ["Admin", "Accounts"];
export const isAdminRole = (r: AppRole): boolean => ADMIN_ROLES.includes(r);

export const roleLabel: Record<AppRole, string> = {
  Admin: "Product Owner",
  Accounts: "Accounts",
  SalesDirector: "Sales Director",
  SalesManager: "Sales Manager",
  Consultant: "Sales Consultant",
};

/**
 * Recursive downline closure: the associate plus all recursive descendants by
 * `direct_upline_id` (archived excluded). Used for SD/SM scoping (PRD §5).
 */
export async function downlineIds(associateId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE dl AS (
      SELECT id FROM associates WHERE id = ${associateId}::uuid AND archived_at IS NULL
      UNION
      SELECT a.id FROM associates a
      JOIN dl ON a.direct_upline_id = dl.id
      WHERE a.archived_at IS NULL
    )
    SELECT id::text FROM dl;`;
  return rows.map((r) => r.id);
}
