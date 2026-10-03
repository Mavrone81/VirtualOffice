import { prisma } from "@/lib/db";

/**
 * A15 follow-up (Oct 2026): the Finance menu is gone (client's ask), which
 * left "My Payouts" — the per-month breakdown and the statement download —
 * reachable only by typing the old /portal/payouts URL. This surfaces the
 * same data from within My Transactions' "Received" tab instead, without a
 * new Finance-labelled menu entry.
 *
 * Scoped by construction: the caller passes exactly one associateId (always
 * the signed-in user's own, never a value from a URL/searchParam — there is
 * no "whose payouts" selector anywhere in this feature), and the query
 * filters on it alone. There is nothing here for another associate's id to
 * bypass; see my-payouts.integration.test.ts for the isolation proof.
 */
export async function myPayoutsForAssociate(associateId: string) {
  return prisma.monthlyPayout.findMany({
    where: { associateId },
    orderBy: [{ payoutMonth: "desc" }, { seq: "asc" }],
  });
}

export type MyPayoutRow = Awaited<ReturnType<typeof myPayoutsForAssociate>>[number];
