import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rbac", () => ({ downlineIds: vi.fn(async () => ["self", "recruit"]) }));
vi.mock("@/lib/team", () => ({ teamScopeIds: vi.fn(async () => ["self", "teammate"]) }));

import { dashboardScopeIds } from "./metrics";
import { downlineIds } from "@/lib/rbac";
import { teamScopeIds } from "@/lib/team";

describe("dashboardScopeIds — the My Dashboard visibility ladder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Admin / Accounts see all teams (null = no filter)", async () => {
    expect(await dashboardScopeIds("Admin", "self")).toBeNull();
    expect(await dashboardScopeIds("Accounts", "self")).toBeNull();
  });

  it("a Sales Director sees own team", async () => {
    expect(await dashboardScopeIds("SalesDirector", "self")).toEqual(["self", "teammate"]);
    expect(teamScopeIds).toHaveBeenCalledWith("self");
    expect(downlineIds).not.toHaveBeenCalled();
  });

  it.each(["SalesManager", "SalesAssistantManager"] as const)(
    "%s sees own downline + team (deduped union)",
    async (role) => {
      const ids = await dashboardScopeIds(role, "self");
      expect(new Set(ids)).toEqual(new Set(["self", "recruit", "teammate"]));
      expect(ids!.filter((x) => x === "self")).toHaveLength(1); // deduped
    },
  );

  it("an associate sees own data only", async () => {
    expect(await dashboardScopeIds("SalesAssociate", "self")).toEqual(["self"]);
    expect(downlineIds).not.toHaveBeenCalled();
    expect(teamScopeIds).not.toHaveBeenCalled();
  });

  it("a non-admin without a profile sees nothing", async () => {
    expect(await dashboardScopeIds("SalesAssociate", null)).toEqual([]);
  });
});
