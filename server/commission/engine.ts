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
  companyCutType?: ComValueType | null;
  /** SM Overriding — % of the SALES AMOUNT (or absolute), paid to the direct upline (Tier 1). */
  smOverridePct: Numeric;
  smOverrideType?: ComValueType | null;
  /** SD Overriding — % of the SALES AMOUNT (or absolute), paid to the second upline (Tier 2). */
  sdOverridePct: Numeric;
  sdOverrideType?: ComValueType | null;
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
 * Per-line commission (16-Jul-2026 model, extended 2026-10 so an external
 * product pays the associate exactly like an internal one — owner ruling:
 * "make it the same as non-external product and let user configure the
 * amount themselves"). Every % field computes on the SALES AMOUNT. Closing
 * commission → the company keeps the Cut Pool, the rest is Net-to-Closer
 * (which the submitter may split with Associate 2 / 3). Overrides are
 * POSITION-based — the direct upline (Tier 1) earns SM Overriding, the second
 * upline (Tier 2) earns SD Overriding — and only when that upline is
 * eligible; an ineligible/absent upline's override reverts to the company.
 *
 * ONE shared block for both: `retainedBase` is the sale itself for an
 * internal product, or `externalCompanyRetainedPct` of it for an external
 * one (the rest routes to the provider, as an ExternalPayable line). The
 * single CompanyRetained line is `retainedBase` after Net-to-Closer and the
 * overrides — the company's total take, computed as the residual so it
 * absorbs reverted overrides and any rounding, exactly as before for an
 * internal product (retainedBase = the sale, nothing else changes).
 *
 * For an external product this residual is PERMITTED TO GO NEGATIVE, and
 * nothing here clamps it: owner ruling, shown the arithmetic and declining a
 * guard. Worked example — $10,000 sale, 10% closing / 2% cut / 5% SM / 3% SD,
 * 5% retained: provider 9,500 | closing 1,000 | cut 200 | net-to-closer 800 |
 * SM 500 | SD 300 | companyRetained = 500 − 800 − 500 − 300 = −1,100,
 * reconciling exactly (9,500 + 800 + 500 + 300 − 1,100 = 10,000). The company
 * pays out 1,600 to earn 500 on that configuration. THAT IS THE ACCEPTED
 * OUTCOME OF A SETTING THE OWNER CONTROLS, not a bug to be fixed.
 */
export function computeLineCommission(line: LineInput): LineResult {
  const lineSale = round2(line.lineSaleAmount);
  const out: LedgerLineResult[] = [];

  // The base the company's retained figure is computed from: the whole sale
  // for internal, or its configured retained share for external. Everything
  // below this line runs identically for both — internal is simply the
  // retainedBase = lineSale case.
  const externalRetainedPct = D(line.externalCompanyRetainedPct ?? 0);
  const retainedBase = line.isExternal ? pctOf(lineSale, externalRetainedPct) : lineSale;
  const externalPayable = line.isExternal ? round2(lineSale.sub(retainedBase)) : ZERO;

  const closing =
    line.commissionType === CommissionType.Fixed
      ? round2(line.closingCommFixed ?? 0)
      : pctOf(lineSale, D(line.closingCommPct ?? 0));

  // Company cut + overrides each resolve as % of the SALE or an absolute amount.
  const cutPool = resolve(lineSale, line.companyCutType ?? ComValueType.Percentage, line.companyCutPct);
  const netToCloser = round2(closing.sub(cutPool));

  // Overrides: position-based, only for an eligible upline.
  const smAmt = line.directUpline?.eligible ? resolve(lineSale, line.smOverrideType ?? ComValueType.Percentage, line.smOverridePct) : ZERO;
  const sdAmt = line.secondUpline?.eligible ? resolve(lineSale, line.sdOverrideType ?? ComValueType.Percentage, line.sdOverridePct) : ZERO;

  // Net-to-Closer split across Associate 1 (submitter) / 2 / 3.
  const split2 = line.associate2 ? resolve(netToCloser, line.associate2.valueType, line.associate2.value) : ZERO;
  const split3 = line.associate3 ? resolve(netToCloser, line.associate3.valueType, line.associate3.value) : ZERO;
  const closerAmt = round2(netToCloser.sub(split2).sub(split3));

  // Company take = whatever is left of the retained base after associates +
  // overrides (absorbs reverted overrides + rounding). Negative is permitted
  // for external — see the header comment.
  const companyTake = round2(retainedBase.sub(netToCloser).sub(smAmt).sub(sdAmt));

  if (line.isExternal) {
    out.push({ lineItemId: line.lineItemId, associateId: null, lineType: LedgerLineType.ExternalPayable, comCode: null, basisAmount: lineSale, rateOrValue: null, amount: externalPayable });
  }
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
  out.push({
    lineItemId: line.lineItemId, associateId: null, lineType: LedgerLineType.CompanyRetained, comCode: null, basisAmount: lineSale,
    // The external retained %, exactly as the pre-unification code recorded it
    // on this line; null for internal, unchanged.
    rateOrValue: line.isExternal ? externalRetainedPct : null,
    amount: companyTake,
  });

  // add-on com codes (additive on top, attributed to the closer/submitter).
  // Basis is retainedBase, not the raw sale: for an internal line the two are
  // identical (retainedBase = lineSale), so this changes nothing there. For
  // an external line, a Percentage com code against the FULL sale would be a
  // bonus computed on money that is never the company's — most of an
  // external sale routes straight to the provider as externalPayable, and
  // the company only ever holds retainedBase. An add-on resolved against the
  // full sale would make the company fund a bonus out of revenue it never
  // received, deepening the already-permitted-negative companyTake for a
  // reason that has nothing to do with the retained share. retainedBase is
  // the base every other % field in this function already resolves against
  // for the company's side of an external line (see the header comment);
  // add-ons were the one thing still computed on lineSale instead, with no
  // test either way — now both match.
  for (const cc of line.comCodes) {
    const amt = resolve(retainedBase, cc.valueType, cc.value);
    out.push({ lineItemId: line.lineItemId, associateId: line.closer.associateId, lineType: LedgerLineType.AddOn, comCode: cc.comCode, basisAmount: retainedBase, rateOrValue: D(cc.value), amount: amt });
  }

  // the whole sale reconciles: closer + split2 + split3 + overrides + company
  // + provider payable = sale (add-ons are extra). externalPayable is ZERO
  // for internal, so this is exactly the pre-existing internal check.
  const reconciles = closerAmt.add(split2).add(split3).add(smAmt).add(sdAmt).add(companyTake).add(externalPayable).equals(lineSale);
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
