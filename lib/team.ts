import { prisma } from "./db";
import { downlineIds } from "./rbac";

export type TeamSearchInput = { type: "individual" | "team"; value: string };

/**
 * Resolve the set of associate ids a manager's team views + quota authority
 * cover (16-Jul #7). Pure so it can be tested without a DB:
 *  - No explicit team yet → fall back to the upline downline (no view blanks
 *    out before a Business Admin has populated teams).
 *  - Any explicit team → the union of its members, always including self, and
 *    NOT the downline (an explicit team is authoritative).
 */
export function resolveTeamScope(input: {
  self: string;
  teams: { members: string[] }[];
  downline: string[];
}): string[] {
  if (input.teams.length === 0) return input.downline;
  const ids = new Set<string>([input.self]);
  for (const t of input.teams) for (const m of t.members) ids.add(m);
  return [...ids];
}

/**
 * Associate ids in the teams this associate directs or belongs to (self
 * included), falling back to the upline downline when they have no team.
 * Mirrors {@link downlineIds}' self-inclusive contract so call sites swap cleanly.
 */
export async function teamScopeIds(associateId: string): Promise<string[]> {
  const [teams, downline] = await Promise.all([
    prisma.team.findMany({
      where: { active: true, OR: [{ directorId: associateId }, { members: { some: { associateId } } }] },
      select: { members: { select: { associateId: true } } },
    }),
    downlineIds(associateId),
  ]);
  return resolveTeamScope({
    self: associateId,
    teams: teams.map((t) => ({ members: t.members.map((m) => m.associateId) })),
    downline,
  });
}

/**
 * Validates a client-supplied "search by individual/team" selector against
 * THIS associate's own server-computed scope before it is ever used to
 * filter anything — the selector is a CANDIDATE, not a trusted id. Mirrors
 * server/quota/actions.ts's `scope.has(input.associateId)` check. Contrast
 * server/sales/transaction-filters.ts's `closer` param, which passes a
 * caller-supplied associateId straight into a query with no such check —
 * safe there only because that filter is reachable through the admin layer
 * (which already sees every associate); this one is reachable from an
 * ordinary team view and must not trust its input the same way.
 *
 * Returns the associate-id list to filter by: the single associate for a
 * valid "individual" candidate in scope, or a team's member ids for a valid
 * "team" candidate the caller directs or belongs to. Returns `null` for an
 * absent, malformed, or out-of-scope candidate — callers must treat `null`
 * identically to "no search applied" (fall back to the full team scope),
 * never surface a distinct "invalid" state, so an out-of-scope id can't be
 * used to probe for another team's existence by comparing responses.
 */
/** Decodes the `teamSearch` URL param ("ind:<id>" / "team:<id>") into a candidate. Unparseable input is absent, not an error. */
export function parseTeamSearchParam(raw?: string): TeamSearchInput | null {
  if (!raw) return null;
  const [type, ...rest] = raw.split(":");
  const value = rest.join(":");
  if (!value) return null;
  if (type === "ind") return { type: "individual", value };
  if (type === "team") return { type: "team", value };
  return null;
}

export async function resolveTeamSearchScope(
  associateId: string,
  input: TeamSearchInput | null,
): Promise<string[] | null> {
  if (!input?.value) return null;

  if (input.type === "individual") {
    const scope = await teamScopeIds(associateId);
    return scope.includes(input.value) ? [input.value] : null;
  }

  const team = await prisma.team.findFirst({
    where: { id: input.value, active: true, OR: [{ directorId: associateId }, { members: { some: { associateId } } }] },
    select: { members: { select: { associateId: true } } },
  });
  if (!team) return null;
  // Parity with the default (unfiltered) view, which excludes self via
  // `teamScopeIds(...).filter(id => id !== associateId)` on both pages — a
  // team-search result must exclude the caller too, or "Team Commission"/
  // "Team Pending Commission" would silently include the caller's own
  // figures only when searched by team, never by default (DevLead review).
  return team.members.map((m) => m.associateId).filter((id) => id !== associateId);
}
