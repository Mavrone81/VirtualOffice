import { LedgerLineType, LedgerStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ZERO } from "@/lib/money";

/**
 * Team Sales "Commission" column (C-9, 02 Oct 2026): the CLOSING associate's
 * own commission on that sale -- never the sale amount (the figure the PDF
 * showed under that header, the bug this column exists to fix), never the
 * viewing upline's own override.
 *
 * 🔴 Personal lines are NOT 1:1 with the closing associate. A Flow-3 split
 * sale creates up to THREE Personal lines per line item -- one for the
 * closer, one each for Associate 2 / 3 when a split exists
 * (server/commission/engine.ts:102,104,107) -- and the closer's own line is
 * `netToCloser - split2 - split3` (engine.ts:97), so summing every Personal
 * line on a transaction returns the FULL Net-to-Closer, not any one
 * associate's share. The result map is therefore keyed by
 * `${transactionId}:${associateId}`, not transactionId alone, and the
 * caller must look up with the ROW'S OWN closing associate id.
 *
 * CompanyRetained and ExternalPayable both carry associateId: null
 * (engine.ts:76,115) and so cannot surface through the lineType filter
 * regardless of key shape -- see the integration test for the proof, kept
 * even though the Personal filter makes it automatic, since it now asserts
 * a property rather than patching a gap. Cancelled is excluded per the
 * standing convention at schema.prisma:178-188; this call site is on that
 * comment's list.
 */
export const TEAM_SALES_COMMISSION_WHERE = (transactionIds: string[]) =>
  ({
    transactionId: { in: transactionIds },
    lineType: LedgerLineType.Personal,
    status: { not: LedgerStatus.Cancelled },
  }) satisfies Prisma.CommissionLedgerWhereInput;

const key = (transactionId: string, associateId: string) => `${transactionId}:${associateId}`;

/** `${transactionId}:${closingAssociateId}` -> that associate's own
 *  commission on that transaction. A pair absent from the returned map has
 *  no Personal line for that associate on that transaction at all (distinct
 *  from a pair present with a zero amount) -- the caller renders that as
 *  "no commission yet", not "$0". Pass the transaction's closing associate,
 *  never any other associate who may also have a Personal line on the same
 *  transaction (a split partner) -- their lines are real but belong to a
 *  different row. */
export async function fetchTeamSalesCommissionByTransaction(transactionIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (!transactionIds.length) return new Map();
  const lines = await prisma.commissionLedger.findMany({
    where: TEAM_SALES_COMMISSION_WHERE(transactionIds),
    select: { transactionId: true, associateId: true, amount: true },
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const l of lines) {
    if (!l.associateId) continue; // defensive -- CompanyRetained/ExternalPayable can't be Personal, but never key on null
    const k = key(l.transactionId, l.associateId);
    out.set(k, (out.get(k) ?? ZERO).add(l.amount));
  }
  return out;
}

/** Look up a transaction's commission for a SPECIFIC associate (the row's
 *  own closing associate) -- the only safe way to read the map above. */
export function teamSalesCommissionFor(
  map: Map<string, Prisma.Decimal>,
  transactionId: string,
  closingAssociateId: string,
): Prisma.Decimal | undefined {
  return map.get(key(transactionId, closingAssociateId));
}
