import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppRole } from "@prisma/client";

/**
 * The "not eligible for recruitment yet" card — the state a role that cannot
 * recruit sees in place of the downline table.
 *
 * Why this file exists: nothing anywhere asserted that card. The page-level
 * test (server/team/performance-page.test.ts) mocks RecruitmentView away
 * entirely, so it can only prove the component is MOUNTED — it cannot tell a
 * card from a table from an empty div. When the owner asked for the card to
 * appear for Sales Assistant Manager on Team Performance (7 Oct 2026), that
 * page test would have gone green on a component rendering nothing at all.
 *
 * So this renders the real component and reads what comes out. `downlineIds`
 * is the instrument for the second half of the claim: the ineligible branch
 * must not walk a downline, and a mock that records its calls proves that
 * directly rather than by inspecting markup.
 */
const h = vi.hoisted(() => ({
  role: "SalesManager" as string,
  downlineIds: vi.fn(async () => ["A1", "A2"]),
  fetchAssociates: vi.fn(async () => []),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { role: h.role, associateId: "A1" } }) }));
vi.mock("@/lib/db", () => ({ prisma: { salesTransaction: { findMany: async () => [] }, commissionLedger: { findMany: async () => [] } } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/server/recruitment/team-dashboard", () => ({ fetchTeamDashboardAssociates: h.fetchAssociates }));
vi.mock("@/lib/rbac", async (orig) => ({ ...(await orig<object>()), downlineIds: h.downlineIds }));

import { RecruitmentView } from "@/components/recruitment/recruitment-view";

// Collect every string in the returned element tree, so an assertion reads the
// rendered output rather than a prop we chose to look at.
function text(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => text(n, out));
  else if (node && typeof node === "object") text((node as { props?: { children?: unknown } }).props?.children, out);
  return out;
}

const render = async (role: AppRole) => {
  h.role = role;
  const tree = await RecruitmentView({ mode: "performance", basePath: "/portal/team/performance", tab: "all", mgr: null, embedded: true });
  return text(tree);
};

beforeEach(() => {
  h.downlineIds.mockClear();
  h.fetchAssociates.mockClear();
});

describe("RecruitmentView — the not-eligible card", () => {
  it("SalesAssistantManager cannot recruit, so it gets the card and no downline walk", async () => {
    const strings = await render("SalesAssistantManager");
    expect(strings).toContain("notEligible");
    expect(h.downlineIds).not.toHaveBeenCalled();
    expect(h.fetchAssociates).toHaveBeenCalledWith(["A1"]);
  });

  for (const role of ["SalesManager", "SalesDirector"] as AppRole[]) {
    it(`${role} can recruit, so it gets no card and the downline is walked`, async () => {
      const strings = await render(role);
      expect(strings).not.toContain("notEligible");
      expect(h.downlineIds).toHaveBeenCalledWith("A1");
    });
  }

  // The control. Without it, a component that silently returned null would
  // satisfy every `not.toContain` above and the suite would still be green.
  it("the harness can see the card at all (control)", async () => {
    const strings = await render("SalesAssistantManager");
    expect(strings.length).toBeGreaterThan(0);
    expect(strings).toContain("notEligible");
  });
});
