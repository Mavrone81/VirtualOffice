import type { AppRole } from "@prisma/client";

// Prisma-free by design (type-only import) — lib/rbac.ts pulls in the Prisma
// client for DB helpers, so anything imported by the client bundle (e.g.
// lib/nav.ts) must come from here instead, or the two can silently drift
// apart (A9 review: nav.ts had its own stale copy of this list).

// Recruitment (invite candidate) is Manager and above (A9, owner ruling 2026-09-26 —
// the PDF wins over the earlier 1 Sep AM+ decision). Sales Assistant Manager
// can no longer invite; existing candidates a SAM invited earlier are
// untouched — this only gates NEW invites going forward.
export const RECRUITER_ROLES: AppRole[] = ["SalesManager", "SalesDirector", "Admin"];
export const canRecruit = (r: AppRole): boolean => RECRUITER_ROLES.includes(r);

// Roles with a downline they manage (team individual breakdown — RBAC matrix §D:
// SAM / SM / SD). Moved here from lib/rbac.ts (C-8, 2026-10-03) for the same
// reason RECRUITER_ROLES lives here: nav.ts needs it and cannot import rbac.ts
// without pulling Prisma into the client bundle.
export const MANAGER_ROLES: AppRole[] = ["SalesAssistantManager", "SalesManager", "SalesDirector"];
export const isManagerRole = (r: AppRole): boolean => MANAGER_ROLES.includes(r);
