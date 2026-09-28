import Link from "next/link";
import { format } from "date-fns";
import { SubmissionStatus, SubmissionFlow } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { AdminQuotationsList, type AdminQuotationRow } from "./admin-quotations-list";
import type { QuotationLineSnapshot } from "@/server/quotations/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotations · Enshrine Admin" };

// Admin quotation-generation queue (23-Jul parallel workflow, flow B): every
// still-Submitted LEGACY sale awaiting a Business Admin to review the
// uploaded documents and approve the rep's right to generate the quotation.
// Runs in parallel with split approval — it is NOT gated on the split.
// A-17 screen 5 (flag on): a ClosedDeal sale never enters this queue — its
// quotation is its own standalone Quotation record, issued before the sale
// exists at all (screen 1), and its Submitted status means "awaiting
// Verify" (screen 4), not "awaiting quotation approval". So this query is
// scoped to Legacy explicitly (a no-op while the flag is off, since every
// submission is Legacy then), and a second tab lists the new Quotation
// records instead — read-only admin monitoring, no approval step.
export default async function AdminQuotationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getTranslations("quotations");
  const a17On = env.A17_CLOSED_DEAL_FLOW;
  const rawSp = await searchParams;
  const tab: "records" | "legacy" = a17On && rawSp.tab === "legacy" ? "legacy" : a17On ? "records" : "legacy";

  const subs = tab === "legacy"
    ? await prisma.salesSubmission.findMany({
        where: { status: SubmissionStatus.Submitted, flow: SubmissionFlow.Legacy },
        orderBy: { createdAt: "asc" },
        include: {
          lineItems: { select: { productName: true } },
          closingAssociate: { select: { fullName: true, associateCode: true } },
          _count: { select: { documents: true } },
        },
      })
    : [];

  const quotations: AdminQuotationRow[] = a17On && tab === "records"
    ? (await prisma.quotation.findMany({
        orderBy: { createdAt: "desc" },
        include: { associate: { select: { fullName: true, associateCode: true } } },
      })).map((q) => ({
        id: q.id,
        quotationCode: q.quotationCode,
        clientName: q.clientName,
        quoteDate: q.quoteDate.toISOString().slice(0, 10),
        total: q.total.toString(),
        status: q.status,
        associateName: q.associate.fullName,
        associateCode: q.associate.associateCode,
        lines: q.lines as QuotationLineSnapshot[],
      }))
    : [];

  return (
    <>
      <PageHeader title={t("list.title")} subtitle={tab === "records" ? t("list.recordsSubtitle") : t("list.subtitle")} />

      {a17On && (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("list.title")}>
          {(["records", "legacy"] as const).map((tb) => (
            <Link
              key={tb}
              href={tb === "records" ? "/admin/quotations" : "/admin/quotations?tab=legacy"}
              aria-current={tb === tab ? "page" : undefined}
              className={
                "rounded-xl border-2 border-ink px-6 py-2.5 text-[14px] font-semibold transition-colors " +
                (tb === tab ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper-100")
              }
            >
              {t(`tabs.${tb}`)}
            </Link>
          ))}
        </nav>
      )}

      {tab === "records" ? (
        <AdminQuotationsList quotations={quotations} />
      ) : (
      <Card className="overflow-hidden">
        {subs.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("list.colDate")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colProducts")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colCloser")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colDocs")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colPlan")}</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{s.closingAssociate.fullName}</td>
                    <td className="px-5 py-3 text-muted">{s._count.documents}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/admin/quotations/${s.id}`} className="text-[12px] text-action hover:underline">{t("list.review")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}
    </>
  );
}
