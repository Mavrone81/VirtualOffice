// Downline search on the My Transactions tabs. The fake DB below genuinely
// evaluates the queries the code issues (recursive downline walk, direct
// recruits, `closingAssociateId IN (...)`), so a broken filter or a broken
// scope makes these assertions fail. Every assertion states the size of the
// fixture it examined: an empty fixture would pass anything.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const ME = "00000000-0000-4000-8000-00000000000a";
const DIRECT = "00000000-0000-4000-8000-00000000000b";
const INDIRECT = "00000000-0000-4000-8000-00000000000c";
const UNRELATED = "00000000-0000-4000-8000-00000000000d";
const ARCHIVED_DIRECT = "00000000-0000-4000-8000-00000000000e";

const associates = [
  { id: ME, directUplineId: null, archivedAt: null, fullName: "Viewer", associateCode: "V" },
  { id: DIRECT, directUplineId: ME, archivedAt: null, fullName: "Direct", associateCode: "D" },
  { id: INDIRECT, directUplineId: DIRECT, archivedAt: null, fullName: "Indirect", associateCode: "I" },
  { id: UNRELATED, directUplineId: null, archivedAt: null, fullName: "Unrelated", associateCode: "U" },
  { id: ARCHIVED_DIRECT, directUplineId: ME, archivedAt: new Date(), fullName: "Gone", associateCode: "G" },
];
// Distinct sale amounts (100/200/400/800/1600) and ledger amounts (10/20/40/80/160)
// so any wrong id set changes the tile totals.
const sales = [ME, DIRECT, INDIRECT, UNRELATED, ARCHIVED_DIRECT].map((closingAssociateId, i) => ({
  id: `txn-${i}`, closingAssociateId,
  amountCollected: { gt: () => true }, saleAmount: Object.assign(new Prisma.Decimal(100 * 2 ** i), { gt: () => true }),
}));
const ledger = [ME, DIRECT, INDIRECT, UNRELATED, ARCHIVED_DIRECT].map((associateId, i) => ({
  associateId, amount: new Prisma.Decimal(10 * 2 ** i), status: "Approved", payout: null,
}));

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("@/lib/db", () => ({
  prisma: {
    // downlineIds(): recursive closure over direct_upline_id, self included.
    $queryRaw: async (_s: TemplateStringsArray, root: string) => {
      const out = new Set<string>();
      const walk = (id: string) => {
        const a = associates.find((x) => x.id === id);
        if (!a || a.archivedAt || out.has(id)) return;
        out.add(id);
        associates.filter((x) => x.directUplineId === id).forEach((c) => walk(c.id));
      };
      walk(root);
      return [...out].map((id) => ({ id }));
    },
    associate: {
      findMany: async ({ where }: { where: { directUplineId: string; archivedAt: null } }) =>
        associates.filter((a) => a.directUplineId === where.directUplineId && a.archivedAt === null),
    },
    team: { findMany: async () => [] },
    commissionLedger: {
      findMany: async ({ where }: { where: { associateId?: { in: string[] } } }) =>
        ledger.filter((l) => !where.associateId || where.associateId.in.includes(l.associateId)),
    },
    salesTransaction: {
      findMany: async ({ where }: { where: { closingAssociateId?: { in: string[] } } }) =>
        sales.filter((s) => !where.closingAssociateId || where.closingAssociateId.in.includes(s.closingAssociateId)),
    },
  },
}));

import { myTransactionRows, tileScopeIds } from "./queries";
import { dashboardMetrics } from "@/server/dashboard/metrics";

const closers = async (param?: string) => {
  const rows = await myTransactionRows("list", param);
  return (rows ?? []).map((r) => r.closingAssociateId).sort();
};

beforeEach(() => {
  who.session = { user: { role: "SalesManager", associateId: ME } };
});

describe("downline filter on myTransactionRows (fixture: 5 sales across 5 associates)", () => {
  it("fixture is non-trivial", () => {
    expect(sales).toHaveLength(5);
    expect(associates.filter((a) => a.directUplineId === ME)).toHaveLength(2); // one live, one archived
  });

  it("baseline, no param: whole existing scope = self + direct + indirect (3 of 5 rows), unrelated and archived excluded", async () => {
    const got = await closers();
    expect(got).toHaveLength(3);
    expect(got).toEqual([ME, DIRECT, INDIRECT].sort());
  });

  it("direct: own sale + direct recruit's sale (2 of 5 rows); indirect and unrelated EXCLUDED", async () => {
    const got = await closers("direct");
    expect(got).toHaveLength(2);
    expect(got).toEqual([ME, DIRECT].sort());
    expect(got).not.toContain(INDIRECT);
    expect(got).not.toContain(UNRELATED);
  });

  it("a single direct recruit id: exactly that recruit's row (1 of 5)", async () => {
    expect(await closers(DIRECT)).toEqual([DIRECT]);
  });

  it("own id: only own row (1 of 5)", async () => {
    expect(await closers(ME)).toEqual([ME]);
  });

  it("someone else's associate id (unrelated) in the param: zero unrelated rows, zero rows outside the viewer's scope", async () => {
    const got = await closers(UNRELATED);
    expect(got).not.toContain(UNRELATED);
    expect(got).toHaveLength(3); // falls back to the existing scope, nothing foreign added
    expect(got.every((id) => [ME, DIRECT, INDIRECT].includes(id))).toBe(true);
  });

  it("an INDIRECT recruit's id is not a valid single-person filter (not a direct recruit): falls back to scope, no probing", async () => {
    expect(await closers(INDIRECT)).toHaveLength(3);
  });

  it("an archived direct recruit's id is refused: archived row never returned (3 rows, no archived)", async () => {
    const got = await closers(ARCHIVED_DIRECT);
    expect(got).toHaveLength(3);
    expect(got).not.toContain(ARCHIVED_DIRECT);
  });

  it("garbage / array / sql-ish param values behave as no filter (3 rows), never throw", async () => {
    for (const p of ["", "direct ", "'; drop table--", "ind:" + UNRELATED]) {
      expect(await closers(p)).toHaveLength(3);
    }
    expect(await closers(undefined)).toHaveLength(3);
  });

  it("an associate with no recruits and a foreign id: sees only own row (1 of 5), foreign row excluded", async () => {
    who.session = { user: { role: "SalesAssociate", associateId: UNRELATED } };
    const got = await closers(DIRECT);
    expect(got).toEqual([UNRELATED]);
  });

  it("the filter never widens: a viewer whose scope is narrower than direct recruits does not gain rows", async () => {
    // Admin-less associate whose scope is themself only, asking for 'direct'
    // of someone else's tree: unrelated viewer, 'direct' = self + (no recruits).
    who.session = { user: { role: "SalesAssociate", associateId: UNRELATED } };
    expect(await closers("direct")).toEqual([UNRELATED]);
  });
});

// Headline tiles. fixture: 5 sales (100/200/400/800/1600) + 5 ledger lines (10/20/40/80/160).
describe("headline tiles follow the downline filter", () => {
  const tiles = async (role: string, me: string, param?: string) => {
    const m = await dashboardMetrics(await tileScopeIds(role as never, me, param));
    return { value: m.totalTransactionValue.toNumber(), gross: m.grossTransacted.toNumber() };
  };
  const tableValue = async (param?: string) => {
    const rows = (await myTransactionRows("list", param)) ?? [];
    return { n: rows.length, value: rows.reduce((a, r) => a + (r.saleAmount as Prisma.Decimal).toNumber(), 0) };
  };

  it("NO param: tiles are the pre-existing scope. Manager = self+downline (3 of 5 sales, 700 / 70)", async () => {
    expect(await tiles("SalesManager", ME)).toEqual({ value: 700, gross: 70 });
  });

  it("NO param: associate tiles stay own-only (1 of 5 sales, 100 / 10) even though the table shows 3 rows (pre-existing disagreement, unchanged)", async () => {
    who.session = { user: { role: "SalesAssociate", associateId: ME } };
    expect(await tiles("SalesAssociate", ME)).toEqual({ value: 100, gross: 10 });
    expect((await tableValue()).n).toBe(3);
  });

  it("invalid/foreign param: tiles identical to no-param (manager 700/70, associate 100/10)", async () => {
    for (const p of [UNRELATED, INDIRECT, "junk"]) {
      expect(await tiles("SalesManager", ME, p)).toEqual({ value: 700, gross: 70 });
    }
    expect(await tiles("SalesAssociate", ME, UNRELATED)).toEqual({ value: 100, gross: 10 });
  });

  it("direct: tiles = table row set (2 of 5 sales: 100+200 = 300, ledger 30); indirect 400 and unrelated 800 not counted", async () => {
    const table = await tableValue("direct");
    expect(table).toEqual({ n: 2, value: 300 });
    expect(await tiles("SalesManager", ME, "direct")).toEqual({ value: table.value, gross: 30 });
    // an associate-role viewer also gets the narrowed set (not their own-only default)
    expect(await tiles("SalesAssociate", ME, "direct")).toEqual({ value: 300, gross: 30 });
  });

  it("single direct recruit: tiles = table (1 of 5 sales: 200, ledger 20)", async () => {
    const table = await tableValue(DIRECT);
    expect(table).toEqual({ n: 1, value: 200 });
    expect(await tiles("SalesManager", ME, DIRECT)).toEqual({ value: 200, gross: 20 });
  });

  it("own id only: tiles = table (1 of 5 sales: 100, ledger 10)", async () => {
    expect(await tableValue(ME)).toEqual({ n: 1, value: 100 });
    expect(await tiles("SalesManager", ME, ME)).toEqual({ value: 100, gross: 10 });
  });
});
