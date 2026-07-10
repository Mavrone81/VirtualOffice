# VirtualOffice Phase 1a — Service-Layer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a single principal-scoped access layer so role checks and downline (IDOR) scoping live in one tested place, and migrate the first consumer onto it.

**Architecture:** A pure module `lib/access.ts` holds the `Principal`/`Scope` types plus sync, dependency-free scoping primitives and role guards (fully unit-testable — this is the load-bearing IDOR logic). An impure module `server/access.ts` resolves the current request's `Principal` from the Auth.js session + the existing `downlineIds()` CTE. Existing `{ ok, error }` server actions migrate off their duplicated inline `requireAdmin()` onto `getAdminPrincipal()`.

**Tech Stack:** Next.js 15.5 (App Router, server actions), Auth.js v5 (`auth()`), Prisma 6 + Postgres, TypeScript, Vitest, next-intl, pnpm 9 / Node 22.

## Global Constraints

- Package manager is **pnpm 9**; Node **22**. Run scripts with `pnpm exec …`.
- Path alias `@/*` → repo root (`./*`); import app modules as `@/lib/...`, `@/server/...`, `@/auth`.
- Tests are **Vitest**, `environment: "node"`, and MUST live under `lib/**/*.test.ts` or `server/**/*.test.ts` (the config `include` globs — a test elsewhere will not run). Run one file with `pnpm exec vitest run <path>`.
- Roles are the Prisma `AppRole` enum: `Admin`, `Accounts`, `SalesDirector`, `SalesManager`, `Consultant`. Admin-area roles = `Admin` + `Accounts` (`isAdminRole`). Manager roles (have a downline) = `SalesManager` + `SalesDirector` (`isManagerRole`). Reuse these from `@/lib/rbac`; do NOT redefine role sets.
- Server actions return `{ ok: boolean; error?: string; ... }` and localise error text via `getTranslations("errors")` (next-intl). Preserve this contract when migrating actions.
- The session shape (from `types/next-auth.d.ts`) exposes `session.user.id: string`, `session.user.role: AppRole`, `session.user.associateId: string | null`.
- Money is Prisma `Decimal`; never coerce to JS number. (Not touched in this plan, but keep it true.)
- Working style: commit directly to `main`. Do NOT push in this plan (Phase 1a is code but ships as one reviewed batch later); pushing triggers the GitHub Actions prod auto-deploy.
- DRY / YAGNI / TDD: write the failing test first, minimal code to pass, commit per task.

## File Structure

- **Create** `lib/access.ts` — pure: `Scope`, `Principal`, `AccessError`, `isInScope`, `scopedAssociateWhere`, `assertInScope`, `requireAdmin`, `requireCapability`, `resolveScope`. No imports of `@/auth` or `prisma`; may import pure helpers from `@/lib/rbac`.
- **Create** `lib/access.test.ts` — unit tests for every pure primitive (the IDOR scoping logic).
- **Create** `server/access.ts` — impure: `getPrincipal()`, `getAdminPrincipal()`. Imports `@/auth` and `@/lib/rbac`'s `downlineIds`.
- **Create** `server/access.test.ts` — tests `getPrincipal`/`getAdminPrincipal` with `@/auth` and `downlineIds` mocked.
- **Modify** `server/payouts/actions.ts` — remove the local `requireAdmin()`; call `getAdminPrincipal()` instead (worked-example migration).

Later Phase-1 plans (1b security, 1d money-safety, …) migrate the other action files onto this layer as they touch them; this plan does not migrate all consumers.

---

### Task 1: Pure access primitives

**Files:**
- Create: `lib/access.ts`
- Test: `lib/access.test.ts`

**Interfaces:**
- Consumes: from `@/lib/rbac` — `isAdminRole(r: AppRole): boolean`, `can(role: AppRole, cap: Capability): boolean`, and the `Capability` type. From `@prisma/client` — `AppRole`.
- Produces:
  - `type Scope = { kind: "all" } | { kind: "associates"; ids: string[] }`
  - `interface Principal { userId: string; role: AppRole; associateId: string | null; scope: Scope }`
  - `class AccessError extends Error { code: "unauthenticated" | "forbidden" }`
  - `isInScope(scope: Scope, associateId: string): boolean`
  - `scopedAssociateWhere(scope: Scope): { id?: { in: string[] } }`
  - `assertInScope(scope: Scope, associateId: string): void` (throws `AccessError("forbidden")`)
  - `requireAdmin(p: Principal): void` (throws `AccessError("forbidden")`)
  - `requireCapability(p: Principal, cap: Capability): void` (throws `AccessError("forbidden")`)

- [ ] **Step 1: Write the failing test**

Create `lib/access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AccessError,
  isInScope,
  scopedAssociateWhere,
  assertInScope,
  requireAdmin,
  requireCapability,
  type Principal,
  type Scope,
} from "@/lib/access";

const ALL: Scope = { kind: "all" };
const DL: Scope = { kind: "associates", ids: ["a1", "a2"] };

const principal = (role: Principal["role"], scope: Scope): Principal => ({
  userId: "u1",
  role,
  associateId: scope.kind === "associates" ? (scope.ids[0] ?? null) : null,
  scope,
});

describe("isInScope", () => {
  it("all scope contains any associate", () => {
    expect(isInScope(ALL, "anything")).toBe(true);
  });
  it("associates scope contains only listed ids", () => {
    expect(isInScope(DL, "a1")).toBe(true);
    expect(isInScope(DL, "a3")).toBe(false);
  });
});

describe("scopedAssociateWhere", () => {
  it("all scope yields an empty (unrestricted) where", () => {
    expect(scopedAssociateWhere(ALL)).toEqual({});
  });
  it("associates scope yields an id-in filter", () => {
    expect(scopedAssociateWhere(DL)).toEqual({ id: { in: ["a1", "a2"] } });
  });
});

describe("assertInScope", () => {
  it("passes for an in-scope associate", () => {
    expect(() => assertInScope(DL, "a2")).not.toThrow();
  });
  it("throws forbidden for an out-of-scope associate (IDOR guard)", () => {
    expect(() => assertInScope(DL, "a3")).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(() => assertInScope(DL, "a3")).toThrow(AccessError);
  });
});

describe("requireAdmin", () => {
  it("passes for Admin and Accounts", () => {
    expect(() => requireAdmin(principal("Admin", ALL))).not.toThrow();
    expect(() => requireAdmin(principal("Accounts", ALL))).not.toThrow();
  });
  it("throws forbidden for a portal role", () => {
    expect(() => requireAdmin(principal("Consultant", DL))).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("requireCapability", () => {
  it("Admin holds manage_products; Accounts does not", () => {
    expect(() => requireCapability(principal("Admin", ALL), "manage_products")).not.toThrow();
    expect(() => requireCapability(principal("Accounts", ALL), "manage_products")).toThrow(AccessError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/access.test.ts`
Expected: FAIL — cannot resolve module `@/lib/access` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/access.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/access.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/access.ts lib/access.test.ts
git commit -m "access: add pure principal scope primitives + guards"
```

---

### Task 2: `resolveScope` (pure, injected downline resolver)

**Files:**
- Modify: `lib/access.ts` (append `resolveScope`)
- Test: `lib/access.test.ts` (append cases)

**Interfaces:**
- Consumes: from `@/lib/rbac` — `isAdminRole`, `isManagerRole(r: AppRole): boolean`.
- Produces: `resolveScope(role: AppRole, associateId: string | null, getDownline: (associateId: string) => Promise<string[]>): Promise<Scope>`
  - Admin/Accounts → `{ kind: "all" }`
  - Manager role with an `associateId` → `{ kind: "associates", ids: await getDownline(associateId) }`
  - Any other portal role with an `associateId` (Consultant) → `{ kind: "associates", ids: [associateId] }` (self only)
  - No `associateId` and not admin → `{ kind: "associates", ids: [] }` (sees nothing)

- [ ] **Step 1: Write the failing test**

Append to `lib/access.test.ts`:

```ts
import { resolveScope } from "@/lib/access";

describe("resolveScope", () => {
  const downline = async (id: string) => [id, "child1", "child2"];

  it("admin roles get the unrestricted 'all' scope and never call downline", async () => {
    let called = false;
    const spy = async (id: string) => { called = true; return [id]; };
    expect(await resolveScope("Admin", "a1", spy)).toEqual({ kind: "all" });
    expect(await resolveScope("Accounts", null, spy)).toEqual({ kind: "all" });
    expect(called).toBe(false);
  });

  it("manager role gets its full downline closure", async () => {
    expect(await resolveScope("SalesManager", "a1", downline)).toEqual({
      kind: "associates",
      ids: ["a1", "child1", "child2"],
    });
  });

  it("consultant is scoped to self only (no downline call)", async () => {
    let called = false;
    const spy = async (id: string) => { called = true; return [id]; };
    expect(await resolveScope("Consultant", "a9", spy)).toEqual({
      kind: "associates",
      ids: ["a9"],
    });
    expect(called).toBe(false);
  });

  it("a non-admin with no associateId sees nothing", async () => {
    expect(await resolveScope("Consultant", null, downline)).toEqual({
      kind: "associates",
      ids: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/access.test.ts`
Expected: FAIL — `resolveScope` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/access.ts` (add `isManagerRole` to the existing rbac import line):

```ts
import { isManagerRole } from "@/lib/rbac";

/**
 * Resolve a role + associate into a Scope. `getDownline` is injected (the
 * recursive-CTE query lives in the impure layer) so this stays pure/testable.
 */
export async function resolveScope(
  role: AppRole,
  associateId: string | null,
  getDownline: (associateId: string) => Promise<string[]>,
): Promise<Scope> {
  if (isAdminRole(role)) return { kind: "all" };
  if (!associateId) return { kind: "associates", ids: [] };
  if (isManagerRole(role)) return { kind: "associates", ids: await getDownline(associateId) };
  return { kind: "associates", ids: [associateId] };
}
```

(Merge the `isManagerRole` import into the existing `import { isAdminRole, can, type Capability } from "@/lib/rbac";` line rather than adding a duplicate import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access.ts lib/access.test.ts
git commit -m "access: add resolveScope with injected downline resolver"
```

---

### Task 3: Impure request-principal resolvers

**Files:**
- Create: `server/access.ts`
- Test: `server/access.test.ts`

**Interfaces:**
- Consumes: `auth()` from `@/auth` (returns `Session | null`; `session.user` = `{ id, role, associateId }`); `downlineIds(associateId: string): Promise<string[]>` from `@/lib/rbac`; `resolveScope`, `Principal`, `isAdminRole` from `lib/access` / `lib/rbac`.
- Produces:
  - `getPrincipal(): Promise<Principal | null>` — null when unauthenticated.
  - `getAdminPrincipal(): Promise<Principal | null>` — the principal if it is an admin-area role, else null (return-style helper for existing `{ ok, error }` actions).

- [ ] **Step 1: Write the failing test**

Create `server/access.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const downlineMock = vi.fn();

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, downlineIds: downlineMock };
});

import { getPrincipal, getAdminPrincipal } from "@/server/access";

beforeEach(() => {
  authMock.mockReset();
  downlineMock.mockReset();
});

describe("getPrincipal", () => {
  it("returns null when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    expect(await getPrincipal()).toBeNull();
  });

  it("builds an admin principal with the 'all' scope", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "Admin", associateId: null } });
    const p = await getPrincipal();
    expect(p).toEqual({ userId: "u1", role: "Admin", associateId: null, scope: { kind: "all" } });
    expect(downlineMock).not.toHaveBeenCalled();
  });

  it("builds a manager principal scoped to its downline closure", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "SalesManager", associateId: "a1" } });
    downlineMock.mockResolvedValue(["a1", "a2"]);
    const p = await getPrincipal();
    expect(p?.scope).toEqual({ kind: "associates", ids: ["a1", "a2"] });
    expect(downlineMock).toHaveBeenCalledWith("a1");
  });
});

describe("getAdminPrincipal", () => {
  it("returns the principal for an admin role", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "Accounts", associateId: null } });
    const p = await getAdminPrincipal();
    expect(p?.role).toBe("Accounts");
  });

  it("returns null for a non-admin role", async () => {
    authMock.mockResolvedValue({ user: { id: "u3", role: "Consultant", associateId: "a9" } });
    expect(await getAdminPrincipal()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/access.test.ts`
Expected: FAIL — `@/server/access` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `server/access.ts`:

```ts
import "server-only";
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
```

Note: if `import "server-only"` breaks the Vitest import (it can, since Vitest is not the Next build), remove that first line — the module is still server-only by convention (it imports `@/auth`). Prefer keeping it; only drop it if the test errors specifically on `server-only`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Full test run + typecheck**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: all suites pass (existing engine + rbac tests still green); no type errors.

- [ ] **Step 6: Commit**

```bash
git add server/access.ts server/access.test.ts
git commit -m "access: add getPrincipal/getAdminPrincipal request resolvers"
```

---

### Task 4: Migrate `server/payouts/actions.ts` onto the access layer (worked example)

**Files:**
- Modify: `server/payouts/actions.ts` (remove local `requireAdmin`, lines ~11-15; update its three call sites and imports)

**Interfaces:**
- Consumes: `getAdminPrincipal()` from `@/server/access`.
- Produces: no new exports; the three actions (`runPayouts`, `setPayoutStatus`, `approveAllPayouts`) keep identical signatures and `{ ok, error }` behaviour.

- [ ] **Step 1: Replace the local guard with the shared one**

In `server/payouts/actions.ts`:

1. Delete the local helper (currently lines ~11-15):

```ts
async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}
```

2. Update the imports near the top: remove the now-unused `auth` and `isAdminRole` imports if nothing else in the file uses them (grep the file — the three actions only used them via `requireAdmin`), and add:

```ts
import { getAdminPrincipal } from "@/server/access";
```

3. In all three actions, replace `if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };` with:

```ts
if (!(await getAdminPrincipal())) return { ok: false, error: t("forbidden") };
```

- [ ] **Step 2: Typecheck to catch dangling imports**

Run: `pnpm exec tsc --noEmit`
Expected: no errors, no "declared but never read" for `auth` / `isAdminRole` (remove them if flagged).

- [ ] **Step 3: Run the full test suite**

Run: `pnpm exec vitest run`
Expected: PASS — no payouts-specific unit test exists yet, but nothing regresses.

- [ ] **Step 4: Lint**

Run: `pnpm exec eslint server/payouts/actions.ts server/access.ts lib/access.ts`
Expected: clean (fix any unused-import warnings).

- [ ] **Step 5: Commit**

```bash
git add server/payouts/actions.ts
git commit -m "payouts: use shared getAdminPrincipal (drop duplicated requireAdmin)"
```

---

## Self-Review

**Spec coverage (against §4.1 of the design spec):**
- "Principal resolved once per request" → Task 3 `getPrincipal`. ✅
- "scoped data-access module; scoping enforced in one place" → `lib/access.ts` primitives (`scopedAssociateWhere`, `assertInScope`) Tasks 1-2. ✅
- "requireAdmin/requireRole live in this layer" → `requireAdmin`, `requireCapability` (Task 1), `getAdminPrincipal` (Task 3). ✅
- "shaped for a future tenantId scope" → `Principal` is a single struct resolved in one place; Phase 2 adds `tenantId` to it + `resolveScope`. Noted, not built. ✅
- "IDOR scoping becomes independently testable" → the load-bearing scoping logic is pure and fully unit-tested in Tasks 1-2. ✅
- Consumer migration: this plan migrates the payouts actions as the worked example; remaining action files migrate in their own Phase-1 plans (stated in File Structure). ✅ (intentional scope boundary, not a gap)

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows real assertions; every run step shows the exact command + expected result. ✅

**Type consistency:** `Scope`, `Principal`, `AccessError`, `isInScope`, `scopedAssociateWhere`, `assertInScope`, `requireAdmin`, `requireCapability`, `resolveScope`, `getPrincipal`, `getAdminPrincipal` names are used identically across tasks and match the session shape (`user.id/role/associateId`) from `types/next-auth.d.ts` and the rbac helpers (`isAdminRole`, `isManagerRole`, `can`, `downlineIds`, `Capability`) verified in `lib/rbac.ts`. ✅

**Note for the executor:** the full downline-through-DB path and cross-action IDOR proof against a real Prisma test DB belong to the later **Phase-1 integration-test plan (1f)**; here the scoping *logic* is proven purely and the request resolver is proven with mocks.
