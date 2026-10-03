import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppRole } from "@prisma/client";

// The page is called as a function and its returned element tree is walked for
// RecruitmentView. An element that is never rendered never runs its queries, so
// "absent from the tree" is the guard-before-query proof for the downline table.
const h = vi.hoisted(() => ({
  role: "SalesManager" as string,
  fetchTeam: vi.fn(async () => ({ members: [], teams: [], submissions: [], ledger: [], overrides: { received: 0, overall: 0 }, commissionByTxnAssociate: new Map() })),
  RecruitmentView: vi.fn(() => null),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { role: h.role, associateId: "A1" } }) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect:" + u); } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/server/team/performance", () => ({ fetchTeamPerformance: h.fetchTeam }));
vi.mock("@/components/recruitment/recruitment-view", () => ({ RecruitmentView: h.RecruitmentView }));

import TeamPerformancePage from "@/app/portal/team/performance/page";

type El = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };
function findAll(node: unknown, type: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object") {
    const el = node as El;
    if (el.type === type) out.push(el);
    findAll(el.props?.children, type, out);
  }
  return out;
}
const render = async (role: AppRole) => {
  h.role = role;
  return findAll(await TeamPerformancePage({ searchParams: Promise.resolve({}) }), h.RecruitmentView);
};

beforeEach(() => h.fetchTeam.mockClear());

describe("Team Performance page — which branch renders which view", () => {
  for (const role of ["SalesManager", "SalesDirector"] as AppRole[]) {
    it(`${role} (canRecruit): team tables AND the embedded downline performance table`, async () => {
      const found = await render(role);
      expect(h.fetchTeam).toHaveBeenCalled();
      expect(found).toHaveLength(1);
      expect(found[0].props).toMatchObject({ mode: "performance", embedded: true });
    });
  }

  it("SalesAssistantManager (manager, NOT canRecruit): team tables, and the downline view is not rendered, so its query cannot run", async () => {
    const found = await render("SalesAssistantManager");
    expect(h.fetchTeam).toHaveBeenCalled();
    expect(found).toHaveLength(0);
  });

  for (const role of ["SalesAssociate", "Admin"] as AppRole[]) {
    it(`${role} (non-manager): downline branch only, team fetch never called`, async () => {
      const found = await render(role);
      expect(h.fetchTeam).not.toHaveBeenCalled();
      expect(found).toHaveLength(1);
      expect(found[0].props?.embedded).toBeUndefined();
    });
  }
});
