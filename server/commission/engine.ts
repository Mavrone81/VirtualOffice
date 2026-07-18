import { Prisma, Designation, LedgerLineType, CommissionType, ComValueType } from "@prisma/client";
import { D, round2, pctOf, ZERO, type Numeric } from "@/lib/money";

type Dec = Prisma.Decimal;

export type UplineInput = { associateId: string; designation: Designation; eligible: boolean } | null;
export type ComCodeInput = { comCode: string; valueType: ComValueType; value: Numeric };
/** A share of Net-to-Closer assigned to a second/third associate (% of net or absolute). */
export type SplitInput = { associateId: string; valueType: ComValueType; value: Numeric };

export type LineInput = {
  lineItemId: string;
  commissionType: CommissionType;
  lineSaleAmount: Numeric;
  closingCommPct?: Numeric | null;
  closingCommFixed?: Numeric | null;
  /** Company Cut Pool — % of the SALES AMOUNT (or absolute), taken from the closing commission. */
  companyCutPct: Numeric;
  /** SM Overriding — % of the SALES AMOUNT (or absolute), paid to the direct upline (Tier 1). */
  smOverridePct: Numeric;
  /** SD Overriding — % of the SALES AMOUNT (or absolute), paid to the second upline (Tier 2). */
  sdOverridePct: Numeric;
  isExternal: boolean;
  externalCompanyRetainedPct?: Numeric | null;
  comCodes: ComCodeInput[];
  closer: { associateId: string; designation: Designation };
  directUpline: UplineInput;
  secondUpline: UplineInput;
  /** Optional Net-to-Closer shares for Associate 2 / Associate 3 (Flow 3 split). */
  associate2?: SplitInput | null;
  associate3?: SplitInput | null;
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

/** A % or absolute value resolved against a base (percentage computes on the base). */
function resolve(base: Dec, valueType: ComValueType, value: Numeric): Dec {
  return valueType === ComValueType.Percentage ? pctOf(base, D(value)) : round2(value);
}

/**
 * Per-line commission (16-Jul-2026 model). Every % field computes on the SALES
 * AMOUNT. Closing commission → the company keeps the Cut Pool, the rest is
 * Net-to-Closer (which the submitter may split with Associate 2 / 3). Overrides
 * are POSITION-based — the direct upline (Tier 1) earns SM Overriding, the
 * second upline (Tier 2) earns SD Overriding — and only when that upline is
 * eligible; an ineligible/absent upline's override reverts to the company. The
 * single CompanyRetained line is the company's total take (Cut Pool + Retained),
 * computed as the residual so it absorbs reverted overrides and any rounding.
 * External products route the bulk to the provider, Enshrine keeping only
 * `externalCompanyRetainedPct`.
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

  // --- Internal products ---
  const closing =
    line.commissionType === CommissionType.Fixed
      ? round2(line.closingCommFixed ?? 0)
      : pctOf(lineSale, D(line.closingCommPct ?? 0));

  const cutPool = pctOf(lineSale, D(line.companyCutPct)); // % of the SALE
  const netToCloser = round2(closing.sub(cutPool));

  // Overrides: position-based, only for an eligible upline.
  const smAmt = line.directUpline?.eligible ? pctOf(lineSale, D(line.smOverridePct)) : ZERO;
  const sdAmt = line.secondUpline?.eligible ? pctOf(lineSale, D(line.sdOverridePct)) : ZERO;

  // Net-to-Closer split across Associate 1 (submitter) / 2 / 3.
  const split2 = line.associate2 ? resolve(netToCloser, line.associate2.valueType, line.associate2.value) : ZERO;
  const split3 = line.associate3 ? resolve(netToCloser, line.associate3.valueType, line.associate3.value) : ZERO;
  const closerAmt = round2(netToCloser.sub(split2).sub(split3));

  // Company take = whatever is left after associates + overrides (absorbs reverted overrides + rounding).
  const companyTake = round2(lineSale.sub(netToCloser).sub(smAmt).sub(sdAmt));

  out.push({ lineItemId: line.lineItemId, associateId: line.closer.associateId, lineType: LedgerLineType.Personal, comCode: null, basisAmount: netToCloser, rateOrValue: null, amount: closerAmt });
  if (line.associate2 && split2.gt(0)) {
    out.push({ lineItemId: line.lineItemId, associateId: line.associate2.associateId, lineType: LedgerLineType.Personal, comCode: null, basisAmount: netToCloser, rateOrValue: null, amount: split2 });
  }
  if (line.associate3 && split3.gt(0)) {
    out.push({ lineItemId: line.lineItemId, associateId: line.associate3.associateId, lineType: LedgerLineType.Personal, comCode: null, basisAmount: netToCloser, rateOrValue: null, amount: split3 });
  }
  if (line.directUpline?.eligible && smAmt.gt(0)) {
    out.push({ lineItemId: line.lineItemId, associateId: line.directUpline.associateId, lineType: LedgerLineType.Override, comCode: null, basisAmount: lineSale, rateOrValue: D(line.smOverridePct), amount: smAmt });
  }
  if (line.secondUpline?.eligible && sdAmt.gt(0)) {
    out.push({ lineItemId: line.lineItemId, associateId: line.secondUpline.associateId, lineType: LedgerLineType.Override, comCode: null, basisAmount: lineSale, rateOrValue: D(line.sdOverridePct), amount: sdAmt });
  }
  out.push({ lineItemId: line.lineItemId, associateId: null, lineType: LedgerLineType.CompanyRetained, comCode: null, basisAmount: lineSale, rateOrValue: null, amount: companyTake });

  // add-on com codes (additive on top, attributed to the closer/submitter)
  for (const cc of line.comCodes) {
    const amt = resolve(lineSale, cc.valueType, cc.value);
    out.push({ lineItemId: line.lineItemId, associateId: line.closer.associateId, lineType: LedgerLineType.AddOn, comCode: cc.comCode, basisAmount: lineSale, rateOrValue: D(cc.value), amount: amt });
  }

  // the whole sale reconciles: closer + split2 + split3 + overrides + company = sale (add-ons are extra)
  const reconciles = closerAmt.add(split2).add(split3).add(smAmt).add(sdAmt).add(companyTake).equals(lineSale);
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
