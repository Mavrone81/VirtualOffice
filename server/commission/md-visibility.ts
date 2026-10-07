import { LedgerLineType, type Prisma } from "@prisma/client";

/**
 * The managing-director cut is ADMIN-ONLY (owner, 2026-10-07: "this Managing
 * director cut will never be shown anywhere less on the product creation page
 * and admin product page and admin's payout page" / "No other users can see
 * this").
 *
 * Every commission-ledger read outside the admin area must carry this. It is a
 * named constant rather than an inline `lineType: { not: ... }` so that the
 * rule is greppable and so md-visibility.test.ts can prove each site has it —
 * 20-odd files read this ledger, and "I added the filter everywhere" is exactly
 * the kind of claim that is wrong in one place and silent about it.
 *
 * Note what the cut would otherwise leak into, which is NOT only the
 * recipient's own screen:
 *   - a manager's team totals and the downline lookup, both of which aggregate
 *     `associateId: { in: [...] }` over people who may include a managing
 *     director;
 *   - the rank bands, which group across EVERY associate — there the cut would
 *     not just expose a figure, it would move other people's percentiles.
 *
 * Deliberately excluded from the recipient's own portal views too. "No other
 * users" admits a reading where the holder sees their own line, but the owner
 * named three admin screens as the complete list, and the conservative reading
 * is the recoverable one: a figure wrongly hidden is a bug report, a
 * confidential figure wrongly shown cannot be taken back.
 */
export const EXCLUDE_MD_CUT = {
  lineType: { not: LedgerLineType.ManagingDirectorCut },
} satisfies Prisma.CommissionLedgerWhereInput;
