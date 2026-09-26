import { Prisma } from "@prisma/client";

/** The fields that identify "the same commission" across recomputes of one transaction. */
type Keyed = {
  associateId: string | null;
  lineType: string;
  lineItemId: string | null;
  comCode: string | null;
  amount: Prisma.Decimal | string | number;
};

const keyOf = (l: Keyed) => `${l.associateId ?? ""}|${l.lineType}|${l.lineItemId ?? ""}|${l.comCode ?? ""}`;

/**
 * M5 (option a) — reconcile a transaction's freshly computed ledger rows against the
 * rows already settled in an Approved/Paid payout ("locked"). Locked rows are kept
 * as they are; the returned rows are what must be written in addition:
 *   - commission with nothing settled yet → written as computed;
 *   - commission already settled → only the difference (new − settled), if non-zero,
 *     flagged in `remarks`; a negative difference is a visible clawback line;
 *   - settled commission that no longer exists → a full negative reversal.
 * The result always satisfies: settled + returned = newly computed, per key.
 */
export function reconcileWithSettled<T extends Keyed & { remarks?: string | null }>(
  computed: T[],
  locked: (Keyed & { basisAmount?: Prisma.Decimal | string | number })[],
  template: (l: Keyed & { basisAmount?: Prisma.Decimal | string | number }) => T,
): T[] {
  const settled = new Map<string, Prisma.Decimal>();
  const lockedByKey = new Map<string, (typeof locked)[number]>();
  for (const l of locked) {
    const k = keyOf(l);
    settled.set(k, (settled.get(k) ?? new Prisma.Decimal(0)).add(l.amount));
    lockedByKey.set(k, l);
  }

  const out: T[] = [];
  const grouped = new Map<string, T[]>();
  for (const c of computed) {
    const k = keyOf(c);
    if (!settled.has(k)) out.push(c);
    else grouped.set(k, [...(grouped.get(k) ?? []), c]);
  }

  for (const [k, paid] of settled) {
    const now = (grouped.get(k) ?? []).reduce((s, c) => s.add(c.amount), new Prisma.Decimal(0));
    const delta = now.sub(paid);
    if (delta.isZero()) continue;
    const base = grouped.get(k)?.[0] ?? template(lockedByKey.get(k)!);
    out.push({ ...base, amount: delta, remarks: `Adjustment vs settled payout (settled ${paid.toFixed(2)}, now ${now.toFixed(2)})` });
  }
  return out;
}
