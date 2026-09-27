import { PayoutStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

/** A ledger line of this transaction is settled in an Approved or Paid payout. */
export async function hasLinkedSettledLine(db: Db, transactionId: string): Promise<boolean> {
  const settled = await db.commissionLedger.findFirst({
    where: { transactionId, payout: { payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] } } },
    select: { id: true },
  });
  return !!settled;
}

/**
 * X1 (Architect money review): pre-M5 payouts predate payoutId linking, so a
 * commission that WAS paid can be invisible to hasLinkedSettledLine until the
 * backfill apply + reconciliation runs. For each (associate, payoutMonth)
 * this transaction's own lines belong to, treat it as unreconciled if that
 * associate has ANY Approved/Paid payout for that month with NO linked lines
 * at all — the same predicate as M5-CF's findBlockedAssociateIds, scoped to
 * just this transaction's lines rather than "every month <= M" (this isn't a
 * payout run).
 */
export async function hasUnreconciledLegacyPayout(db: Db, transactionId: string): Promise<boolean> {
  const lines = await db.commissionLedger.findMany({
    where: { transactionId, associateId: { not: null } },
    select: { associateId: true, payoutMonth: true },
    distinct: ["associateId", "payoutMonth"],
  });
  const checks = await Promise.all(
    lines.map((l) =>
      l.associateId
        ? db.monthlyPayout.findFirst({
            where: {
              associateId: l.associateId, payoutMonth: l.payoutMonth,
              payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] },
              ledgerLines: { none: {} },
            },
            select: { id: true },
          })
        : null,
    ),
  );
  return checks.some((c) => !!c);
}

/**
 * Whether this transaction's commission is already settled (in either
 * sense above) — the read-only predicate behind B-7's unmark refusal. Used
 * by the UI to decide whether to show "Mark Unpaid" as disabled, WITHOUT
 * duplicating the refusal rule (ADR-0001 §7 — one read rule per entity):
 * this is exactly what server/invoices/actions.ts's refuseIfSettled checks,
 * just without the specific error-key distinction the real guard needs.
 */
export async function isTransactionSettled(db: Db, transactionId: string): Promise<boolean> {
  if (await hasLinkedSettledLine(db, transactionId)) return true;
  return hasUnreconciledLegacyPayout(db, transactionId);
}

/**
 * Batched version for a page listing many transactions — a fixed THREE
 * queries regardless of list size (DevLead follow-up: the first cut fired
 * N x (1 + K) queries through the shared pool, which risks starving other
 * requests / P2024 under load). Read-only, outside any lock: a UI hint, not
 * the authoritative guard (markInvoiceUnpaid/markInstallmentUnpaid re-check
 * under the sale lock regardless of what this returns).
 */
export async function findSettledTransactionIds(transactionIds: string[]): Promise<Set<string>> {
  if (transactionIds.length === 0) return new Set();

  // (1) Linked: transactions with a line in an Approved/Paid payout.
  const linked = await prisma.commissionLedger.findMany({
    where: { transactionId: { in: transactionIds }, payout: { payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] } } },
    select: { transactionId: true },
    distinct: ["transactionId"],
  });
  const settled = new Set(linked.map((l) => l.transactionId));

  // (2) The distinct (transactionId, associateId, payoutMonth) triples this
  // list's own lines belong to — the X1 check's scope.
  const lines = await prisma.commissionLedger.findMany({
    where: { transactionId: { in: transactionIds }, associateId: { not: null } },
    select: { transactionId: true, associateId: true, payoutMonth: true },
    distinct: ["transactionId", "associateId", "payoutMonth"],
  });
  const pairKey = (associateId: string, payoutMonth: string) => `${associateId}\u0000${payoutMonth}`;
  const pairs = [...new Map(lines.map((l) => [pairKey(l.associateId!, l.payoutMonth), { associateId: l.associateId!, payoutMonth: l.payoutMonth }])).values()];

  // (3) Which of those (associate, month) pairs has an unreconciled legacy
  // (unlinked) Approved/Paid payout — one query, an OR over the pair list.
  if (pairs.length > 0) {
    const legacyPayouts = await prisma.monthlyPayout.findMany({
      where: {
        OR: pairs.map((p) => ({ associateId: p.associateId, payoutMonth: p.payoutMonth })),
        payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] },
        ledgerLines: { none: {} },
      },
      select: { associateId: true, payoutMonth: true },
    });
    const blockedPairs = new Set(legacyPayouts.map((p) => pairKey(p.associateId, p.payoutMonth)));
    for (const l of lines) {
      if (l.associateId && blockedPairs.has(pairKey(l.associateId, l.payoutMonth))) settled.add(l.transactionId);
    }
  }

  return settled;
}
