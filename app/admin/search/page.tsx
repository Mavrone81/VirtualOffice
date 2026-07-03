import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Search · Enshrine Admin" };

const insensitive = (q: string) => ({ contains: q, mode: "insensitive" as const });

function Row({ href, left, right }: { href: string; left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper-100">
      <div className="min-w-0">{left}</div>
      {right && <div className="shrink-0 text-right text-[12px]">{right}</div>}
    </Link>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{title} · {count}</div>
      <div className="divide-y divide-line-200">{children}</div>
    </Card>
  );
}

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const t = await getTranslations("search");
  const q = (await searchParams).q?.trim() ?? "";

  if (!q) return (<><PageHeader title={t("title")} /><Card className="px-5 py-12 text-center text-[13px] text-muted">{t("typeQuery")}</Card></>);

  const [associates, candidates, transactions, invoices] = await Promise.all([
    prisma.associate.findMany({
      where: { OR: [{ associateCode: insensitive(q) }, { fullName: insensitive(q) }, { email: insensitive(q) }, { businessName: insensitive(q) }] },
      take: 12, orderBy: { associateCode: "asc" },
    }),
    prisma.candidate.findMany({ where: { OR: [{ fullName: insensitive(q) }, { email: insensitive(q) }] }, take: 12, orderBy: { createdAt: "desc" } }),
    prisma.salesTransaction.findMany({ where: { OR: [{ transactionCode: insensitive(q) }, { clientName: insensitive(q) }] }, take: 12, orderBy: { salesDate: "desc" } }),
    prisma.invoice.findMany({ where: { OR: [{ invoiceNumber: insensitive(q) }, { transaction: { clientName: insensitive(q) } }] }, include: { transaction: true }, take: 12, orderBy: { createdAt: "desc" } }),
  ]);

  const total = associates.length + candidates.length + transactions.length + invoices.length;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("resultsFor", { q })} />
      {total === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("noResults")}</Card>
      ) : (
        <div className="space-y-4">
          <Section title={t("secAssociates")} count={associates.length}>
            {associates.map((a) => (
              <Row key={a.id} href={`/admin/associates/${a.id}`}
                left={<><span className="font-medium text-ink">{a.associateCode}</span> <span className="text-ink">· {a.fullName}</span><div className="text-[11px] text-muted-2">{humanize(a.designation)}{a.email ? ` · ${a.email}` : ""}</div></>}
                right={<StatusPill status={a.associateStatus} />} />
            ))}
          </Section>
          <Section title={t("secCandidates")} count={candidates.length}>
            {candidates.map((c) => (
              <Row key={c.id} href={`/admin/recruitment/${c.id}`}
                left={<><span className="text-ink">{c.fullName}</span><div className="text-[11px] text-muted-2">{c.email}</div></>}
                right={<StatusPill status={c.onboardingStage} />} />
            ))}
          </Section>
          <Section title={t("secTransactions")} count={transactions.length}>
            {transactions.map((tx) => (
              <Row key={tx.id} href={`/agreements/${tx.id}/pdf`}
                left={<><span className="font-medium text-ink">{tx.transactionCode}</span> <span className="text-muted">· {tx.clientName}</span></>}
                right={<span className="text-ink">{formatSGD(tx.saleAmount)}</span>} />
            ))}
          </Section>
          <Section title={t("secInvoices")} count={invoices.length}>
            {invoices.map((inv) => (
              <Row key={inv.id} href={`/admin/invoices/${inv.id}/pdf`}
                left={<><span className="font-medium text-ink">{inv.invoiceNumber}</span> <span className="text-muted">· {inv.transaction.clientName}</span></>}
                right={<><span className="text-ink">{formatSGD(inv.amount)}</span> <StatusPill status={inv.status} /></>} />
            ))}
          </Section>
        </div>
      )}
    </>
  );
}
