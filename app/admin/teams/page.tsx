import { AssociateStatus, ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { TeamsAdmin } from "./teams-admin";

export const metadata = { title: "Teams · Enshrine Admin" };

export default async function TeamsPage() {
  const t = await getTranslations("teams");

  const [teams, associates] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: "asc" }, include: { members: { select: { associateId: true } } } }),
    prisma.associate.findMany({
      where: { associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
      select: { id: true, fullName: true, associateCode: true, designation: true },
      orderBy: { associateCode: "asc" },
    }),
  ]);

  const assoc = associates.map((a) => ({ id: a.id, name: `${a.fullName} (${a.associateCode})`, designation: a.designation as string }));
  const teamData = teams.map((tm) => ({ id: tm.id, name: tm.name, directorId: tm.directorId, memberIds: tm.members.map((m) => m.associateId) }));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <TeamsAdmin teams={teamData} associates={assoc} />
    </>
  );
}
