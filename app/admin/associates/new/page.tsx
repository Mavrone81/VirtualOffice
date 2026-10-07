import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { AssociateForm } from "./associate-form";

export const metadata = { title: "New associate · Enshrine Admin" };

export default async function NewAssociatePage() {
  const t = await getTranslations("associates");

  const [uplines, teams] = await Promise.all([
    prisma.associate.findMany({
      orderBy: { associateCode: "asc" },
      select: { associateCode: true, fullName: true, designation: true, directUpline: { select: { associateCode: true } } },
    }),
    prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  return (
    <>
      <PageHeader title={t("new.title")} subtitle={t("new.subtitle")} />
      <AssociateForm
        teams={teams.map((x) => x.name)}
        uplines={uplines.map((u) => ({
          code: u.associateCode,
          label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})`,
          upCode: u.directUpline?.associateCode ?? null,
        }))}
      />
    </>
  );
}
