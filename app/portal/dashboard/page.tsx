import Link from "next/link";
import { LedgerStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { downlineIds, isManagerRole } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { formatSGD, sum } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Dashboard · Enshrine Portal" };

export default async function PortalDashboard() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  const isManager = session ? isManagerRole(session.user.role) : false;

  if (!associateId) {
    return <PageHeader title="Dashboard" subtitle="No associate profile is linked to this account." />;
  }

  const dlIds = await downlineIds(associateId);
  const [me, downline, mySubmissions, myLedger] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId } }),
    prisma.associate.findMany({
      where: { id: { in: dlIds }, NOT: { id: associateId } },
      orderBy: { associateCode: "asc" },
      include: { directUpline: true },
    }),
    prisma.salesSubmission.findMany({ where: { closingAssociateId: associateId }, select: { saleAmount: true } }),
    prisma.commissionLedger.findMany({ where: { associateId }, select: { amount: true, status: true } }),
  ]);

  const mySales = sum(mySubmissions.map((s) => s.saleAmount));
  const myEligible = sum(myLedger.filter((l) => l.status === LedgerStatus.Eligible).map((l) => l.amount));
  const myPending = sum(myLedger.filter((l) => l.status === LedgerStatus.Pending).map((l) => l.amount));

  const firstName = me?.businessName ?? me?.fullName?.split(/\s+/)[0] ?? "there";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`${humanize(me?.designation)} · ${me?.associateCode} · ${me?.teamName ?? ""}`}
      >
        {isManager && downline.length > 0 && (
          <Button asChild variant="secondary">
            <Link href="/portal/team">View team →</Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="My sales" value={formatSGD(mySales)} sub="All submitted" />
        <StatTile label="Eligible commission" value={formatSGD(myEligible)} sub="Ready for payout" />
        <StatTile label="Pending" value={formatSGD(myPending)} sub="Awaiting collection" />
        <StatTile label="My downline" value={downline.length} sub="Associates in your team" />
      </div>

      {downline.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[18px] text-ink">My team</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">ID</th>
                  <th className="px-5 py-3 font-medium">Associate</th>
                  <th className="px-5 py-3 font-medium">Designation</th>
                  <th className="px-5 py-3 font-medium">Upline</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {downline.map((a) => (
                  <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{a.associateCode}</td>
                    <td className="px-5 py-3 text-ink">{a.fullName}</td>
                    <td className="px-5 py-3 text-muted">{humanize(a.designation)}</td>
                    <td className="px-5 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>
                    <td className="px-5 py-3"><StatusPill status={a.associateStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-6 p-6">
        <h3 className="font-display text-[17px] text-ink">Your virtual office is taking shape</h3>
        <p className="mt-1.5 max-w-xl text-[13px] text-muted">
          Submitting sales, viewing commissions and payouts, your name card and P-file are coming in the next
          build. For now you can see your profile and team here.
        </p>
      </Card>
    </>
  );
}
