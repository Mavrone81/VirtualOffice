// A15 follow-up: My Payouts moved from the retired /portal/payouts page into
// My Transactions (Received tab) now that the Finance menu is gone. The only
// authorization property this feature has is "an associate sees their OWN
// payouts, never anyone else's" — there is no URL/searchParam that selects
// WHICH associate's payouts to show (unlike the team-search feature), so the
// thing to prove is that the query itself never crosses associates, by test,
// not by reading the `where: { associateId }` clause. Real throwaway
// Postgres (needs DATABASE_URL); fake data only, all rows tagged and cleaned
// up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { myPayoutsForAssociate } from "./my-payouts";

const TAG = "MYPAY-";
let meId = "", strangerId = "", mePayoutId = "", strangerPayoutId = "";

beforeAll(async () => {
  meId = (await prisma.associate.create({
    data: { associateCode: TAG + "ME", fullName: "Me Test", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  strangerId = (await prisma.associate.create({
    data: { associateCode: TAG + "STR", fullName: "Stranger Test", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;

  mePayoutId = (await prisma.monthlyPayout.create({
    data: { associateId: meId, associateName: "Me Test", designation: "SalesAssociate" as never, payoutMonth: "2099-08", totalPayable: "100", payoutStatus: "Paid" as never },
    select: { id: true },
  })).id;
  // The required isolation boundary: another associate's payout, same month
  // even, so a month-keyed mistake couldn't silently pass either.
  strangerPayoutId = (await prisma.monthlyPayout.create({
    data: { associateId: strangerId, associateName: "Stranger Test", designation: "SalesAssociate" as never, payoutMonth: "2099-08", totalPayable: "999", payoutStatus: "Paid" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.monthlyPayout.deleteMany({ where: { associateId: { in: [meId, strangerId] } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("myPayoutsForAssociate — an associate sees only their own payouts", () => {
  it("returns the caller's own payout", async () => {
    const rows = await myPayoutsForAssociate(meId);
    expect(rows.map((r) => r.id)).toContain(mePayoutId);
  });

  // The actual required proof: a DIFFERENT associate's id is never in the
  // result, even though a row for that exact month exists for them.
  it("another associate's payout is refused — never appears for a different associateId", async () => {
    const rows = await myPayoutsForAssociate(meId);
    expect(rows.map((r) => r.id)).not.toContain(strangerPayoutId);
    expect(rows.every((r) => r.associateId === meId)).toBe(true);
  });

  it("is symmetric: calling it for the stranger returns only the stranger's row", async () => {
    const rows = await myPayoutsForAssociate(strangerId);
    expect(rows.map((r) => r.id)).toEqual([strangerPayoutId]);
  });

  it("no profile → no rows (a caller with no associateId can never reach this with someone else's id either)", async () => {
    const rows = await myPayoutsForAssociate("00000000-0000-0000-0000-000000000000");
    expect(rows).toEqual([]);
  });
});
