import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ComValueType, SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ApproveRejectButtons } from "../approve-reject-buttons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotation review · Enshrine Admin" };

function share(type: ComValueType | null, value: { toString(): string } | null): string {
  if (type == null || value == null) return "";
  return type === ComValueType.Percentage ? `${Number(value)}%` : formatSGD(value as never);
}

export default async function AdminQuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("quotations");
  const { id } = await params;

  const s = await prisma.salesSubmission.findUnique({
    where: { id },
    include: {
      lineItems: true,
      closingAssociate: { select: { fullName: true, associateCode: true } },
      documents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!s) notFound();

  const extraIds = [s.associate2Id, s.associate3Id].filter((x): x is string => !!x);
  const extras = extraIds.length
    ? await prisma.associate.findMany({ where: { id: { in: extraIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(extras.map((a) => [a.id, a.fullName]));
  const pending = s.status === SubmissionStatus.Submitted;

  return (
    <>
      <PageHeader title={s.clientName} subtitle={`${formatSGD(s.saleAmount)} · ${format(s.salesDate, "d MMM yyyy")}`}>
        <Button asChild variant="secondary"><Link href="/admin/quotations">{t("detail.back")}</Link></Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-display text-[16px] text-ink">{t("detail.saleTitle")}</h2>
              <StatusPill status={s.status} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("detail.client")} value={s.clientName} />
              <Field label={t("detail.contact")} value={s.clientContact} />
              <Field label={t("detail.plan")} value={humanize(s.paymentPlan)} />
              <Field label={t("detail.closer")} value={`${s.closingAssociate.associateCode} · ${s.closingAssociate.fullName}`} />
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-2 font-medium">{t("detail.product")}</th>
                    <th className="py-2 text-right font-medium">{t("detail.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lineItems.map((li) => (
                    <tr key={li.id} className="border-b border-line-200 last:border-0">
                      <td className="py-2 text-ink">{li.productName}</td>
                      <td className="py-2 text-right text-ink">{formatSGD(li.lineSaleAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(s.associate2Id || s.associate3Id) && (
              <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
                <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5"><span className="text-muted">{t("detail.assoc1")}: </span><span className="text-ink">{s.closingAssociate.fullName}</span></span>
                {s.associate2Id && <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5"><span className="text-muted">{t("detail.assoc2")}: </span><span className="text-ink">{nameById.get(s.associate2Id) ?? s.associate2Id}</span> <span className="text-muted">({share(s.associate2ValueType, s.associate2Value)})</span></span>}
                {s.associate3Id && <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5"><span className="text-muted">{t("detail.assoc3")}: </span><span className="text-ink">{nameById.get(s.associate3Id) ?? s.associate3Id}</span> <span className="text-muted">({share(s.associate3ValueType, s.associate3Value)})</span></span>}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("detail.docsTitle")}</h2>
            {s.documents.length === 0 ? (
              <p className="text-[13px] text-muted">{t("detail.noDocs")}</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {s.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink">{d.fileName} <span className="text-[11px] text-muted">· {humanize(d.kind)}</span></span>
                    <a href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">{t("detail.viewDoc")}</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("detail.decisionTitle")}</h2>
            {pending ? (
              <>
                <p className="mb-4 text-[13px] text-muted">{t("detail.decisionNote")}</p>
                <ApproveRejectButtons id={s.id} />
              </>
            ) : (
              <p className="text-[13px] text-muted">{t("detail.alreadyProcessed")}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink">{value || "—"}</div>
    </div>
  );
}
