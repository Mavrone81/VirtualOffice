import { Designation, type Prisma } from "@prisma/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(v: string | undefined): string | undefined {
  return v !== undefined && UUID_RE.test(v) ? v : undefined;
}

/** Raw searchParams as read from the URL, before any validation. */
export type AssociateSearch = {
  designation?: string;
  team?: string;
};

export type ParsedAssociateSearch = {
  designation?: Designation;
  team?: string;
};

/**
 * Validates raw URL query params before anything reaches Prisma — see
 * server/sales/transaction-filters.ts' parseTransactionSearch for why (a
 * hand-edited/stale link must degrade to "filter ignored", never a 500).
 */
export function parseAssociateSearch(sp: AssociateSearch): ParsedAssociateSearch {
  return {
    designation: sp.designation !== undefined && (Object.values(Designation) as string[]).includes(sp.designation)
      ? (sp.designation as Designation)
      : undefined,
    team: parseUuid(sp.team),
  };
}

/**
 * B-4: filter params for the Associate Master list — the same designation +
 * named-manager's-team filters as B-3, applied to `Associate` instead of
 * `SalesTransaction`. `teamMemberIds` is pre-resolved by the caller (via
 * lib/team.ts' teamScopeIds(managerId)).
 */
export type AssociateFilterParams = {
  designation?: Designation;
  teamMemberIds?: string[];
};

export function associateWhere(params: AssociateFilterParams): Prisma.AssociateWhereInput {
  const and: Prisma.AssociateWhereInput[] = [];
  if (params.designation) and.push({ designation: params.designation });
  if (params.teamMemberIds) and.push({ id: { in: params.teamMemberIds } });
  return and.length ? { AND: and } : {};
}
