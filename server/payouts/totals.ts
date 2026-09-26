import { Prisma, LedgerLineType, PayoutStatus } from "@prisma/client";
import type { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

export type PayoutTotals = {
  personalCommission: Prisma.Decimal;
  overrideCommission: Prisma.Decimal;
  addonCommission: Prisma.Decimal;
  totalPayable: Prisma.Decimal;
};

/** Sum ledger lines into payout columns. A payout's totals are always derived from its own lines. */
export function payoutTotalsFromLines(lines: { lineType: LedgerLineType; amount: Prisma.Decimal | string | number }[]): PayoutTotals {
  let personal = new Prisma.Decimal(0), override = new Prisma.Decimal(0), addon = new Prisma.Decimal(0);
  for (const l of lines) {
    if (l.lineType === LedgerLineType.Personal) personal = personal.add(l.amount);
    else if (l.lineType === LedgerLineType.Override) override = override.add(l.amount);
    else if (l.lineType === LedgerLineType.AddOn) addon = addon.add(l.amount);
  }
  return {
    personalCommission: personal, overrideCommission: override, addonCommission: addon,
    totalPayable: personal.add(override).add(addon),
  };
}

/** Plain-number snapshot for audit before/after. */
export function totalsSnapshot(t: PayoutTotals): Record<string, string> {
  return {
    personal: t.personalCommission.toFixed(2), override: t.overrideCommission.toFixed(2),
    addon: t.addonCommission.toFixed(2), total: t.totalPayable.toFixed(2),
  };
}

/**
 * Re-derive a PENDING payout's totals from the lines attached to it. The write is a
 * compare-and-swap on payoutStatus = Pending, so an Approved/Paid payout is never
 * touched (M5). Returns the before/after snapshots, or null when nothing was written.
 */
export async function recomputePendingPayout(
  db: Db, payoutId: string,
): Promise<{ before: Record<string, string>; after: Record<string, string> } | null> {
  const cur = await db.monthlyPayout.findUnique({ where: { id: payoutId } });
  if (!cur || cur.payoutStatus !== PayoutStatus.Pending) return null;
  const lines = await db.commissionLedger.findMany({ where: { payoutId }, select: { lineType: true, amount: true } });
  const next = payoutTotalsFromLines(lines);
  const res = await db.monthlyPayout.updateMany({ where: { id: payoutId, payoutStatus: PayoutStatus.Pending }, data: next });
  if (res.count === 0) return null;
  return { before: totalsSnapshot(cur), after: totalsSnapshot(next) };
}
