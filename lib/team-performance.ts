import { LedgerStatus, type Prisma } from "@prisma/client";
import { sum } from "./money";

/**
 * The six figures on the combined Team Performance page (C11), as a pure
 * function of the ROWS the two tables render -- never of a separate query.
 * That is the whole point: the search filter narrows the rows once, and the
 * tiles and tables both read the narrowed rows, so a filter can't move one
 * and leave the other behind (the old two-page split computed each page's
 * tiles from its own table's rows for the same reason).
 *
 * "Verified" = QuotationApproved, as team/sales always counted it. "Pending"
 * = ledger status Eligible (ready for payout), the old "Team Pending
 * Commission" tile. My Overrides is NOT here: it is the viewer's own
 * override earnings for its own period, deliberately independent of the
 * team search (owner ruling, see the page).
 */
export function summarizeTeamPerformance(
  submissions: { status: string; saleAmount: Prisma.Decimal }[],
  ledger: { status: string; amount: Prisma.Decimal }[],
) {
  const verified = submissions.filter((s) => s.status === "QuotationApproved");
  return {
    submissionCount: submissions.length,
    totalSubmitted: sum(submissions.map((s) => s.saleAmount)),
    verifiedCount: verified.length,
    verifiedTotal: sum(verified.map((s) => s.saleAmount)),
    teamCommission: sum(ledger.map((l) => l.amount)),
    teamPending: sum(ledger.filter((l) => l.status === LedgerStatus.Eligible).map((l) => l.amount)),
  };
}
