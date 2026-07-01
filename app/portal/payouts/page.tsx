import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "My payouts · Enshrine Portal" };

export default async function MyPayoutsPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const payouts = associateId
    ? await prisma.monthlyPayout.findMany({ where: { associateId }, orderBy: { payoutMonth: "desc" } })
    : [];

  return (
    <>
      <PageHeader title="My payouts" subtitle="Your monthly commission payouts." />
      <Card className="overflow-hidden">
        {payouts.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">No payouts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium">Personal</th>
                  <th className="px-5 py-3 font-medium">Override</th>
                  <th className="px-5 py-3 font-medium">Add-on</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{p.payoutMonth}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.personalCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.overrideCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.addonCommission)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(p.totalPayable)}</td>
                    <td className="px-5 py-3"><StatusPill status={p.payoutStatus} /></td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/payouts/${p.id}/statement`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">Statement ↗</a>
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
