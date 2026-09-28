import { Suspense } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { SubmissionStatus, SubmissionFlow } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { transactionWhere, parseTransactionSearch, type TransactionSearch } from "@/server/sales/transaction-filters";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { RejectButton } from "./reject-button";
import { VerifyPanel } from "./verify-panel";
import { LegacyBanner } from "@/components/ui/legacy-banner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales & verify · Enshrine Admin" };

const PAGE_SIZE = 25;

// B-2's original page is READ-ONLY (Frontend's B-7 moved marking paid/unpaid
// to Invoices entirely — see MarkPaidButton there); with A17_CLOSED_DEAL_FLOW
// off it renders exactly that, unchanged. With the flag on, A-17 (docs/
// design/a17-quotation-flow.md screen 4) adds a second tab in front of it:
// "Awaiting verification" (SalesSubmission at Submitted + ClosedDeal, with
// Verify/Reject) alongside "Booked" (this exact list, now second).
export default async function SalesVerifyPage({ searchParams }: { searchParams: Promise<TransactionSearch & { page?: string; tab?: string }> }) {
  const t = await getTranslations("verify");
  const tf = await getTranslations("filters");
  const threshold = env.COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD;

  const rawSp = await searchParams;
  const sp = parseTransactionSearch(rawSp);
  const page = Math.max(1, Number.parseInt(rawSp.page ?? "1", 10) || 1);
  const a17On = env.A17_CLOSED_DEAL_FLOW;
  const tab: "awaiting" | "booked" = a17On && rawSp.tab === "booked" ? "booked" : "awaiting";

  const awaitingSales = a17On && tab === "awaiting"
    ? await prisma.salesSubmission.findMany({
        where: { status: SubmissionStatus.Submitted, flow: SubmissionFlow.ClosedDeal },
        orderBy: { createdAt: "asc" },
        include: {
          closingAssociate: { select: { fullName: true, associateCode: true } },
          lineItems: { select: { productName: true } },
        },
      })
    : [];

  const [associates, categories, categoryProductCodes] = await Promise.all([
    prisma.associate.findMany({ select: { id: true, fullName: true, associateCode: true }, orderBy: { fullName: "asc" } }),
    prisma.product.findMany({ where: { productCategory: { not: null } }, select: { productCategory: true }, distinct: ["productCategory"], orderBy: { productCategory: "asc" } }),
    // Product category isn't stored on the line item itself (a productCode
    // snapshot at time of sale) — resolve the selected category to every
    // productCode that has ever carried it, then filter transactions by
    // "any line item with one of those codes". This module (transaction-
    // filters.ts) stays DB-free, so the lookup happens here, not there.
    sp.category
      ? prisma.product.findMany({ where: { productCategory: sp.category }, select: { productCode: true }, distinct: ["productCode"] })
      : Promise.resolve(undefined),
  ]);
  const productCodes = categoryProductCodes?.map((p) => p.productCode);

  const where = transactionWhere({ closer: sp.closer, from: sp.from, to: sp.to, txnId: sp.txnId, productCodes });
  const filtersActive = Boolean(sp.closer || sp.from || sp.to || sp.txnId || sp.category);

  const showBooked = tab === "booked" || !a17On;
  const [total, sales] = showBooked
    ? await Promise.all([
        prisma.salesTransaction.count({ where }),
        prisma.salesTransaction.findMany({
          where,
          orderBy: [{ verifiedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          include: {
            closingAssociate: { select: { fullName: true, associateCode: true } },
            lineItems: { select: { productName: true } },
            invoices: { include: { company: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
            installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } },
            submission: { include: { documents: { orderBy: { createdAt: "asc" } } } },
          },
        }),
      ])
    : [0, []];

  const fields: FilterField[] = [
    { type: "text", key: "txnId", label: tf("txnId") },
    { type: "select", key: "closer", label: tf("associate"), options: associates.map((a) => ({ value: a.id, label: `${a.associateCode} · ${a.fullName}` })) },
    {
      type: "select", key: "category", label: tf("category"),
      options: categories.map((c) => ({ value: c.productCategory as string, label: c.productCategory as string })),
    },
    { type: "date-range", fromKey: "from", toKey: "to", labelFrom: tf("saleDateFrom"), labelTo: tf("saleDateTo") },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={a17On && tab === "awaiting" ? t("awaitingSubtitle") : t("subtitle")} />

      {a17On && (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("title")}>
          {(["awaiting", "booked"] as const).map((tb) => (
            <Link
              key={tb}
              href={tb === "awaiting" ? "/admin/sales/verify" : "/admin/sales/verify?tab=booked"}
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

      {a17On && tab === "awaiting" ? (
        awaitingSales.length === 0 ? (
          <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("awaitingEmpty")}</Card>
        ) : (
          <div className="space-y-4">
            {awaitingSales.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
                  <div className="text-[13px]">
                    <span className="font-medium text-ink">{s.transactionCode}</span>
                    <span className="text-muted"> · {s.clientName} · {formatSGD(s.saleAmount)} · {format(s.salesDate, "d MMM yyyy")}</span>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {s.closingAssociate.fullName} · {humanize(s.paymentPlan)} · {s.lineItems.map((l) => l.productName).join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <VerifyPanel id={s.id} />
                    <RejectButton id={s.id} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
      <>
      <Suspense fallback={null}>
        <FilterBar fields={fields} clearAllLabel={tf("clearAll")} />
      </Suspense>

      {sales.length === 0 ? (
        filtersActive ? (
          <Card><EmptyState message={t("emptyFiltered")} /></Card>
        ) : (
          <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</Card>
        )
      ) : (
        <>
          <div className="space-y-4">
            {sales.map((s) => {
              const docs = s.submission?.documents ?? [];
              const paidInstallments = s.installmentPlan?.schedule.filter((x) => x.paid).length ?? 0;
              return (
                <Card key={s.id} className="overflow-hidden">
                  {a17On && s.submission?.flow === SubmissionFlow.Legacy && (
                    <div className="px-5 pt-4"><LegacyBanner /></div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
                    <div className="text-[13px]">
                      <span className="font-medium text-ink">{s.transactionCode}</span>
                      <span className="text-muted"> · {s.clientName} · {formatSGD(s.saleAmount)} · {format(s.salesDate, "d MMM yyyy")}</span>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {s.closingAssociate.fullName} · {humanize(s.paymentPlan)} · {s.lineItems.map((l) => l.productName).join(", ")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-muted-2">{t("commission")}</span>
                      <StatusPill status={s.commissionEligibility} />
                    </div>
                  </div>

                  <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-line-200">
                    {/* Documents */}
                    <div className="px-5 py-4">
                      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("documents")}</div>
                      {docs.length === 0 ? (
                        <p className="text-[12px] text-muted">{t("noDocuments")}</p>
                      ) : (
                        <ul className="space-y-1.5 text-[12px]">
                          {docs.map((d) => (
                            <li key={d.id} className="flex items-center justify-between gap-3">
                              <span className="text-ink">{d.fileName} <span className="text-[11px] text-muted">· {humanize(d.kind)}</span></span>
                              <a href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener" className="text-[11px] text-action hover:underline">{t("view")}</a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Payments (view-only — mark paid/unpaid lives on Invoices) */}
                    <div className="px-5 py-4">
                      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("payments")}</div>
                      {s.installmentPlan ? (
                        <>
                          <p className="mb-2 text-[12px] text-muted">{t("installmentProgress", { paid: paidInstallments, total: s.installmentPlan.installmentCount, threshold })}</p>
                          <div className="flex flex-wrap gap-2">
                            {s.installmentPlan.schedule.map((x) => (
                              <div key={x.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${x.paid ? "border-success/30 bg-success-50" : "border-line bg-paper-100"}`}>
                                <span className="text-muted">#{x.sequence}</span>
                                <span className="font-medium text-ink">{formatSGD(x.dueAmount)}</span>
                                <StatusPill status={x.paid ? "Paid" : "Pending"} />
                              </div>
                            ))}
                          </div>
                        </>
                      ) : s.invoices.length > 0 ? (
                        <div className="space-y-2">
                          {s.invoices.map((inv) => (
                            <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper-100 px-3 py-2 text-[12px]">
                              <div>
                                <span className="font-medium text-ink">{inv.invoiceNumber}</span>
                                <span className="text-muted"> · {inv.company.name} · {formatSGD(inv.amount)}</span>
                                {inv.paidMethod && <span className="text-muted"> · {humanize(inv.paidMethod)}{inv.paidReference ? ` · ${inv.paidReference}` : ""}</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={inv.status} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-muted">{t("noInvoice")}</p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <Suspense fallback={null}>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              showingLabel={t("pagination.showing", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total })}
              prevLabel={t("pagination.prev")}
              nextLabel={t("pagination.next")}
            />
          </Suspense>
        </>
      )}
      </>
      )}
    </>
  );
}
