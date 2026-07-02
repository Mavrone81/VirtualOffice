import type { Prisma } from "@prisma/client";

// Documents an associate may see: shared with all, with their team, or assigned
// directly to them. Admin-only (visibility=Admin) documents are excluded.
export function documentVisibilityWhere(associateId: string | null, team: string | null): Prisma.DocumentWhereInput {
  const clauses: Prisma.DocumentWhereInput[] = [{ assignment: "All" }];
  if (team) clauses.push({ assignment: "Team", assignedTeam: team });
  if (associateId) clauses.push({ assignment: "Associate", assignedAssociateId: associateId });
  return { visibility: { not: "Admin" }, OR: clauses };
}
