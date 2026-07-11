import { describe, it, expect } from "vitest";
import {
  AccessError,
  isInScope,
  scopedAssociateWhere,
  assertInScope,
  requireAdmin,
  requireCapability,
  resolveScope,
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
