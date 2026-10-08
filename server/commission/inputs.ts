import { CommissionType, ComValueType, Designation, Prisma } from "@prisma/client";
import type { ComCodeInput, LineInput, SplitInput, UplineInput } from "./engine";

/** The rate snapshot stored on a CommissionStructureVersion. */
export type RateSnapshot = {
  commissionType: CommissionType;
  closingCommPct?: string | null;
  closingCommFixed?: string | null;
  companyCutPct: string;
  companyCutType?: ComValueType | null;
  smOverridePct: string;
  smOverrideType?: ComValueType | null;
  sdOverridePct: string;
  sdOverrideType?: ComValueType | null;
  // Absent on every version written before 2026-10-07. Reading it as 0 is what
  // keeps historical sales recomputing to the figures they were booked at.
  mdCutPct?: string | null;
  mdCutType?: ComValueType | null;
  isExternal: boolean;
  externalCompanyRetainedPct?: string | null;
  externalCompanyRetainedType?: ComValueType | null;
};

/** A submission's Associate 2/3 split, as the engine takes it. */
export function toSplit(id: string | null, vt: ComValueType | null, value: Prisma.Decimal | string | number | null): SplitInput | null {
  return id && vt ? { associateId: id, valueType: vt, value: value ?? "0" } : null;
}

/** An upline as the engine takes it: eligible only while Approved and Active. */
export function toUpline(
  u: { id: string; designation: Designation; approvalStatus: string; associateStatus: string } | undefined | null,
): UplineInput {
  if (!u) return null;
  return { associateId: u.id, designation: u.designation, eligible: u.approvalStatus === "Approved" && u.associateStatus === "Active" };
}

/**
 * One sale line → the engine's LineInput, from the line, its rate snapshot and the
 * sale's parties. Shared by runCommission (what the ledger books) and the split
 * bound check (server/commission/split-bounds.ts), so both compute the same thing.
 */
export function toLineInput(
  li: { id: string; commissionType: CommissionType; lineSaleAmount: Prisma.Decimal | string | number; isExternal: boolean; selectedComCodes: unknown },
  rateSnapshot: unknown,
  ctx: {
    closer: { associateId: string; designation: Designation };
    directUpline: UplineInput;
    secondUpline: UplineInput;
    /** Resolved once per run, not per line — the same people on every sale. */
    managingDirectors?: { associateId: string; eligible: boolean }[];
    associate2: SplitInput | null;
    associate3: SplitInput | null;
  },
): LineInput {
  const rs = (rateSnapshot ?? {}) as RateSnapshot;
  const comCodes: ComCodeInput[] = Array.isArray(li.selectedComCodes) ? (li.selectedComCodes as unknown as ComCodeInput[]) : [];
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
    mdCutPct: rs.mdCutPct ?? "0",
    mdCutType: rs.mdCutType ?? ComValueType.Percentage,
    isExternal: li.isExternal,
    externalCompanyRetainedPct: rs.externalCompanyRetainedPct ?? null,
    externalCompanyRetainedType: rs.externalCompanyRetainedType ?? ComValueType.Percentage,
    comCodes,
    ...ctx,
  };
}
