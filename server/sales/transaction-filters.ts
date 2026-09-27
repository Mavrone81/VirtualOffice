import { isValid, parseISO } from "date-fns";
import { CommissionEligibility, Designation, type Prisma } from "@prisma/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseEnum<T extends string>(values: readonly T[], v: string | undefined): T | undefined {
  return v !== undefined && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}

function parseUuid(v: string | undefined): string | undefined {
  return v !== undefined && UUID_RE.test(v) ? v : undefined;
}

/**
 * A URL date param as UTC midnight, matching `@db.Date` semantics regardless
 * of the server's local timezone (a plain `new Date("2026-02-30")` would
 * silently roll over to March 2 instead of being rejected — parseISO/isValid
 * catches that; the actual value returned is still built explicitly in UTC).
 */
function parseDateOnly(v: string | undefined): Date | undefined {
  if (v === undefined || !DATE_ONLY_RE.test(v) || !isValid(parseISO(v))) return undefined;
  return new Date(`${v}T00:00:00.000Z`);
}

/** Raw searchParams as read from the URL, before any validation. */
export type TransactionSearch = {
  designation?: string;
  team?: string;
  from?: string;
  to?: string;
  product?: string;
  eligibility?: string;
  closer?: string;
  // B-2 (Sales & Verify): a free-text transaction-code prefix search.
  txnId?: string;
  // B-2: a product category (resolved to a set of productCodes by the page,
  // which has the Product table — this module stays DB-free).
  category?: string;
};

export type ParsedTransactionSearch = {
  designation?: Designation;
  team?: string;
  from?: Date;
  /** Exclusive: the UTC midnight that starts the day AFTER the requested `to` day. */
  to?: Date;
  product?: string;
  eligibility?: CommissionEligibility;
  closer?: string;
  txnId?: string;
  category?: string;
};

// A transaction code is short, plain text (e.g. "TXN-00412") — cap the
// length so a pathological query string can't build an unbounded LIKE
// pattern; anything longer just won't match anything real anyway.
const TXN_ID_MAX_LEN = 40;

/**
 * Validates raw URL query params before anything reaches Prisma. A filter
 * link is user-editable and gets shared/bookmarked, so a hand-edited or
 * stale value must degrade to "that filter is ignored", never a 500 or a
 * Postgres error (a non-UUID string reaching a `::uuid` cast throws P2023).
 */
export function parseTransactionSearch(sp: TransactionSearch): ParsedTransactionSearch {
  const to = parseDateOnly(sp.to);
  return {
    designation: parseEnum(Object.values(Designation), sp.designation),
    team: parseUuid(sp.team),
    from: parseDateOnly(sp.from),
    to: to ? new Date(to.getTime() + DAY_MS) : undefined,
    product: sp.product?.trim() || undefined,
    eligibility: parseEnum(Object.values(CommissionEligibility), sp.eligibility),
    closer: parseUuid(sp.closer),
    txnId: sp.txnId?.trim().slice(0, TXN_ID_MAX_LEN) || undefined,
    category: sp.category?.trim() || undefined,
  };
}

/**
 * B-2/B-3: filter params for the Sales & Verify / Transactions / Received /
 * Receivable lists. `teamMemberIds` and `productCodes` are pre-resolved by
 * the caller (via lib/team.ts' teamScopeIds(managerId), and a product ->
 * category lookup respectively) — this module stays DB-free and pure.
 */
export type TransactionFilterParams = {
  designation?: Designation;
  teamMemberIds?: string[];
  from?: Date;
  /** Exclusive upper bound (see {@link ParsedTransactionSearch.to}). */
  to?: Date;
  product?: string;
  /** B-2: every productCode belonging to the selected product category. */
  productCodes?: string[];
  eligibility?: CommissionEligibility;
  closer?: string;
  /** B-2: prefix match on transactionCode, case-insensitive. */
  txnId?: string;
};

/**
 * Builds the Prisma `where` for `SalesTransaction`, one clause per active
 * filter, ANDed together. Each filter only narrows (never widens) the result:
 * an absent param contributes nothing, so calling this with all-empty params
 * is the same as no filter at all.
 */
export function transactionWhere(params: TransactionFilterParams): Prisma.SalesTransactionWhereInput {
  const and: Prisma.SalesTransactionWhereInput[] = [];
  if (params.closer) and.push({ closingAssociateId: params.closer });
  if (params.designation) and.push({ closingAssociate: { designation: params.designation } });
  if (params.teamMemberIds) and.push({ closingAssociateId: { in: params.teamMemberIds } });
  if (params.from) and.push({ salesDate: { gte: params.from } });
  if (params.to) and.push({ salesDate: { lt: params.to } });
  if (params.product) and.push({ lineItems: { some: { productCode: params.product } } });
  if (params.productCodes) and.push({ lineItems: { some: { productCode: { in: params.productCodes } } } });
  if (params.eligibility) and.push({ commissionEligibility: params.eligibility });
  if (params.txnId) and.push({ transactionCode: { startsWith: params.txnId, mode: "insensitive" } });
  return and.length ? { AND: and } : {};
}
