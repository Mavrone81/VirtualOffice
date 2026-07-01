import { format } from "date-fns";
import { LedgerStatus, PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatSGD, sum } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { RunPayoutsBar, PayoutRowActions } from "./payout-actions";

export const metadata = { title: "Payouts · Enshrine Admin" };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  let month = sp.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const latest = await prisma.commissionLedger.findFirst({
      where: { status: LedgerStatus.Eligible },
      orderBy: { payoutMonth: "desc" },
      select: { payoutMonth: true },
    });
    month = latest?.payoutMonth ?? format(new Date(), "yyyy-MM");
  }

  const payouts = await prisma.monthlyPayout.findMany({
    where: { payoutMonth: month },
    orderBy: { totalPayable: "desc" },
  });

  const totalPayable = sum(payouts.map((p) => p.totalPayable));
  const totalPaid = sum(payouts.filter((p) => p.payoutStatus === PayoutStatus.Paid).map((p) => p.totalPayable));
  const pendingCount = payouts.filter((p) => p.payoutStatus === PayoutStatus.Pending).length;

  return (
    <>
      <PageHeader title="Monthly payouts" subtitle="Personal + override + add-on commission · GIRO bulk file.">
        <form method="get" className="flex items-center gap-2">
          <input type="month" name="month" defaultValue={month} className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink" />
          <button className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-[13px] text-ink hover:bg-paper-100">Go</button>
        </form>
      </PageHeader>

      <div className="mb-5"><RunPayoutsBar month={month} /></div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total payable" value={formatSGD(totalPayable)} sub={month} />
        <StatTile label="Paid" value={formatSGD(totalPaid)} sub="Marked paid" />
        <StatTile label="Associates" value={payouts.length} sub="With a payout" />
        <StatTile label="Pending approval" value={pendingCount} sub="Awaiting" />
      </div>

      <Card className="mt-6 overflow-hidden">
        {payouts.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">
            No payouts for {month}. Click <span className="font-medium text-ink">Run payouts</span> to aggregate eligible commission.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Associate</th>
                  <th className="px-5 py-3 font-medium">Rank</th>
                  <th className="px-5 py-3 font-medium">Personal</th>
                  <th className="px-5 py-3 font-medium">Override</th>
                  <th className="px-5 py-3 font-medium">Add-on</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Method</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-ink">{p.associateName}</td>
                    <td className="px-5 py-3 text-muted">{humanize(p.designation)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.personalCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.overrideCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.addonCommission)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(p.totalPayable)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(p.paymentMethod) || "—"}</td>
                    <td className="px-5 py-3"><StatusPill status={p.payoutStatus} /></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <a href={`/payouts/${p.id}/statement`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">Statement ↗</a>
                        <PayoutRowActions id={p.id} status={p.payoutStatus} />
                      </div>
                    </td>
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
