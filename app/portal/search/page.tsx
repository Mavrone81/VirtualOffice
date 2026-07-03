import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Search · Enshrine Portal" };

const insensitive = (q: string) => ({ contains: q, mode: "insensitive" as const });

export default async function PortalSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const t = await getTranslations("search");
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  const q = (await searchParams).q?.trim() ?? "";

  if (!q) return (<><PageHeader title={t("title")} /><Card className="px-5 py-12 text-center text-[13px] text-muted">{t("typeQuery")}</Card></>);

  const submissions = associateId
    ? await prisma.salesSubmission.findMany({
        where: { closingAssociateId: associateId, OR: [{ clientName: insensitive(q) }, { lineItems: { some: { productName: insensitive(q) } } }] },
        include: { lineItems: { select: { productName: true } }, transaction: { select: { id: true } } },
        orderBy: { salesDate: "desc" }, take: 30,
      })
    : [];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("resultsFor", { q })} />
      {submissions.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("noResults")}</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("secSales")} · {submissions.length}</div>
          <div className="divide-y divide-line-200">
            {submissions.map((s) => {
              const inner = (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-ink">{s.clientName}</span>
                    <div className="text-[11px] text-muted-2">{s.lineItems.map((l) => l.productName).join(", ")} · {format(s.salesDate, "dd MMM yyyy")} · {humanize(s.paymentPlan)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[12px]">
                    <span className="text-ink">{formatSGD(s.saleAmount)}</span>
                    <StatusPill status={s.status} />
                  </div>
                </div>
              );
              return s.transaction ? (
                <a key={s.id} href={`/agreements/${s.transaction.id}/pdf`} target="_blank" rel="noopener" className="block px-5 py-3 hover:bg-paper-100">{inner}</a>
              ) : (
                <div key={s.id} className="px-5 py-3">{inner}</div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}
