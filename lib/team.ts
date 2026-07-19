import { prisma } from "./db";
import { downlineIds } from "./rbac";

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
