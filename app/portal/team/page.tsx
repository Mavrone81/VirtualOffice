import Link from "next/link";
import { LedgerLineType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { downlineIds } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { formatSGD, sum } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Team overview · Enshrine Portal" };

export default async function TeamOverviewPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title="Team" subtitle="No associate profile is linked to this account." />;

  const dlIds = await downlineIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId); // downline excluding self

  const [me, members, submissions, ledger, myOverrides] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId } }),
    prisma.associate.findMany({ where: { id: { in: teamIds } }, orderBy: { associateCode: "asc" }, include: { directUpline: true } }),
    prisma.salesSubmission.findMany({ where: { closingAssociateId: { in: teamIds } }, select: { closingAssociateId: true, saleAmount: true } }),
    prisma.commissionLedger.findMany({ where: { associateId: { in: teamIds } }, select: { associateId: true, amount: true } }),
    prisma.commissionLedger.findMany({ where: { associateId, lineType: LedgerLineType.Override }, select: { amount: true } }),
  ]);

  const teamSales = sum(submissions.map((s) => s.saleAmount));
  const teamCommission = sum(ledger.map((l) => l.amount));
  const myOverride = sum(myOverrides.map((l) => l.amount));

  return (
    <>
      <PageHeader
        title="Team overview"
        subtitle={`Your downline — ${humanize(me?.designation)} · ${me?.associateCode}${me?.teamName ? ` · ${me.teamName}` : ""}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Team size" value={members.length} sub="Associates in your downline" />
        <StatTile label="Team sales" value={formatSGD(teamSales)} sub="All submitted, downline" />
        <StatTile label="Team commission" value={formatSGD(teamCommission)} sub="Earned by your team" />
        <StatTile label="My overrides" value={formatSGD(myOverride)} sub="Your override earnings" />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">Downline</h2>
          <Link href="/portal/team/sales" className="text-[12px] text-action hover:underline">Team sales →</Link>
        </div>
        {members.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">You have no downline associates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">ID</th>
                  <th className="px-5 py-3 font-medium">Associate</th>
                  <th className="px-5 py-3 font-medium">Designation</th>
                  <th className="px-5 py-3 font-medium">Upline</th>
                  <th className="px-5 py-3 font-medium text-right">Sales</th>
                  <th className="px-5 py-3 font-medium text-right">Commission</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((a) => {
                  const memberSales = sum(submissions.filter((s) => s.closingAssociateId === a.id).map((s) => s.saleAmount));
                  const memberComm = sum(ledger.filter((l) => l.associateId === a.id).map((l) => l.amount));
                  return (
                    <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                      <td className="px-5 py-3 font-medium text-ink">{a.associateCode}</td>
                      <td className="px-5 py-3 text-ink">{a.fullName}</td>
                      <td className="px-5 py-3 text-muted">{humanize(a.designation)}</td>
                      <td className="px-5 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>
                      <td className="px-5 py-3 text-right text-ink">{formatSGD(memberSales)}</td>
                      <td className="px-5 py-3 text-right text-ink">{formatSGD(memberComm)}</td>
                      <td className="px-5 py-3"><StatusPill status={a.associateStatus} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
