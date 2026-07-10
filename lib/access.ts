import type { AppRole } from "@prisma/client";
import { isAdminRole, can, type Capability } from "@/lib/rbac";

/** What a principal is allowed to see/act on. `all` = admin (unrestricted). */
export type Scope = { kind: "all" } | { kind: "associates"; ids: string[] };

/** The authenticated caller, resolved once per request. */
export interface Principal {
  userId: string;
  role: AppRole;
  associateId: string | null;
  scope: Scope;
}

/** Thrown by the access layer; callers map `code` to their response/HTTP status. */
export class AccessError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden") {
    super(code);
    this.name = "AccessError";
  }
}

/** True if `associateId` is visible under `scope`. */
export function isInScope(scope: Scope, associateId: string): boolean {
  return scope.kind === "all" || scope.ids.includes(associateId);
}

/** Prisma `where` fragment scoping the `associates` table by id. Empty = unrestricted. */
export function scopedAssociateWhere(scope: Scope): { id?: { in: string[] } } {
  return scope.kind === "all" ? {} : { id: { in: scope.ids } };
}

/** Guard: throw `forbidden` if `associateId` is outside `scope` (IDOR defense). */
export function assertInScope(scope: Scope, associateId: string): void {
  if (!isInScope(scope, associateId)) throw new AccessError("forbidden");
}

/** Guard: throw `forbidden` unless the principal is an admin-area role. */
export function requireAdmin(p: Principal): void {
  if (!isAdminRole(p.role)) throw new AccessError("forbidden");
}

/** Guard: throw `forbidden` unless the principal holds `cap`. */
export function requireCapability(p: Principal, cap: Capability): void {
  if (!can(p.role, cap)) throw new AccessError("forbidden");
}
