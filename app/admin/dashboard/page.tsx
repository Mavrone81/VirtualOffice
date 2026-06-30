import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Overview · Enshrine Admin" };

export default async function AdminDashboard() {
  const [activeCount, pendingCount, companies, products, associates] = await Promise.all([
    prisma.associate.count({ where: { associateStatus: AssociateStatus.Active } }),
    prisma.associate.count({ where: { approvalStatus: ApprovalStatus.Pending } }),
    prisma.company.count(),
    prisma.product.count(),
    prisma.associate.findMany({ orderBy: { associateCode: "asc" }, include: { directUpline: true } }),
  ]);

  return (
    <>
      <PageHeader title="Overview" subtitle="Product Owner workspace — the HR & commission system of record." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Active associates" value={activeCount} sub="Approved & active" />
        <StatTile label="Pending approval" value={pendingCount} sub="Awaiting review" />
        <StatTile label="Company entities" value={companies} sub="Invoice brands" />
        <StatTile label="Products" value={products} sub="Commission structures" />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">Associate master</h2>
          <span className="text-[12px] text-muted">{associates.length} associates</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Associate</th>
                <th className="px-5 py-3 font-medium">Division</th>
                <th className="px-5 py-3 font-medium">Designation</th>
                <th className="px-5 py-3 font-medium">Upline</th>
                <th className="px-5 py-3 font-medium">Approval</th>
                <th className="px-5 py-3 font-medium">Status</th>
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
        Foundation build · roles seeded: {Object.values(roleLabel).join(" · ")}. Sales, commission and payout
        modules are next.
      </p>
    </>
  );
}
