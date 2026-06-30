import { Prisma, Designation, LedgerLineType, CommissionType, ComValueType } from "@prisma/client";
import { D, round2, pctOf, ZERO, type Numeric } from "@/lib/money";

type Dec = Prisma.Decimal;

export type UplineInput = { associateId: string; designation: Designation; eligible: boolean } | null;
export type ComCodeInput = { comCode: string; valueType: ComValueType; value: Numeric };

export type LineInput = {
  lineItemId: string;
  commissionType: CommissionType;
  lineSaleAmount: Numeric;
  closingCommPct?: Numeric | null;
  closingCommFixed?: Numeric | null;
  companyCutPct: Numeric;
  asmOverridePct: Numeric;
  smOverridePct: Numeric;
  sdOverridePct: Numeric;
  isExternal: boolean;
  externalCompanyRetainedPct?: Numeric | null;
  comCodes: ComCodeInput[];
  closer: { associateId: string; designation: Designation };
  directUpline: UplineInput;
  secondUpline: UplineInput;
};

export type LedgerLineResult = {
  lineItemId: string;
  associateId: string | null;
  lineType: LedgerLineType;
  comCode: string | null;
  basisAmount: Dec;
  rateOrValue: Dec | null;
  amount: Dec;
};

export type LineResult = { lines: LedgerLineResult[]; reconciles: boolean };

/** Override % for an upline based on their rank (Consultant earns no override). */
function overridePctForRank(designation: Designation, line: LineInput): Dec {
  switch (designation) {
    case Designation.AssistantSalesManager:
      return D(line.asmOverridePct);
    case Designation.SalesManager:
      return D(line.smOverridePct);
    case Designation.SalesDirector:
      return D(line.sdOverridePct);
    default:
      return ZERO; // Sales Consultant
  }
}

/**
 * Per-line commission (PRD §8.1). Both Percentage and Fixed feed the same
 * company-cut pool → ASM/SM/SD override split → company retained. Overrides are
 * paid out of the pool and never reduce the closer. External products route the
 * bulk to the provider, Enshrine keeping only `externalCompanyRetainedPct`.
 */
export function computeLineCommission(line: LineInput): LineResult {
  const lineSale = round2(line.lineSaleAmount);
  const out: LedgerLineResult[] = [];

  // --- External products (§8.5) ---
  if (line.isExternal) {
    const retainedPct = D(line.externalCompanyRetainedPct ?? 0);
    const retained = pctOf(lineSale, retainedPct);
    const externalPayable = round2(lineSale.sub(retained));
    out.push({ lineItemId: line.lineItemId, associateId: null, lineType: LedgerLineType.ExternalPayable, comCode: null, basisAmount: lineSale, rateOrValue: null, amount: externalPayable });
    out.push({ lineItemId: line.lineItemId, associateId: null, lineType: LedgerLineType.CompanyRetained, comCode: null, basisAmount: lineSale, rateOrValue: retainedPct, amount: retained });
    return { lines: out, reconciles: externalPayable.add(retained).equals(lineSale) };
  }

  // --- Internal products: step 0 commission-type branch ---
  const closing =
    line.commissionType === CommissionType.Fixed
      ? round2(line.closingCommFixed ?? 0)
      : pctOf(lineSale, D(line.closingCommPct ?? 0));

  const pool = pctOf(closing, D(line.companyCutPct));
  const netToCloser = round2(closing.sub(pool));

  // overrides up the chain (depth 2: direct + second upline)
  const overrides: LedgerLineResult[] = [];
  for (const up of [line.directUpline, line.secondUpline]) {
    if (up && up.eligible) {
      const rate = overridePctForRank(up.designation, line);
      const amt = pctOf(pool, rate);
      if (amt.gt(0)) {
        overrides.push({ lineItemId: line.lineItemId, associateId: up.associateId, lineType: LedgerLineType.Override, comCode: null, basisAmount: pool, rateOrValue: rate, amount: amt });
      }
    }
  }
  const totalOverride = overrides.reduce<Dec>((a, o) => a.add(o.amount), ZERO);
  const companyRetained = round2(pool.sub(totalOverride)); // absorbs rounding residual

  out.push({ lineItemId: line.lineItemId, associateId: line.closer.associateId, lineType: LedgerLineType.Personal, comCode: null, basisAmount: closing, rateOrValue: null, amount: netToCloser });
  out.push(...overrides);
  out.push({ lineItemId: line.lineItemId, associateId: null, lineType: LedgerLineType.CompanyRetained, comCode: null, basisAmount: pool, rateOrValue: null, amount: companyRetained });

  // add-on com codes (additive on top, attributed to the closer)
  for (const cc of line.comCodes) {
    const amt = cc.valueType === ComValueType.Percentage ? pctOf(lineSale, D(cc.value)) : round2(cc.value);
    out.push({ lineItemId: line.lineItemId, associateId: line.closer.associateId, lineType: LedgerLineType.AddOn, comCode: cc.comCode, basisAmount: lineSale, rateOrValue: D(cc.value), amount: amt });
  }

  // core split reconciles to the closing commission (add-ons are extra)
  const reconciles = netToCloser.add(totalOverride).add(companyRetained).equals(closing);
  return { lines: out, reconciles };
}

/** A whole transaction = sum over its line items (each tagged with its line_item_id). */
export function computeTransactionCommission(lines: LineInput[]): LineResult {
  const results = lines.map(computeLineCommission);
  return {
    lines: results.flatMap((r) => r.lines),
    reconciles: results.every((r) => r.reconciles),
  };
}
