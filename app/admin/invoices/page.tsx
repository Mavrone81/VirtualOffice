import { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { MarkPaidButton } from "./mark-paid-button";

export const metadata = { title: "Invoices & installments · Enshrine Admin" };

export default async function InvoicesPage() {
  const threshold = env.COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD;
  const [plans, invoices] = await Promise.all([
    prisma.installmentPlan.findMany({
      include: { transaction: { include: { closingAssociate: true } }, schedule: { orderBy: { sequence: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({ include: { company: true, transaction: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <>
      <PageHeader
        title="Invoices & installments"
        subtitle={`Record collections — commission becomes payable at the ${ordinal(threshold)} installment.`}
      />

      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">Installment plans</h2>
        </div>
        {plans.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">No installment plans yet.</p>
        ) : (
          <div className="divide-y divide-line-200">
            {plans.map((p) => {
              const paid = p.schedule.filter((s) => s.paid).length;
              const eligible = paid >= threshold;
              return (
                <div key={p.id} className="px-5 py-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px]">
                      <span className="font-medium text-ink">{p.transaction.transactionCode}</span>
                      <span className="text-muted"> · {p.transaction.clientName} · </span>
                      <span className="text-muted">{p.transaction.closingAssociate.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-muted">Total {formatSGD(p.totalAmount)} · {paid}/{threshold} paid</span>
                      <StatusPill status={eligible ? "Eligible" : "PendingCollection"} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.schedule.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${
                          s.paid ? "border-success/30 bg-success-50" : "border-line bg-paper-100"
                        }`}
                      >
                        <span className="text-muted">#{s.sequence}</span>
                        <span className="font-medium text-ink">{formatSGD(s.dueAmount)}</span>
                        {s.paid ? (
                          <span className="text-[11px] font-medium text-success">✓ Paid</span>
                        ) : (
                          <MarkPaidButton id={s.id} kind="installment" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">Issued invoices</h2>
        </div>
        {invoices.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{inv.invoiceNumber}</td>
                    <td className="px-5 py-3 text-muted">{inv.transaction.clientName}</td>
                    <td className="px-5 py-3 text-muted">{inv.company.name}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(inv.amount)}</td>
                    <td className="px-5 py-3"><StatusPill status={inv.status} /></td>
                    <td className="px-5 py-3">
                      {inv.status === InvoiceStatus.Outstanding && <MarkPaidButton id={inv.id} kind="invoice" />}
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
