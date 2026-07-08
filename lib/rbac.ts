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

/** True only for the full "Product Owner" Admin — not the Accounts role. */
export const isFullAdmin = (r: AppRole): boolean => r === "Admin";

/**
 * Fine-grained capabilities where Admin and Accounts diverge. Both roles share
 * the admin area (see {@link isAdminRole}); the ones below are granted to Admin
 * ONLY per the canonical permission matrix in `docs/05_RBAC.md` §3.
 */
export type Capability =
  | "manage_products" // products, com codes, commission rates/versions
  | "manage_users" // user logins & role management (e.g. reset an associate's password)
  | "manage_companies" // company / invoice entities
  | "manage_others_name_card" // view or manage another user's name card / VCF
  | "manual_commission_override";

// Rows in docs/05_RBAC.md §3 that read Admin ✅ / Accounts ❌.
const ADMIN_ONLY_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "manage_products",
  "manage_users",
  "manage_companies",
  "manage_others_name_card",
  "manual_commission_override",
]);

/**
 * Central capability check (RBAC §4 policy layer). Admin has everything;
 * Accounts has every admin-area capability EXCEPT the Admin-only set above;
 * portal roles (SD/SM/Consultant) hold none of these admin capabilities.
 */
export function can(role: AppRole, capability: Capability): boolean {
  if (role === "Admin") return true;
  if (role === "Accounts") return !ADMIN_ONLY_CAPABILITIES.has(capability);
  return false;
}

// Roles with a downline they manage (team dashboards).
export const MANAGER_ROLES: AppRole[] = ["SalesManager", "SalesDirector"];
export const isManagerRole = (r: AppRole): boolean => MANAGER_ROLES.includes(r);

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
