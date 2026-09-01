import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { teamScopeIds } from "@/lib/team";
import { PageHeader } from "@/components/ui/page-header";
import { AssociatesTable } from "@/components/recruitment/associates-table";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Associates list · Enshrine Portal" };

export default async function AssociatesListPage() {
  const session = await auth();
  const t = await getTranslations("recruitment");
  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("lists.associatesTitle")} subtitle={t("lists.noProfile")} />;

  const ids = await teamScopeIds(associateId);
  const rows = await prisma.associate.findMany({
    where: { id: { in: ids }, archivedAt: null },
    orderBy: { associateCode: "asc" },
    include: { directUpline: true },
  });
  return (
    <>
      <PageHeader title={t("lists.associatesTitle")} subtitle={t("lists.associatesSubtitle")} />
      <AssociatesTable rows={rows} />
    </>
  );
}
