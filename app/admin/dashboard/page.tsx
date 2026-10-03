import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { dashboardMetrics, totalAmountCollected } from "@/server/dashboard/metrics";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";

export const metadata = { title: "Dashboard · Enshrine Admin" };

export default async function AdminDashboard() {
  const t = await getTranslations("adminDashboard");

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
    </>
  );
}
