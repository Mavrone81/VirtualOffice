import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above const declarations, so the mocks it references
// must be created via vi.hoisted (which runs before the hoisted mock factories).
const { authMock, downlineMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  downlineMock: vi.fn(),
}));

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
