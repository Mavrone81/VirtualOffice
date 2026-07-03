import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Overview · Enshrine Admin" };

export default async function AdminDashboard() {
  const t = await getTranslations("adminDashboard");
  const tc = await getTranslations("common");

  const [activeCount, pendingCount, companies, products, associates] = await Promise.all([
    prisma.associate.count({ where: { associateStatus: AssociateStatus.Active } }),
    prisma.associate.count({ where: { approvalStatus: ApprovalStatus.Pending } }),
    prisma.company.count(),
    prisma.product.count(),
    prisma.associate.findMany({ orderBy: { associateCode: "asc" }, include: { directUpline: true } }),
  ]);

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("statActiveAssociates")} value={activeCount} sub={t("statApprovedActive")} />
        <StatTile label={t("statPendingApproval")} value={pendingCount} sub={t("statAwaitingReview")} />
        <StatTile label={t("statCompanyEntities")} value={companies} sub={t("statInvoiceBrands")} />
        <StatTile label={t("statProducts")} value={products} sub={t("statCommissionStructures")} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">{t("associateMaster")}</h2>
          <span className="text-[12px] text-muted">{t("associatesCount", { count: associates.length })}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("colId")}</th>
                <th className="px-5 py-3 font-medium">{t("colAssociate")}</th>
                <th className="px-5 py-3 font-medium">{t("colDivision")}</th>
                <th className="px-5 py-3 font-medium">{t("colDesignation")}</th>
                <th className="px-5 py-3 font-medium">{t("colUpline")}</th>
                <th className="px-5 py-3 font-medium">{t("colApproval")}</th>
                <th className="px-5 py-3 font-medium">{tc("status")}</th>
              </tr>
            </thead>
            <tbody>
              {associates.map((a) => (
                <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                  <td className="px-5 py-3 font-medium text-ink">{a.associateCode}</td>
                  <td className="px-5 py-3">
                    <div className="text-ink">{a.fullName}</div>
                    {a.businessName && <div className="text-[11px] text-muted-2">{a.businessName}</div>}
                  </td>
                  <td className="px-5 py-3 text-muted">{a.teamName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{humanize(a.designation)}</td>
                  <td className="px-5 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>
                  <td className="px-5 py-3"><StatusPill status={a.approvalStatus} /></td>
                  <td className="px-5 py-3"><StatusPill status={a.associateStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-[12px] text-muted-2">
        {t("footerNote", { roles: Object.values(roleLabel).join(" · ") })}
      </p>
    </>
  );
}
