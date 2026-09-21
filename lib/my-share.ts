import { LedgerLineType, LedgerStatus } from "@prisma/client";
import { D, round2, ZERO } from "@/lib/money";
import type { Prisma } from "@prisma/client";

/**
 * "My Transactions" per-row figures (associate-portal changes, Sep 2026 — A5).
 * For one transaction, looks only at the signed-in associate's own ledger lines:
 *  - scheme:   how they earn on it (closer / split share / direct-upline override /
 *              2nd-upline override / add-on)
 *  - share:    my commission on it (every line except Cancelled)
 *  - received: the part already paid out (status Paid)
 *  - balance:  share − received
 */
export type MyScheme = "closer" | "split" | "directOverride" | "secondOverride" | "addOn";

type Line = { associateId: string | null; lineType: LedgerLineType; status: LedgerStatus; amount: Prisma.Decimal | number | string };

export function summariseMyShare(
  lines: Line[],
  me: string,
  txn: { closingAssociateId: string; directUplineId: string | null; secondUplineId: string | null },
): { schemes: MyScheme[]; share: Prisma.Decimal; received: Prisma.Decimal; balance: Prisma.Decimal } {
  const mine = lines.filter((l) => l.associateId === me && l.status !== LedgerStatus.Cancelled);
  const schemes = new Set<MyScheme>();
  for (const l of mine) {
    if (l.lineType === LedgerLineType.Personal) schemes.add(me === txn.closingAssociateId ? "closer" : "split");
    else if (l.lineType === LedgerLineType.Override) schemes.add(me === txn.secondUplineId ? "secondOverride" : "directOverride");
    else if (l.lineType === LedgerLineType.AddOn) schemes.add("addOn");
  }
  const share = round2(mine.reduce((s, l) => s.add(D(l.amount)), ZERO));
  const received = round2(mine.filter((l) => l.status === LedgerStatus.Paid).reduce((s, l) => s.add(D(l.amount)), ZERO));
  return { schemes: [...schemes], share, received, balance: round2(share.sub(received)) };
}
