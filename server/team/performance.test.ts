import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { Prisma, type AppRole } from "@prisma/client";

// Every prisma delegate the team-wide fetch could touch is a spy, so "never
// executes for a non-manager" is asserted as "no spy was called", not
// inferred from the return value.
const spies = vi.hoisted(() => ({
  associateFindMany: vi.fn(async () => [] as unknown[]),
  teamFindMany: vi.fn(async () => [] as unknown[]),
  teamFindFirst: vi.fn(async () => null as unknown),
  submissionFindMany: vi.fn(async () => [] as unknown[]),
  ledgerFindMany: vi.fn(async () => [] as unknown[]),
  // The real teamScopeIds runs (no explicit team -> downline fallback), fed by this.
  downlineRows: vi.fn(async () => [{ id: "SELF" }, { id: "M1" }, { id: "M2" }]),
  overrides: vi.fn(async () => ({ received: 0, overall: 0 })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    associate: { findMany: spies.associateFindMany },
    team: { findMany: spies.teamFindMany, findFirst: spies.teamFindFirst },
    salesSubmission: { findMany: spies.submissionFindMany },
    commissionLedger: { findMany: spies.ledgerFindMany },
    $queryRaw: spies.downlineRows,
  },
}));
vi.mock("@/server/dashboard/my-overrides", () => ({ myOverridesSummary: spies.overrides }));

import { fetchTeamPerformance } from "./performance";
import { summarizeTeamPerformance } from "@/lib/team-performance";

const ME = "SELF";
const run = (role: AppRole, teamSearch?: string) => fetchTeamPerformance({ associateId: ME, role, teamSearch, payoutMonth: "2099-01" });
const allSpies = () => Object.values(spies);

beforeEach(() => {
  for (const s of allSpies()) s.mockClear();
});

describe("fetchTeamPerformance — the guard sits before every query", () => {
  // Admin and Accounts are not manager roles either (MANAGER_ROLES has no Admin).
  for (const role of ["SalesAssociate", "Admin", "Accounts"] as AppRole[]) {
    it(`${role}: returns null and executes NO query at all`, async () => {
      expect(await run(role)).toBeNull();
      for (const s of allSpies()) expect(s).not.toHaveBeenCalled();
    });
  }

  it("SalesAssociate with a hand-edited teamSearch pointing at another team: still no query", async () => {
    expect(await run("SalesAssociate", "team:11111111-1111-4111-8111-111111111111")).toBeNull();
    for (const s of allSpies()) expect(s).not.toHaveBeenCalled();
  });

  // SalesAssistantManager is the one role where canRecruit=false,
  // isManagerRole=true and canSetQuota=true all disagree: asserting only
  // Director and Associate would pass even if SAM were bounced or widened.
  for (const role of ["SalesAssistantManager", "SalesManager", "SalesDirector"] as AppRole[]) {
    it(`${role}: runs the team-wide queries, scoped to the team minus self`, async () => {
      const data = await run(role);
      expect(data).not.toBeNull();
      expect(spies.downlineRows).toHaveBeenCalled();
      const where = (c: { mock: { calls: unknown[][] } }) => (c.mock.calls[0][0] as { where: unknown }).where;
      expect(where(spies.submissionFindMany)).toEqual({ closingAssociateId: { in: ["M1", "M2"] } });
      expect(where(spies.ledgerFindMany)).toEqual({ associateId: { in: ["M1", "M2"] } });
    });
  }

  it("an out-of-scope individual candidate falls back to the full team scope, never the candidate", async () => {
    await run("SalesManager", "ind:99999999-9999-4999-8999-999999999999");
    const where = (spies.submissionFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where;
    expect(where).toEqual({ closingAssociateId: { in: ["M1", "M2"] } });
  });

  it("an in-scope individual candidate narrows BOTH tables to that associate", async () => {
    spies.downlineRows.mockResolvedValue([{ id: ME }, { id: "22222222-2222-4222-8222-222222222222" }, { id: "M2" }]);
    await run("SalesAssistantManager", "ind:22222222-2222-4222-8222-222222222222");
    const sub = (spies.submissionFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where;
    const led = (spies.ledgerFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where;
    expect(sub).toEqual({ closingAssociateId: { in: ["22222222-2222-4222-8222-222222222222"] } });
    expect(led).toEqual({ associateId: { in: ["22222222-2222-4222-8222-222222222222"] } });
    spies.downlineRows.mockResolvedValue([{ id: ME }, { id: "M1" }, { id: "M2" }]);
  });
});

describe("summarizeTeamPerformance — tiles are a function of the rows the tables render", () => {
  const D = (n: number) => new Prisma.Decimal(n);
  const subs = [
    { status: "QuotationApproved", saleAmount: D(500) },
    { status: "Draft", saleAmount: D(300) },
    { status: "QuotationApproved", saleAmount: D(200) },
  ];
  const ledger = [
    { status: "Eligible", amount: D(40) },
    { status: "Paid", amount: D(25) },
    { status: "Eligible", amount: D(10) },
  ];

  it("computes all five team figures from the rows", () => {
    const s = summarizeTeamPerformance(subs, ledger);
    expect([s.submissionCount, s.verifiedCount]).toEqual([3, 2]);
    expect(s.totalSubmitted.toFixed(2)).toBe("1000.00");
    expect(s.verifiedTotal.toFixed(2)).toBe("700.00");
    expect(s.teamCommission.toFixed(2)).toBe("75.00");
    expect(s.teamPending.toFixed(2)).toBe("50.00");
  });

  it("narrowing the rows (what a search does) moves the tiles with them", () => {
    const s = summarizeTeamPerformance(subs.slice(0, 1), ledger.slice(1, 2));
    expect(s.submissionCount).toBe(1);
    expect(s.totalSubmitted.toFixed(2)).toBe("500.00");
    expect(s.verifiedTotal.toFixed(2)).toBe("500.00");
    expect(s.teamCommission.toFixed(2)).toBe("25.00");
    expect(s.teamPending.toFixed(2)).toBe("0.00");
  });

  it("an empty filtered set zeroes every tile (no stale unfiltered figure)", () => {
    const s = summarizeTeamPerformance([], []);
    expect(s.submissionCount + s.verifiedCount).toBe(0);
    for (const v of [s.totalSubmitted, s.verifiedTotal, s.teamCommission, s.teamPending]) expect(v.toFixed(2)).toBe("0.00");
  });
});

describe("Team Performance page wiring (structural)", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
  const page = read("app/portal/team/performance/page.tsx");

  it("reads the search param through TEAM_SEARCH_KEY from the plain module, not a literal", () => {
    expect(page).toMatch(/import \{ TEAM_SEARCH_KEY \} from "@\/lib\/team-search-params"/);
    expect(page).toMatch(/sp\[TEAM_SEARCH_KEY\]/);
  });

  it("the table head uses the shared dark centred header classes and the ledger column reads Commission", () => {
    expect(page).toContain("TABLE_HEAD_ROW_CLS");
    expect(page).toContain("TABLE_HEAD_CELL_CLS");
    expect(page).toContain('t("commissions.colCommission")');
    expect(page).not.toContain('t("commissions.colAmount")');
  });

  it("both retired routes redirect to the combined page, which is not itself a role bounce", () => {
    for (const p of ["app/portal/team/sales/page.tsx", "app/portal/team/commissions/page.tsx", "app/portal/recruitment/downline/page.tsx"]) {
      const src = read(p);
      expect(src).toContain("/portal/team/performance");
      expect(src).not.toMatch(/\/portal\/dashboard/);
    }
    // The manager and non-manager branches both RENDER (no redirect to a bounce).
    expect(page).not.toMatch(/redirect\("\/portal\//);
  });
});
