import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure role-dispatch test — the underlying id resolvers are exercised by
// their own tests (lib/team.test.ts, downlineIds integration paths).
vi.mock("./rbac", () => ({ downlineIds: vi.fn(async () => ["me", "child"]) }));
vi.mock("./team", () => ({ teamScopeIds: vi.fn(async () => ["me", "teammate", "director"]) }));

import { transactionScopeIds } from "./transaction-scope";
import { downlineIds } from "./rbac";
import { teamScopeIds } from "./team";

describe("transactionScopeIds — the Sep 2026 visibility ladder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin roles see everything (null = no filter)", async () => {
    expect(await transactionScopeIds("Admin", "me")).toBeNull();
    expect(await transactionScopeIds("Accounts", "me")).toBeNull();
    expect(downlineIds).not.toHaveBeenCalled();
    expect(teamScopeIds).not.toHaveBeenCalled();
  });

  it("a Sales Director sees their whole team", async () => {
    expect(await transactionScopeIds("SalesDirector", "me")).toEqual(["me", "teammate", "director"]);
    expect(teamScopeIds).toHaveBeenCalledWith("me");
    expect(downlineIds).not.toHaveBeenCalled();
  });

  it.each(["SalesManager", "SalesAssistantManager", "SalesAssociate"] as const)(
    "%s sees self + recruited downline only",
    async (role) => {
      expect(await transactionScopeIds(role, "me")).toEqual(["me", "child"]);
      expect(downlineIds).toHaveBeenCalledWith("me");
      expect(teamScopeIds).not.toHaveBeenCalled();
    },
  );

  it("a non-admin login without an associate profile sees nothing", async () => {
    expect(await transactionScopeIds("SalesAssociate", null)).toEqual([]);
  });
});
