import { format } from "date-fns";
import { CommissionType, Designation, LedgerStatus, ComValueType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeTransactionCommission, type LineInput, type UplineInput, type ComCodeInput, type SplitInput } from "./engine";

type RateSnapshot = {
  commissionType: CommissionType;
  closingCommPct?: string | null;
  closingCommFixed?: string | null;
  companyCutPct: string;
  smOverridePct: string;
  sdOverridePct: string;
  isExternal: boolean;
  externalCompanyRetainedPct?: string | null;
};

/**
 * Compute and persist the commission ledger for a verified transaction.
 * Idempotent: replaces all ledger lines for the transaction (PRD §6.6).
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
      smOverridePct: rs.smOverridePct ?? "0",
      sdOverridePct: rs.sdOverridePct ?? "0",
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

  await prisma.$transaction([
    prisma.commissionLedger.deleteMany({ where: { transactionId } }),
    prisma.commissionLedger.createMany({
      data: lines.map((l) => {
        const meta = nameOf(l.associateId);
        return {
          transactionId,
          lineItemId: l.lineItemId,
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
      }),
    }),
  ]);

  return lines.length;
}
