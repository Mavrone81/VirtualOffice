import { Prisma, LedgerStatus, PayoutStatus } from "@prisma/client";
import type { prisma } from "@/lib/db";
import { currentNetNegativePolicy } from "./policy";

type Db = Prisma.TransactionClient | typeof prisma;

export type CandidateLine = { id: string; amount: Prisma.Decimal; payoutMonth: string; transactionId: string };
export type StuckPayout = { id: string; payoutMonth: string; totalPayable: Prisma.Decimal };

export type AssociatePlan = {
  associateId: string;
  /** Currently-unattached Eligible lines with earning month <= M. */
  newLines: CandidateLine[];
  /** Lines that would be detached from a released stuck payout. */
  releasedLines: CandidateLine[];
  /** The associate's Pending payouts with month < M and total <= 0 (to release). */
  stuckPayouts: StuckPayout[];
  /** The associate's own Pending payout for month M, if any. */
  existingPendingTotal: Prisma.Decimal;
  existingPendingPayoutId: string | null;
  /** newLines + releasedLines + existingPendingTotal — what §3's policy decides on. */
  net: Prisma.Decimal;
  policyName: string;
  attach: boolean;
  note?: string;
  /**
   * Rev 5 (E1, per associate): this associate has an Approved/Paid payout at month
   * <= M with no linked lines (a legacy payout the M5 backfill/§2a reconciliation
   * hasn't caught up with yet). They get nothing this run — no catch-up, release or
   * carry — until reconcileLegacyPayout links it. Everyone else still runs.
   */
  blocked: boolean;
};

/** Rev 5: associates with an unreconciled legacy payout at month <= M — never processed until reconciled. */
export async function findBlockedAssociateIds(db: Db, month: string): Promise<Set<string>> {
  const rows = await db.monthlyPayout.findMany({
    where: {
      payoutMonth: { lte: month },
      payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] },
      ledgerLines: { none: {} },
    },
    select: { associateId: true },
    distinct: ["associateId"],
  });
  return new Set(rows.map((r) => r.associateId));
}

/**
 * Read-only: the candidate set and the net-negative decision for every associate with
 * something to do in month M. Shared by `runPayouts` (which then writes what this says)
 * and `previewPayoutRun` (which only ever calls this). Mirrors the existing pattern in
 * this codebase (`runPayouts` already reads its candidate lines once, outside any lock,
 * and only re-verifies via compare-and-swap when it attaches them) — this function is
 * that same "outside the lock" read, just widened to every month <= M (M5-CF §2).
 */
export async function buildCatchupPlan(db: Db, month: string): Promise<AssociatePlan[]> {
  const policy = currentNetNegativePolicy();
  const blocked = await findBlockedAssociateIds(db, month);

  const selected = await db.commissionLedger.findMany({
    where: { payoutMonth: { lte: month }, status: LedgerStatus.Eligible, associateId: { not: null }, payoutId: null },
    select: { id: true, amount: true, payoutMonth: true, transactionId: true, associateId: true },
  });
  const stuck = await db.monthlyPayout.findMany({
    where: { payoutMonth: { lt: month }, payoutStatus: PayoutStatus.Pending, totalPayable: { lte: 0 } },
    select: { id: true, associateId: true, payoutMonth: true, totalPayable: true },
  });

  const byAssoc = new Map<string, { lines: CandidateLine[]; stuck: StuckPayout[] }>();
  const group = (id: string) => {
    if (!byAssoc.has(id)) byAssoc.set(id, { lines: [], stuck: [] });
    return byAssoc.get(id)!;
  };
  for (const l of selected) {
    if (!l.associateId) continue;
    group(l.associateId).lines.push({ id: l.id, amount: l.amount, payoutMonth: l.payoutMonth, transactionId: l.transactionId });
  }
  for (const p of stuck) group(p.associateId).stuck.push({ id: p.id, payoutMonth: p.payoutMonth, totalPayable: p.totalPayable });

  const plans: AssociatePlan[] = [];
  for (const [associateId, g] of byAssoc) {
    if (blocked.has(associateId)) {
      plans.push({
        associateId, newLines: g.lines, releasedLines: [], stuckPayouts: g.stuck,
        existingPendingTotal: new Prisma.Decimal(0), existingPendingPayoutId: null, net: new Prisma.Decimal(0),
        policyName: policy.name, attach: false, blocked: true,
      });
      continue;
    }
    let releasedLines: CandidateLine[] = [];
    if (g.stuck.length) {
      releasedLines = await db.commissionLedger.findMany({
        where: { payoutId: { in: g.stuck.map((p) => p.id) } },
        select: { id: true, amount: true, payoutMonth: true, transactionId: true },
      });
    }
    const existing = await db.monthlyPayout.findFirst({
      where: { associateId, payoutMonth: month, payoutStatus: PayoutStatus.Pending },
      select: { id: true, totalPayable: true },
    });
    const existingPendingTotal = existing?.totalPayable ?? new Prisma.Decimal(0);
    const candidate = [...g.lines, ...releasedLines];
    const net = candidate.reduce((s, l) => s.add(l.amount), existingPendingTotal);

    // The policy only governs a non-positive net (§3) — a positive net is always
    // attached normally, with no special remark, regardless of which policy is set.
    let attach = true;
    let note: string | undefined;
    if (candidate.length > 0 && net.lte(0)) {
      const decision = policy.decide({ associateId, month, net, lines: candidate });
      attach = decision.attach;
      note = decision.note;
    }
    plans.push({
      associateId, newLines: g.lines, releasedLines, stuckPayouts: g.stuck,
      existingPendingTotal, existingPendingPayoutId: existing?.id ?? null,
      net, policyName: policy.name, attach, note, blocked: false,
    });
  }
  return plans;
}
