import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { ComValueType, InvoiceStatus, SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sale · Enshrine Portal" };

function share(type: ComValueType | null, value: { toString(): string } | null): string {
  if (type == null || value == null) return "";
  return type === ComValueType.Percentage ? `${Number(value)}%` : formatSGD(value as never);
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  if (!associateId) redirect("/portal/dashboard");
  const t = await getTranslations("portal");
  const { id } = await params;

  const s = await prisma.salesSubmission.findUnique({
    where: { id },
    include: {
      lineItems: true,
      documents: { where: { kind: "Signed" }, orderBy: { createdAt: "asc" } },
      transaction: { include: { invoices: true } },
    },
  });
  if (!s || s.closingAssociateId !== associateId) notFound();

  const extraIds = [s.associate2Id, s.associate3Id].filter((x): x is string => !!x);
  const extras = extraIds.length ? await prisma.associate.findMany({ where: { id: { in: extraIds } }, select: { id: true, fullName: true } }) : [];
  const nameById = new Map(extras.map((a) => [a.id, a.fullName]));

  const ledger = s.transaction
    ? await prisma.commissionLedger.findMany({ where: { transactionId: s.transaction.id, associateId }, orderBy: { payoutMonth: "asc" } })
    : [];

  const editable = s.status === SubmissionStatus.Submitted;
  const approved = s.status === SubmissionStatus.QuotationApproved;
  const paidInvoice = s.transaction?.invoices.find((i) => i.status === InvoiceStatus.Paid) ?? null;

  return (
    <>
      <PageHeader title={s.clientName} subtitle={`${formatSGD(s.saleAmount)} · ${format(s.salesDate, "d MMM yyyy")}`}>
        <span className="flex items-center gap-2">
          <StatusPill status={s.status} />
          <Button asChild variant="secondary"><Link href="/portal/sales">{t("saleDetail.back")}</Link></Button>
          {editable && <Button asChild><Link href={`/portal/sales/${s.id}/edit`}>{t("saleDetail.edit")}</Link></Button>}
        </span>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("saleDetail.detailsTitle")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("saleDetail.client")} value={s.clientName} />
              <Field label={t("saleDetail.contact")} value={s.clientContact} />
              <Field label={t("saleDetail.plan")} value={humanize(s.paymentPlan)} />
              <Field label={t("saleDetail.date")} value={format(s.salesDate, "d MMM yyyy")} />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted"><th className="py-2 font-medium">{t("saleDetail.product")}</th><th className="py-2 text-right font-medium">{t("saleDetail.amount")}</th></tr></thead>
                <tbody>
                  {s.lineItems.map((li) => (
                    <tr key={li.id} className="border-b border-line-200 last:border-0"><td className="py-2 text-ink">{li.productName}</td><td className="py-2 text-right text-ink">{formatSGD(li.lineSaleAmount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(s.associate2Id || s.associate3Id) && (
              <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
                {s.associate2Id && <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5"><span className="text-muted">{t("saleDetail.assoc2")}: </span>{nameById.get(s.associate2Id) ?? s.associate2Id} <span className="text-muted">({share(s.associate2ValueType, s.associate2Value)})</span></span>}
                {s.associate3Id && <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5"><span className="text-muted">{t("saleDetail.assoc3")}: </span>{nameById.get(s.associate3Id) ?? s.associate3Id} <span className="text-muted">({share(s.associate3ValueType, s.associate3Value)})</span></span>}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("saleDetail.commissionsTitle")}</h2>
            {ledger.length === 0 ? (
              <p className="text-[13px] text-muted">{t("saleDetail.noCommissions")}</p>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted"><th className="py-2 font-medium">{t("saleDetail.colType")}</th><th className="py-2 font-medium">{t("saleDetail.colMonth")}</th><th className="py-2 text-right font-medium">{t("saleDetail.colAmount")}</th><th className="py-2 text-right font-medium">{t("saleDetail.colStatus")}</th></tr></thead>
                <tbody>
                  {ledger.map((l) => (
                    <tr key={l.id} className="border-b border-line-200 last:border-0"><td className="py-2 text-ink">{humanize(l.lineType)}{l.comCode ? ` · ${l.comCode}` : ""}</td><td className="py-2 text-muted">{l.payoutMonth}</td><td className="py-2 text-right text-ink">{formatSGD(l.amount)}</td><td className="py-2 text-right"><StatusPill status={l.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("saleDetail.docsTitle")}</h2>
            <div className="space-y-2">
              {approved
                ? <DocLink href={`/portal/quotations/${s.id}/pdf`} label={t("saleDetail.quote")} />
                : <p className="text-[12px] text-muted">{t("saleDetail.quotePending")}</p>}
              {s.transaction && <DocLink href={`/agreements/${s.transaction.id}/pdf`} label={t("saleDetail.agreement")} />}
              {paidInvoice
                ? <DocLink href={`/portal/invoices/${paidInvoice.id}/pdf`} label={t("saleDetail.invoice")} />
                : <p className="text-[12px] text-muted">{t("saleDetail.invoicePending")}</p>}
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("saleDetail.signedDocs")}</div>
              {s.documents.length === 0 ? (
                <p className="text-[12px] text-muted">{t("saleDetail.noSigned")}</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {s.documents.map((d) => (
                    <li key={d.id}><a href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener" className="text-action hover:underline">{d.fileName}</a></li>
                  ))}
                </ul>
              )}
            </div>
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

function DocLink({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noopener" className="block text-[13px] font-medium text-action hover:underline">⤓ {label}</a>;
}
