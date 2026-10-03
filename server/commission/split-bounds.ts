import { CommissionType, ComValueType, Prisma } from "@prisma/client";
import type { prisma as prismaClient } from "@/lib/db";
import { computeLineCommission, type LineResult } from "./engine";
import { toLineInput, toSplit, toUpline } from "./inputs";
import { VERSION_RESOLUTION_ORDER } from "@/server/commission/version-order";

type Db = Prisma.TransactionClient | typeof prismaClient;

/** A commission line the sale would book below zero (SEC-6). */
export type SplitBoundViolation = { productCode: string; lineType: string; associateId: string | null; amount: string };

/**
 * The lines of a computed sale that would go negative. The engine books the closer's
 * Net-to-Closer minus the Associate 2/3 shares with no floor, so a split larger than
 * Net-to-Closer shows up here as a negative closer line (the TXN-0003 class); a
 * company cut larger than the closing commission, or overrides larger than the
 * sale, show up as negative lines too.
 */
export function negativeLines(productCode: string, r: LineResult): SplitBoundViolation[] {
  return r.lines
    .filter((l) => l.amount.isNegative())
    .map((l) => ({ productCode, lineType: l.lineType, associateId: l.associateId, amount: l.amount.toFixed(2) }));
}

export type SaleForBounds = {
  salesDate: Date;
  closingAssociateId: string;
  lines: { productCode: string; commissionType: CommissionType; lineSaleAmount: Prisma.Decimal | string | number; isExternal: boolean; selectedComCodes: unknown }[];
  associate2Id: string | null; associate2ValueType: ComValueType | null; associate2Value: Prisma.Decimal | string | number | null;
  associate3Id: string | null; associate3ValueType: ComValueType | null; associate3Value: Prisma.Decimal | string | number | null;
};

/**
 * SEC-6: compute the sale exactly as the commission engine will — the rate version in
 * force on the sales date (as closeSale resolves it), the closer's current uplines and
 * their eligibility, the split — and return every line that would be negative. Empty
 * means the split fits within Net-to-Closer and nothing goes below zero. Read-only.
 */
export async function splitBoundViolations(db: Db, sale: SaleForBounds): Promise<SplitBoundViolation[]> {
  const closer = await db.associate.findUnique({
    where: { id: sale.closingAssociateId },
    select: {
      designation: true,
      directUpline: { select: { id: true, designation: true, approvalStatus: true, associateStatus: true } },
      secondUpline: { select: { id: true, designation: true, approvalStatus: true, associateStatus: true } },
    },
  });
  if (!closer) return [];
  const ctx = {
    closer: { associateId: sale.closingAssociateId, designation: closer.designation },
    directUpline: toUpline(closer.directUpline),
    secondUpline: toUpline(closer.secondUpline),
    associate2: toSplit(sale.associate2Id, sale.associate2ValueType, sale.associate2Value),
    associate3: toSplit(sale.associate3Id, sale.associate3ValueType, sale.associate3Value),
  };

  const out: SplitBoundViolation[] = [];
  for (const [i, li] of sale.lines.entries()) {
    const version = await db.commissionStructureVersion.findFirst({
      where: { productCode: li.productCode, effectiveDate: { lte: sale.salesDate } },
      orderBy: [...VERSION_RESOLUTION_ORDER],
      select: { rateSnapshot: true },
    });
    const input = toLineInput({ ...li, id: `line-${i}` }, version?.rateSnapshot, ctx);
    out.push(...negativeLines(li.productCode, computeLineCommission(input)));
  }
  return out;
}

const cents = (a: string) => Math.round(Number(a) * 100);
const keyOf = (v: SplitBoundViolation) => `${v.productCode}|${v.lineType}|${v.associateId ?? ""}`;
// Lines are grouped per (product, line type, party) and summed: a sale with two lines of the
// same product books two negative closer lines for that product, and the approval covers
// their total per group, not each line separately.
function negativeTotals(vs: SplitBoundViolation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of vs) m.set(keyOf(v), (m.get(keyOf(v)) ?? 0) + cents(v.amount));
  return m;
}

/**
 * B-S6 (N2): does an approved split-exception snapshot still cover the sale as it would
 * book NOW? True only if every current negative line (by product, line type and party)
 * was in the approved snapshot and is not more negative than approved. A new negative
 * line, or a deeper one (e.g. rates changed since approval), needs a fresh approval.
 */
export function snapshotCovers(current: SplitBoundViolation[], approved: SplitBoundViolation[] | null | undefined): boolean {
  if (current.length === 0) return true;
  if (!approved || approved.length === 0) return false;
  const now = negativeTotals(current);
  const ok = negativeTotals(approved);
  for (const [k, amount] of now) {
    const allowed = ok.get(k);
    if (allowed === undefined || amount < allowed) return false; // new line, or more negative
  }
  return true;
}

/** B-S6 E1: the same negative lines, in any order (what the admin saw = what would be stored). */
export function sameViolations(a: SplitBoundViolation[], b: SplitBoundViolation[]): boolean {
  const canon = (vs: SplitBoundViolation[]) =>
    JSON.stringify([...negativeTotals(vs)].sort(([x], [y]) => x.localeCompare(y)));
  return canon(a) === canon(b);
}
