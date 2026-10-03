// Two independent mechanisms share one page (Team Commissions, Additional
// p10): the My Overrides card's own period filter (moView/moMonth/moYear),
// and "search by individual/team" (teamSearch), which drives the
// teamTotal/eligible summary figures and the ledger table. Owner ruling:
// neither reads the other's params. This test drives BOTH at once, on the
// same combined query-param object the page itself would receive, to prove
// one doesn't disturb the other — not two separate tests that could each
// pass while the composition is actually broken. Real throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resolveMyOverridesPeriod } from "./my-overrides-period";
import { parseTeamSearchParam, resolveTeamSearchScope, teamScopeIds } from "./team";
import { myOverridesSummary } from "@/server/dashboard/my-overrides";

const TAG = "MOSRCH-";
const MONTH = "2099-09";
let directorId = "", memberAId = "", memberBId = "", txId = "";

beforeAll(async () => {
  directorId = (await prisma.associate.create({
    data: { associateCode: TAG + "DIR", fullName: "Director Test", designation: "SalesDirector" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  memberAId = (await prisma.associate.create({
    data: { associateCode: TAG + "MA", fullName: "Member A", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  memberBId = (await prisma.associate.create({
    data: { associateCode: TAG + "MB", fullName: "Member B", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  await prisma.team.create({ data: { name: TAG + "Team", directorId, active: true, members: { create: [{ associateId: memberAId }, { associateId: memberBId }] } } });

  const submissionId = (await prisma.salesSubmission.create({
    data: { salesDate: new Date(MONTH + "-05"), clientName: TAG + "Client", saleAmount: "500", closingAssociateId: memberAId, paymentPlan: "FullPayment" as never },
    select: { id: true },
  })).id;
  txId = (await prisma.salesTransaction.create({
    data: { transactionCode: TAG + "TX1", submissionId, salesDate: new Date(MONTH + "-05"), clientName: TAG + "Client", saleAmount: "500", closingAssociateId: memberAId, paymentPlan: "FullPayment" as never },
    select: { id: true },
  })).id;
  // Member A's personal commission (what "search by Member A" should surface).
  await prisma.commissionLedger.create({
    data: { transactionId: txId, payoutMonth: MONTH, associateId: memberAId, lineType: "Personal" as never, basisAmount: "500", amount: "40", status: "Eligible" as never },
  });
  // Member B's personal commission (what "search by Member A" should NOT surface).
  await prisma.commissionLedger.create({
    data: { transactionId: txId, payoutMonth: MONTH, associateId: memberBId, lineType: "Personal" as never, basisAmount: "500", amount: "25", status: "Eligible" as never },
  });
  // The DIRECTOR's own override earning for the same month — belongs to the
  // My Overrides card, must be entirely unaffected by the team search below.
  await prisma.commissionLedger.create({
    data: { transactionId: txId, payoutMonth: MONTH, associateId: directorId, lineType: "Override" as never, basisAmount: "500", amount: "15", status: "Eligible" as never },
  });
});

afterAll(async () => {
  await prisma.commissionLedger.deleteMany({ where: { transactionId: txId } });
  await prisma.salesTransaction.deleteMany({ where: { id: txId } });
  await prisma.salesSubmission.deleteMany({ where: { clientName: TAG + "Client" } });
  await prisma.team.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("My Overrides period filter and team search coexist on one page load", () => {
  it("a combined query-param object resolves BOTH mechanisms correctly, each from only its own keys", async () => {
    // One sp object, as the page itself would receive it: a non-default
    // period AND a search filter set at the same time.
    const sp = { moView: "overall", moMonth: "9", moYear: "2099", teamSearch: `ind:${memberAId}` };

    const period = resolveMyOverridesPeriod(sp, new Date("2026-01-01T00:00:00Z"));
    expect(period.payoutMonth).toBe(MONTH);
    expect(period.view).toBe("overall");

    const searchInput = parseTeamSearchParam(sp.teamSearch);
    const searchScope = await resolveTeamSearchScope(directorId, searchInput);
    expect(searchScope).toEqual([memberAId]);

    // The two mechanisms' own queries, run exactly as the page composes them.
    const [overrides, ledger] = await Promise.all([
      myOverridesSummary(directorId, period.payoutMonth),
      prisma.commissionLedger.findMany({ where: { associateId: { in: searchScope! } }, select: { amount: true } }),
    ]);

    // My Overrides: the director's own Override line, unaffected by the
    // search filter being set to Member A at all.
    expect(overrides.overall.toString()).toBe("15");
    // Search: only Member A's line (40), never Member B's (25) or the
    // director's own Override line (15) — proves the filter actually
    // narrowed the ledger query, not just that the period query ran.
    expect(ledger.map((l) => l.amount.toString())).toEqual(["40"]);
  });

  it("clearing the search (teamSearch absent) while a period IS set still returns the full team scope for the ledger, and the period figure is untouched", async () => {
    const sp = { moView: "overall", moMonth: "9", moYear: "2099" };
    const period = resolveMyOverridesPeriod(sp, new Date());
    const searchScope = await resolveTeamSearchScope(directorId, parseTeamSearchParam(undefined));
    expect(searchScope).toBeNull(); // page falls back to the full team scope

    const fullScope = (await teamScopeIds(directorId)).filter((id) => id !== directorId);
    const ledger = await prisma.commissionLedger.findMany({ where: { associateId: { in: fullScope } }, select: { amount: true } });
    expect(ledger.map((l) => l.amount.toString()).sort()).toEqual(["25", "40"]); // both members, search off

    const overrides = await myOverridesSummary(directorId, period.payoutMonth);
    expect(overrides.overall.toString()).toBe("15"); // period figure identical to the previous test
  });
});
