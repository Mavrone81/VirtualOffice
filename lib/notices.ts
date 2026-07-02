import type { AppRole, Prisma } from "@prisma/client";

// Notices visible to a given associate: broadcast to all, to their role, or to
// their team. Shared by the portal notices page and the unread-count badge.
export function noticeAudienceWhere(role: AppRole, team: string | null): Prisma.NoticeWhereInput {
  const clauses: Prisma.NoticeWhereInput[] = [
    { audience: "All" },
    { audience: "Role", audienceRole: role },
  ];
  if (team) clauses.push({ audience: "Team", audienceTeam: team });
  return { OR: clauses };
}
