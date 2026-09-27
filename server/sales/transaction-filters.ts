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
};

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
  };
}

/**
 * B-3: filter params for the Transactions / Received / Receivable lists.
 * `teamMemberIds` is pre-resolved by the caller (via lib/team.ts'
 * teamScopeIds(managerId)) — this module stays DB-free and pure.
 */
export type TransactionFilterParams = {
  designation?: Designation;
  teamMemberIds?: string[];
  from?: Date;
  /** Exclusive upper bound (see {@link ParsedTransactionSearch.to}). */
  to?: Date;
  product?: string;
  eligibility?: CommissionEligibility;
  closer?: string;
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
  if (params.eligibility) and.push({ commissionEligibility: params.eligibility });
  return and.length ? { AND: and } : {};
}
