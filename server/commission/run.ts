import { format } from "date-fns";
import { Designation, ComValueType, LedgerLineType, LedgerStatus, PayoutStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeTransactionCommission, type LineInput, type UplineInput, type SplitInput } from "./engine";
import { toLineInput, toSplit, toUpline } from "./inputs";
import { reconcileWithSettled } from "./settle";
import { recomputePendingPayout } from "@/server/payouts/totals";
import { auditTx } from "@/lib/audit";

type Db = Prisma.TransactionClient | typeof prisma;

type RunResult = {
  lineCount: number;
  recomputed: { payoutId: string; before: Record<string, string>; after: Record<string, string> }[];
  adjustments: { associateId: string | null; lineType: LedgerLineType; amount: string; remarks: string | null }[];
  settledLineIds: string[];
};

type TxForParties = Prisma.SalesTransactionGetPayload<{ include: { closingAssociate: true; submission: true } }>;

export type CommissionParties = {
  directUpline: UplineInput;
  secondUpline: UplineInput;
  associate2: SplitInput | null;
  associate3: SplitInput | null;
  eligible: boolean;
  nameOf: (id: string | null) => { name: string | null; designation: Designation | null };
};

/**
 * A-17 §2 (Q33c): the JSON-serializable shape stored on
 * `SalesTransaction.commissionParties`, written once at verifySale, never
 * updated (except DevSecOps' C3 admin-only correction path). Freezes WHO
 * earns and each upline's own Approved&&Active flag exactly as verifySale
 * saw them — a later designation/upline/approval change can't retroactively
 * change a booked deal's payees (the R-2 bug this removes). Deliberately
 * does NOT freeze payment eligibility (`SalesTransaction.commissionEligibility`)
 * — that's driven by amountCollected/A-0 and must stay live every recompute.
 */
export type CommissionPartiesSnapshot = {
  v: 1;
  frozenAt: string;
  closer: { id: string; designation: Designation };
  directUpline: { id: string; designation: Designation; eligible: boolean } | null;
  secondUpline: { id: string; designation: Designation; eligible: boolean } | null;
  associate2: { associateId: string; valueType: ComValueType; value: string } | null;
  associate3: { associateId: string; valueType: ComValueType; value: string } | null;
  names: Record<string, { name: string | null; designation: Designation | null }>;
};

/** Live resolution from associate/submission data (Legacy, and the source verifySale snapshots from). */
async function loadLiveCommissionParties(db: Db, tx: TxForParties): Promise<CommissionParties> {
  const associate2 = toSplit(tx.submission.associate2Id, tx.submission.associate2ValueType, tx.submission.associate2Value);
  const associate3 = toSplit(tx.submission.associate3Id, tx.submission.associate3ValueType, tx.submission.associate3Value);

  // Fetch uplines + split partners so both override and split ledger rows get names.
  const relatedIds = [tx.directUplineId, tx.secondUplineId, tx.submission.associate2Id, tx.submission.associate3Id]
    .filter((x): x is string => Boolean(x));
  const uplines = await db.associate.findMany({ where: { id: { in: relatedIds } } });
  const upById = new Map(uplines.map((u) => [u.id, u]));

  const nameOf = (id: string | null): { name: string | null; designation: Designation | null } => {
    if (!id) return { name: null, designation: null };
    if (id === tx.closingAssociateId) return { name: tx.closingAssociate.fullName, designation: tx.closingAssociate.designation };
    const u = upById.get(id);
    return { name: u?.fullName ?? null, designation: u?.designation ?? null };
  };

  return {
    directUpline: toUpline(tx.directUplineId ? upById.get(tx.directUplineId) : null),
    secondUpline: toUpline(tx.secondUplineId ? upById.get(tx.secondUplineId) : null),
    associate2,
    associate3,
    eligible: tx.commissionEligibility === "Eligible",
    nameOf,
  };
}

/**
 * A-17 verifySale: build the frozen snapshot from live data, to persist on
 * `SalesTransaction.commissionParties` inside the verify transaction.
 */
export async function buildCommissionPartiesSnapshot(db: Db, tx: TxForParties): Promise<CommissionPartiesSnapshot> {
  const live = await loadLiveCommissionParties(db, tx);
  const names: CommissionPartiesSnapshot["names"] = {};
  for (const id of [tx.closingAssociateId, live.directUpline?.associateId, live.secondUpline?.associateId, live.associate2?.associateId, live.associate3?.associateId]) {
    if (id) names[id] = live.nameOf(id);
  }
  return {
    v: 1,
    frozenAt: new Date().toISOString(),
    closer: { id: tx.closingAssociateId, designation: tx.closingAssociate.designation },
    directUpline: live.directUpline ? { id: live.directUpline.associateId, designation: live.directUpline.designation, eligible: live.directUpline.eligible } : null,
    secondUpline: live.secondUpline ? { id: live.secondUpline.associateId, designation: live.secondUpline.designation, eligible: live.secondUpline.eligible } : null,
    associate2: live.associate2 ? { associateId: live.associate2.associateId, valueType: live.associate2.valueType, value: live.associate2.value.toString() } : null,
    associate3: live.associate3 ? { associateId: live.associate3.associateId, valueType: live.associate3.valueType, value: live.associate3.value.toString() } : null,
    names,
  };
}

/**
 * Resolve the uplines, split partners and eligibility a commission recompute
 * needs. A ClosedDeal transaction with a frozen snapshot rehydrates from it —
 * no live associate query for payee decisions, names included (Q14/Q33c).
 * Legacy (commissionParties null) resolves live, as before A-17.
 */
export async function loadCommissionParties(db: Db, tx: TxForParties): Promise<CommissionParties> {
  const snapshot = tx.commissionParties as CommissionPartiesSnapshot | null;
  if (!snapshot) return loadLiveCommissionParties(db, tx);

  const nameOf = (id: string | null): { name: string | null; designation: Designation | null } =>
    (id && snapshot.names[id]) || { name: null, designation: null };
  return {
    directUpline: snapshot.directUpline ? { associateId: snapshot.directUpline.id, designation: snapshot.directUpline.designation, eligible: snapshot.directUpline.eligible } : null,
    secondUpline: snapshot.secondUpline ? { associateId: snapshot.secondUpline.id, designation: snapshot.secondUpline.designation, eligible: snapshot.secondUpline.eligible } : null,
    associate2: snapshot.associate2 ? { associateId: snapshot.associate2.associateId, valueType: snapshot.associate2.valueType, value: snapshot.associate2.value } : null,
    associate3: snapshot.associate3 ? { associateId: snapshot.associate3.associateId, valueType: snapshot.associate3.valueType, value: snapshot.associate3.value } : null,
    // Payment eligibility is driven by amountCollected (A-0), never frozen.
    eligible: tx.commissionEligibility === "Eligible",
    nameOf,
  };
}

/**
 * Compute and persist the commission ledger for a verified transaction, inside the
 * caller's own transaction. Idempotent: replaces the transaction's ledger lines
 * (PRD §6.6), except lines already settled in an Approved/Paid payout, which are
 * kept (see M5 below).
 *
 * R-4: the FOR UPDATE lock is the first statement, before ANY read of the
 * transaction, its lines, uplines or eligibility. Every read from here on goes
 * through `db` (the caller's transaction), so a concurrent recompute that's
 * waiting on this lock is guaranteed to see this call's committed write when it
 * resumes — not a snapshot captured before this call started. (Previously the
 * transaction, uplines and eligibility were read through the global `prisma`
 * client before any lock was taken, so two concurrent recomputes could race:
 * A reads not-eligible, B recomputes to eligible and commits, then A takes the
 * (now free) lock and rewrites B's lines back to not-eligible.)
 */
export async function runCommissionTx(db: Db, transactionId: string): Promise<RunResult> {
  // Lock before reading anything (C1 + R-4): the sale (serialises recomputes of
  // this transaction — and now also its own eligibility/line reads below), then
  // its ledger rows (vs runPayouts attaching them), then every payout they point
  // at (vs approvals). Same order as runPayouts (ledger, then payout), so no
  // cycle. A concurrent approval or payout run now waits for this commit and its
  // CAS then re-checks against what we wrote; if the approval committed first,
  // the locked read below sees Approved and those lines are treated as settled.
  await db.$queryRaw`SELECT id FROM sales_transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM commission_ledger WHERE transaction_id = ${transactionId}::uuid FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM monthly_payouts WHERE id IN (SELECT payout_id FROM commission_ledger WHERE transaction_id = ${transactionId}::uuid) FOR UPDATE`;

  const tx = await db.salesTransaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: { lineItems: { include: { structureVersion: true } }, closingAssociate: true, submission: true },
  });

  // Flow-3 Net-to-Closer split (Associate 2 / 3), uplines and eligibility — all from
  // live data today. A-17 (ClosedDeal) will later source this from a frozen snapshot
  // instead; everything below only depends on this shape, not on where it came from.
  const { directUpline, secondUpline, associate2, associate3, eligible, nameOf } = await loadCommissionParties(db, tx);

  // The managing-director cut's recipients. Resolved ONCE for the whole
  // transaction, not per line: unlike the uplines this does not depend on who
  // closed the sale — it is whoever currently holds the designation.
  // Eligibility uses the same rule as an upline (Approved + Active), so a
  // suspended managing director's share reverts to the company exactly as an
  // ineligible upline's override does.
  const managingDirectors = (
    await db.associate.findMany({
      where: { designation: Designation.ManagingDirector, archivedAt: null },
      select: { id: true, approvalStatus: true, associateStatus: true },
    })
  ).map((m) => ({ associateId: m.id, eligible: m.approvalStatus === "Approved" && m.associateStatus === "Active" }));

  const lineInputs: LineInput[] = tx.lineItems.map((li) =>
    toLineInput(li, li.structureVersion?.rateSnapshot, {
      closer: { associateId: tx.closingAssociateId, designation: tx.closingAssociate.designation },
      directUpline,
      secondUpline,
      managingDirectors,
      associate2,
      associate3,
    }),
  );

  const { lines } = computeTransactionCommission(lineInputs);
  const payoutMonth = format(tx.salesDate, "yyyy-MM");

  const computed = lines.map((l) => {
    const meta = nameOf(l.associateId);
    return {
      transactionId,
      lineItemId: l.lineItemId as string | null, // nullable column; a reversal may target any line
      payoutMonth,
      associateId: l.associateId,
      associateName: meta.name,
      designation: meta.designation,
      lineType: l.lineType,
      comCode: l.comCode,
      basisAmount: l.basisAmount,
      rateOrValue: l.rateOrValue,
      amount: l.amount,
      eligibility: tx.commissionEligibility,
      status: eligible ? LedgerStatus.Eligible : LedgerStatus.Pending,
    };
  });

  // M5 (option a): lines already settled in an Approved/Paid payout are never deleted
  // or rewritten. Everything else is replaced; for settled commission only the
  // difference is written, as a new line that the next payout run picks up.
  const existing = await db.commissionLedger.findMany({
    where: { transactionId },
    include: { payout: { select: { payoutStatus: true } } },
  });
  const isLocked = (l: (typeof existing)[number]) => !!l.payout && l.payout.payoutStatus !== PayoutStatus.Pending;
  const locked = existing.filter(isLocked);
  const pendingPayoutIds = [...new Set(existing.filter((l) => l.payoutId && !isLocked(l)).map((l) => l.payoutId!))];

  await db.commissionLedger.deleteMany({
    where: { transactionId, OR: [{ payoutId: null }, { payout: { payoutStatus: PayoutStatus.Pending } }] },
  });
  const rows = reconcileWithSettled(computed, locked, (l) => {
    // A settled commission that the recompute no longer produces: reversed in full.
    const meta = nameOf(l.associateId);
    return {
      transactionId, lineItemId: l.lineItemId, payoutMonth,
      associateId: l.associateId, associateName: meta.name, designation: meta.designation,
      lineType: l.lineType as (typeof computed)[number]["lineType"], comCode: l.comCode,
      basisAmount: new Prisma.Decimal(l.basisAmount ?? 0), rateOrValue: null, amount: new Prisma.Decimal(0),
      eligibility: tx.commissionEligibility, status: eligible ? LedgerStatus.Eligible : LedgerStatus.Pending,
    };
  });
  if (rows.length) await db.commissionLedger.createMany({ data: rows });
  // A Pending payout that held deleted lines is re-derived from what it still holds.
  const recomputed: { payoutId: string; before: Record<string, string>; after: Record<string, string> }[] = [];
  for (const id of pendingPayoutIds) {
    const change = await recomputePendingPayout(db, id);
    if (change) recomputed.push({ payoutId: id, ...change });
  }
  const adjustments = locked.length ? rows.map((r) => ({ associateId: r.associateId, lineType: r.lineType, amount: r.amount.toString(), remarks: (r as { remarks?: string | null }).remarks ?? null })) : [];
  return { lineCount: lines.length, recomputed, adjustments, settledLineIds: locked.map((l) => l.id) };
}

// R-4: lock waits now count against Prisma's $transaction timeout (default 5s), since
// runCommissionTx can genuinely wait behind another recompute's lock. Widened so a
// normal wait doesn't itself throw P2028; a caller still sees P2028 if something is
// truly stuck, and should treat that as "busy, retry" rather than a hard failure.
export const COMMISSION_TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 };

/** Thin wrapper for callers outside an existing transaction. */
export async function runCommission(transactionId: string, actorUserId: string | null): Promise<number> {
  const result = await prisma.$transaction(async (db) => {
    const r = await runCommissionTx(db, transactionId);
    await auditRunResultTx(db, transactionId, r, actorUserId);
    return r;
  }, COMMISSION_TX_OPTIONS);
  return result.lineCount;
}

// C3: a recompute that moves a Pending payout's total, or writes adjustments against
// settled commission, is recorded. Audit reliability (Tier A,
// reviews/audit-reliability.md): written through the recompute's OWN transaction
// client, as its last statements — if the record can't be written, the recompute
// rolls back with it (AuditWriteError), so money never moves unrecorded.
export async function auditRunResultTx(db: Db, transactionId: string, result: RunResult, actorUserId: string | null): Promise<void> {
  for (const r of result.recomputed) {
    await auditTx(db, { action: "payout.updated", entityType: "MonthlyPayout", entityId: r.payoutId, before: r.before, after: { ...r.after, reason: "commission.recomputed", transactionId }, actorUserId });
  }
  if (result.adjustments.length) {
    await auditTx(db, { action: "commission.adjusted", entityType: "SalesTransaction", entityId: transactionId, after: { settledLineIds: result.settledLineIds, written: result.adjustments }, actorUserId });
  }
}
