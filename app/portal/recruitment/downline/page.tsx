import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { downlineIds } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { AssociatesTable } from "@/components/recruitment/associates-table";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Downline recruits · Enshrine Portal" };

export default async function DownlineRecruitsPage() {
  const session = await auth();
  const t = await getTranslations("recruitment");
  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("lists.downlineTitle")} subtitle={t("lists.noProfile")} />;

  const ids = (await downlineIds(associateId)).filter((id) => id !== associateId);
  const rows = ids.length
    ? await prisma.associate.findMany({
        where: { id: { in: ids }, archivedAt: null },
        orderBy: { associateCode: "asc" },
        include: { directUpline: true },
      })
    : [];
  return (
    <>
      <PageHeader title={t("lists.downlineTitle")} subtitle={t("lists.downlineSubtitle")} />
      <AssociatesTable rows={rows} />
    </>
  );
}
