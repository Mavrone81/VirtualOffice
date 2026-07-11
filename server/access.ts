import { auth } from "@/auth";
import { downlineIds, isAdminRole } from "@/lib/rbac";
import { resolveScope, type Principal } from "@/lib/access";

/** Resolve the current request's Principal from the Auth.js session. */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;
  const associateId = user.associateId ?? null;
  const scope = await resolveScope(user.role, associateId, downlineIds);
  return { userId: user.id, role: user.role, associateId, scope };
}

/** The principal iff it is an admin-area role, else null (for `{ ok, error }` actions). */
export async function getAdminPrincipal(): Promise<Principal | null> {
  const p = await getPrincipal();
  return p && isAdminRole(p.role) ? p : null;
}
