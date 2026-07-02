import { format } from "date-fns";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { downlineIds } from "@/lib/rbac";
import { formatSGD, sum } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Team sales · Enshrine Portal" };

export default async function TeamSalesPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title="Team sales" subtitle="No associate profile is linked to this account." />;

  const dlIds = await downlineIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId);

  const submissions = teamIds.length
    ? await prisma.salesSubmission.findMany({
        where: { closingAssociateId: { in: teamIds } },
        orderBy: { createdAt: "desc" },
        include: { lineItems: { select: { productName: true } }, closingAssociate: { select: { fullName: true, associateCode: true } } },
        take: 200,
      })
    : [];

  const verified = submissions.filter((s) => s.status === "Verified");
  const total = sum(submissions.map((s) => s.saleAmount));
  const verifiedTotal = sum(verified.map((s) => s.saleAmount));

  return (
    <>
      <PageHeader title="Team sales" subtitle="Sales submitted across your downline." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Submissions" value={submissions.length} sub="From your downline" />
        <StatTile label="Total submitted" value={formatSGD(total)} sub="All statuses" />
        <StatTile label="Verified" value={formatSGD(verifiedTotal)} sub={`${verified.length} verified`} />
      </div>

      <Card className="mt-6 overflow-hidden">
        {submissions.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">No team sales yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Associate</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Products</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">
                      {s.closingAssociate.fullName}
                      <span className="ml-1 text-[11px] text-muted-2">{s.closingAssociate.associateCode}</span>
                    </td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-right text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3"><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
