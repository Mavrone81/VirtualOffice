/**
 * Split-approval routing (16-Jul §7): approval follows the TEAM. A Director may
 * split-approve the sales of anyone in a team they direct. These pure helpers
 * turn "the teams this director directs" into the set of closer ids they can
 * approve, so the page query, the sidebar badge, and the approve-permission
 * check all agree — and can be unit-tested without a DB.
 */

/** Distinct member associate ids across the given teams. */
export function teamApprovableCloserIds(teams: { memberIds: string[] }[]): string[] {
  const ids = new Set<string>();
  for (const t of teams) for (const m of t.memberIds) ids.add(m);
  return [...ids];
}

/** Whether a Director may split-approve `closerId` — i.e. the closer is a member
 * of at least one team the Director directs. */
export function directorApprovesCloser(
  directedTeams: { memberIds: string[] }[],
  closerId: string,
): boolean {
  return teamApprovableCloserIds(directedTeams).includes(closerId);
}
