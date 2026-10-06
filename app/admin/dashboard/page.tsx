import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { dashboardMetrics, totalAmountCollected } from "@/server/dashboard/metrics";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { DownlineLookupPanel } from "@/components/team/downline-lookup-panel";

export const metadata = { title: "Dashboard · Enshrine Admin" };

// ITEM 7: mounted here, below the stat tiles, per the owner's own words --
// "the page can be merged into teh dashbaord tab where the bottom of the
// dashbaord is empty" / "Build it into the dashbaord not just a link." Not a
// nav entry. The five fetches above are unchanged; the panel adds zero
// Prisma calls of its own on the empty-search default state (both its
// fetches short-circuit on an absent q/subject before touching the DB).
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; subject?: string; period?: string }>;
}) {
  const t = await getTranslations("adminDashboard");
  const session = await auth();

  const [activeCount, pendingCount, products, metrics, amountCollected] = await Promise.all([
    prisma.associate.count({ where: { associateStatus: AssociateStatus.Active } }),
    prisma.associate.count({ where: { approvalStatus: ApprovalStatus.Pending } }),
    prisma.product.count(),
    dashboardMetrics(null), // Admin: all teams, org-wide
    totalAmountCollected(), // B-1: sum of SalesTransaction.amountCollected, org-wide
  ]);

  return (
    <>
      <PageHeader title={t("myDashboardTitle")} subtitle={t("myDashboardSubtitle")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatTile label={t("totalTransactionValue")} value={formatSGD(metrics.totalTransactionValue)} sub={t("allTeams")} />
        <StatTile label={t("grossCommissionTransacted")} value={formatSGD(metrics.grossTransacted)} sub={t("allTeams")} />
        <StatTile label={t("totalAmountCollected")} value={formatSGD(amountCollected)} sub={t("totalAmountCollectedSub")} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label={t("statActiveAssociates")} value={activeCount} sub={t("statApprovedActive")} />
        <StatTile label={t("statPendingApproval")} value={pendingCount} sub={t("statAwaitingReview")} />
        <StatTile label={t("statProducts")} value={products} sub={t("statCommissionStructures")} />
      </div>

      {session?.user && (
        <div className="mt-6">
          <DownlineLookupPanel
            viewer={{ associateId: session.user.associateId ?? "00000000-0000-0000-0000-000000000000", role: session.user.role }}
            searchParams={await searchParams}
            basePath="/admin/dashboard"
          />
        </div>
      )}
    </>
  );
}
