import { format } from "date-fns";
import { CommissionType, Designation, LedgerStatus, ComValueType, PayoutStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeTransactionCommission, type LineInput, type UplineInput, type ComCodeInput, type SplitInput } from "./engine";
import { reconcileWithSettled } from "./settle";
import { recomputePendingPayout } from "@/server/payouts/totals";
import { logAudit } from "@/lib/audit";

type RateSnapshot = {
  commissionType: CommissionType;
  closingCommPct?: string | null;
  closingCommFixed?: string | null;
  companyCutPct: string;
  companyCutType?: ComValueType | null;
  smOverridePct: string;
  smOverrideType?: ComValueType | null;
  sdOverridePct: string;
  sdOverrideType?: ComValueType | null;
  isExternal: boolean;
  externalCompanyRetainedPct?: string | null;
};

/**
 * Compute and persist the commission ledger for a verified transaction.
 * Idempotent: replaces the transaction's ledger lines (PRD §6.6), except lines
 * already settled in an Approved/Paid payout, which are kept (see M5 below).
 */
export async function runCommission(transactionId: string): Promise<number> {
  const tx = await prisma.salesTransaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: { lineItems: { include: { structureVersion: true } }, closingAssociate: true, submission: true },
  });

  // Flow-3 Net-to-Closer split (Associate 2 / 3), captured on the submission.
  // Applied per line item — exact for the common single-line sale; a multi-line
  // ABSOLUTE split would repeat the amount per line (revisit if multi-line sales
  // with absolute splits become common).
  const toSplit = (
    id: string | null, vt: ComValueType | null, value: Prisma.Decimal | null,
  ): SplitInput | null => (id && vt ? { associateId: id, valueType: vt, value: value ?? "0" } : null);
  const associate2 = toSplit(tx.submission.associate2Id, tx.submission.associate2ValueType, tx.submission.associate2Value);
  const associate3 = toSplit(tx.submission.associate3Id, tx.submission.associate3ValueType, tx.submission.associate3Value);

  // Fetch uplines + split partners so both override and split ledger rows get names.
  const relatedIds = [tx.directUplineId, tx.secondUplineId, tx.submission.associate2Id, tx.submission.associate3Id]
    .filter((x): x is string => Boolean(x));
  const uplines = await prisma.associate.findMany({ where: { id: { in: relatedIds } } });
  const upById = new Map(uplines.map((u) => [u.id, u]));

  const toUpline = (id: string | null): UplineInput => {
    if (!id) return null;
    const u = upById.get(id);
    if (!u) return null;
    return {
      associateId: u.id,
      designation: u.designation,
      eligible: u.approvalStatus === "Approved" && u.associateStatus === "Active",
    };
  };
  const directUpline = toUpline(tx.directUplineId);
  const secondUpline = toUpline(tx.secondUplineId);

  const lineInputs: LineInput[] = tx.lineItems.map((li) => {
    const rs = (li.structureVersion?.rateSnapshot ?? {}) as unknown as RateSnapshot;
    const comCodes: ComCodeInput[] = Array.isArray(li.selectedComCodes)
      ? (li.selectedComCodes as unknown as ComCodeInput[])
      : [];
    return {
      lineItemId: li.id,
      commissionType: li.commissionType,
      lineSaleAmount: li.lineSaleAmount,
      closingCommPct: rs.closingCommPct ?? null,
      closingCommFixed: rs.closingCommFixed ?? null,
      companyCutPct: rs.companyCutPct ?? "0",
      companyCutType: rs.companyCutType ?? ComValueType.Percentage,
      smOverridePct: rs.smOverridePct ?? "0",
      smOverrideType: rs.smOverrideType ?? ComValueType.Percentage,
      sdOverridePct: rs.sdOverridePct ?? "0",
      sdOverrideType: rs.sdOverrideType ?? ComValueType.Percentage,
      isExternal: li.isExternal,
      externalCompanyRetainedPct: rs.externalCompanyRetainedPct ?? null,
      comCodes,
      closer: { associateId: tx.closingAssociateId, designation: tx.closingAssociate.designation },
      directUpline,
      secondUpline,
      associate2,
      associate3,
    };
  });

  const { lines } = computeTransactionCommission(lineInputs);
  const eligible = tx.commissionEligibility === "Eligible";
  const payoutMonth = format(tx.salesDate, "yyyy-MM");

  const nameOf = (id: string | null): { name: string | null; designation: Designation | null } => {
    if (!id) return { name: null, designation: null };
    if (id === tx.closingAssociateId) return { name: tx.closingAssociate.fullName, designation: tx.closingAssociate.designation };
    const u = upById.get(id);
    return { name: u?.fullName ?? null, designation: u?.designation ?? null };
  };

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
  const audit = await prisma.$transaction(async (db) => {
    // Lock before reading (C1): the sale (serialises recomputes of this transaction),
    // its ledger rows (vs runPayouts attaching them), then every payout they point at
    // (vs approvals). Same order as runPayouts (ledger, then payout), so no cycle. A
    // concurrent approval or payout run now waits for this commit and its CAS then
    // re-checks against what we wrote; if the approval committed first, the locked
    // read below sees Approved and those lines are treated as settled.
    await db.$queryRaw`SELECT id FROM sales_transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM commission_ledger WHERE transaction_id = ${transactionId}::uuid FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM monthly_payouts WHERE id IN (SELECT payout_id FROM commission_ledger WHERE transaction_id = ${transactionId}::uuid) FOR UPDATE`;

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
    return { recomputed, adjustments, settledLineIds: locked.map((l) => l.id) };
  });

  // C3: a recompute that moves a Pending payout's total, or writes adjustments against
  // settled commission, is recorded (actor resolved from the session when there is one).
  for (const r of audit.recomputed) {
    await logAudit({ action: "payout.updated", entityType: "MonthlyPayout", entityId: r.payoutId, before: r.before, after: { ...r.after, reason: "commission.recomputed", transactionId } });
  }
  if (audit.adjustments.length) {
    await logAudit({ action: "commission.adjusted", entityType: "SalesTransaction", entityId: transactionId, after: { settledLineIds: audit.settledLineIds, written: audit.adjustments } });
  }

  return lines.length;
}
