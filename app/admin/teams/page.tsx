import { AssociateStatus, ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { periodKeys } from "@/lib/quota";
import { TeamsAdmin } from "./teams-admin";

export const metadata = { title: "Teams · Enshrine Admin" };

export default async function TeamsPage() {
  const t = await getTranslations("teams");
  const { month, year } = periodKeys(new Date());

  const [teams, associates] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: "asc" }, include: {
        members: { select: { associateId: true } },
        quotas: { where: { OR: [{ periodType: "Monthly", period: month }, { periodType: "Yearly", period: year }] }, select: { periodType: true, amount: true } },
      },
    }),
    prisma.associate.findMany({
      where: { associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
      select: { id: true, fullName: true, associateCode: true, designation: true },
      orderBy: { associateCode: "asc" },
    }),
  ]);

  const assoc = associates.map((a) => ({ id: a.id, name: `${a.fullName} (${a.associateCode})`, designation: a.designation as string }));
  const teamData = teams.map((tm) => ({ id: tm.id, name: tm.name, directorId: tm.directorId, memberIds: tm.members.map((m) => m.associateId),
    monthlyTarget: tm.quotas.find((q) => q.periodType === "Monthly")?.amount.toString() ?? null,
    yearlyTarget: tm.quotas.find((q) => q.periodType === "Yearly")?.amount.toString() ?? null,
  }));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <TeamsAdmin teams={teamData} associates={assoc} month={month} year={year} />
    </>
  );
}
