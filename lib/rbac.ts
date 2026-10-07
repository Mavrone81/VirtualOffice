import { AppRole, Designation } from "@prisma/client";
import { prisma } from "./db";

// Prisma-free (nav.ts imports this without pulling Prisma into the client
// bundle) — see lib/roles.ts.
export { RECRUITER_ROLES, canRecruit, MANAGER_ROLES, isManagerRole } from "./roles";

// Where each role lands after login.
export const ROLE_HOME: Record<AppRole, string> = {
  Admin: "/admin/dashboard",
  Accounts: "/admin/dashboard",
  SalesDirector: "/portal/dashboard",
  SalesManager: "/portal/dashboard",
  SalesAssistantManager: "/portal/dashboard",
  SalesAssociate: "/portal/dashboard",
};

/**
 * A sales associate's AppRole is DERIVED from the designation given at
 * onboarding (16-Jul model, user-confirmed). Admin ("Business Admin") and
 * Accounts are system roles assigned to office staff, never derived here.
 */
export function roleForDesignation(d: Designation): AppRole {
  switch (d) {
    // No AppRole for this one: it is a sales designation the owner added for
    // the managing-director cut (2026-10-07), not an access change, so it takes
    // the highest existing sales role. Kept exhaustive deliberately — the
    // compiler flagged this the moment the enum grew, which is the point.
    case "ManagingDirector": return "SalesDirector";
    case "SalesDirector": return "SalesDirector";
    case "SalesManager": return "SalesManager";
    case "SalesAssistantManager": return "SalesAssistantManager";
    case "SalesAssociate": return "SalesAssociate";
  }
}

export const ADMIN_ROLES: AppRole[] = ["Admin", "Accounts"];
export const isAdminRole = (r: AppRole): boolean => ADMIN_ROLES.includes(r);

/** True only for the full "Business Admin" — not the Accounts role. */
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
 * portal roles (SA/SAM/SM/SD) hold none of these admin capabilities.
 */
export function can(role: AppRole, capability: Capability): boolean {
  if (role === "Admin") return true;
  if (role === "Accounts") return !ADMIN_ONLY_CAPABILITIES.has(capability);
  return false;
}

export const roleLabel: Record<AppRole, string> = {
  Admin: "Business Admin",
  Accounts: "Accounts",
  SalesDirector: "Sales Director",
  SalesManager: "Sales Manager",
  SalesAssistantManager: "Sales Assistant Manager",
  SalesAssociate: "Sales Associate",
};

/**
 * ITEM 7 (downline lookup). THE single choke point for who may look up WHOSE
 * downline — used for both halves of that feature, which are two separate
 * authorisation decisions on one rule, not one:
 *   (a) the search box — which names it may even return (returning a name
 *       the viewer may not open is itself a disclosure: who exists, their
 *       code, their designation — even before any click-through refusal);
 *   (b) the subject query — whose rows the resulting table may show.
 * Call this ONCE per request and use its result for both; never re-derive
 * the same condition at either call site.
 *
 * Admin/Accounts: `null`, meaning UNRESTRICTED — deliberately not an array,
 * so a caller can never mistake "no limit" for "empty" (`[].includes(x)` is
 * always false, which would make an admin's lookup refuse everything).
 * Every other role: their OWN downline (self-inclusive, via {@link
 * downlineIds}) — a director sees their own team only, never a peer
 * director's, by the owner's explicit ruling. A subject id a caller got from
 * a query parameter must be checked against this before it is trusted for
 * anything; "admin sees everyone" widens what this returns, it does not
 * remove the check at either call site.
 */
export async function downlineLookupScope(viewer: { associateId: string; role: AppRole }): Promise<string[] | null> {
  if (isAdminRole(viewer.role)) return null;
  return downlineIds(viewer.associateId);
}

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

/**
 * Direct recruits only: the associates whose `direct_upline_id` is this
 * associate (ONE level down, archived excluded). Contrast {@link downlineIds},
 * which walks the whole tree and includes self. Not self-inclusive.
 */
export async function directRecruits(
  associateId: string,
): Promise<{ id: string; fullName: string; associateCode: string }[]> {
  return prisma.associate.findMany({
    where: { directUplineId: associateId, archivedAt: null },
    select: { id: true, fullName: true, associateCode: true },
    orderBy: { fullName: "asc" },
  });
}
