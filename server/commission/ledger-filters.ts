import { LedgerLineType, type Prisma } from "@prisma/client";
import { parseDateOnly, parseDateOnlyExclusiveEnd, parseEnum, parseUuid } from "@/lib/url-filters";

/** Raw searchParams as read from the URL, before any validation. */
export type LedgerSearch = {
  associate?: string;
  lineType?: string;
  from?: string;
  to?: string;
};

export type ParsedLedgerSearch = {
  associate?: string;
  lineType?: LedgerLineType;
  from?: Date;
  /** Exclusive: the UTC midnight that starts the day AFTER the requested `to` day. */
  to?: Date;
};

/**
 * Validates raw URL query params before anything reaches Prisma — same
 * reasoning as server/sales/transaction-filters.ts' parseTransactionSearch:
 * a hand-edited/stale link must degrade to "filter ignored", never a 500.
 */
export function parseLedgerSearch(sp: LedgerSearch): ParsedLedgerSearch {
  return {
    associate: parseUuid(sp.associate),
    lineType: parseEnum(Object.values(LedgerLineType), sp.lineType),
    from: parseDateOnly(sp.from),
    to: parseDateOnlyExclusiveEnd(sp.to),
  };
}

export type LedgerFilterParams = {
  associate?: string;
  lineType?: LedgerLineType;
  from?: Date;
  /** Exclusive upper bound (see {@link ParsedLedgerSearch.to}). */
  to?: Date;
};

/** B-6: the ledger's search/filter — associate, line type, date range, one AND clause each. */
export function ledgerWhere(params: LedgerFilterParams): Prisma.CommissionLedgerWhereInput {
  const and: Prisma.CommissionLedgerWhereInput[] = [];
  if (params.associate) and.push({ associateId: params.associate });
  if (params.lineType) and.push({ lineType: params.lineType });
  if (params.from) and.push({ createdAt: { gte: params.from } });
  if (params.to) and.push({ createdAt: { lt: params.to } });
  return and.length ? { AND: and } : {};
}
