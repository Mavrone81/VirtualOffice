import { SubmissionStatus, ComValueType } from "@prisma/client";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { AdminApproveSplitButton } from "./admin-approve-split-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Split approvals · Enshrine Admin" };

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function fmtShare(type: ComValueType | null, value: { toString(): string } | null): string {
  if (type == null || value == null) return "";
  return type === ComValueType.Percentage ? `${Number(value)}%` : formatSGD(value as never);
}

// Business Admin's split sign-off queue (23-Jul parallel workflow, flow A step
// 2): splits the SD has approved (or that auto-approved after 3 days) and are
// waiting on the admin's confirmation. Runs in parallel with quotation approval.
export default async function AdminSplitApprovalsPage() {
  const t = await getTranslations("splitApprovals");
  const threeDaysAgo = new Date(Date.now() - THREE_DAYS_MS);

  const subs = await prisma.salesSubmission.findMany({
    where: {
      status: { in: [SubmissionStatus.Submitted, SubmissionStatus.QuotationApproved] },
      closedAt: null,
      splitAdminApprovedAt: null,
      // SD step landed (explicit / 3-day auto), or there's no SD to wait on.
      OR: [{ sdApprovedAt: { not: null } }, { createdAt: { lte: threeDaysAgo } }, { splitDirectorId: null }],
    },
    orderBy: { createdAt: "asc" },
    include: { closingAssociate: { select: { fullName: true, associateCode: true } }, lineItems: { select: { productName: true } } },
  });

  const extraIds = [
    ...new Set(subs.flatMap((s) => [s.associate2Id, s.associate3Id, s.splitDirectorId]).filter((x): x is string => !!x)),
  ];
  const extras = extraIds.length
    ? await prisma.associate.findMany({ where: { id: { in: extraIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(extras.map((a) => [a.id, a.fullName]));

  return (
    <>
      <PageHeader title={t("adminTitle")} subtitle={t("adminSubtitle")} />
      <Card className="overflow-hidden">
        {subs.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("adminEmpty")}</p>
        ) : (
          <div className="divide-y divide-line-200">
            {subs.map((s) => {
              const autoPending = !s.sdApprovedAt; // reached the queue via the 3-day auto rule
              return (
                <div key={s.id} className="px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px]">
                      <span className="font-medium text-ink">{s.clientName}</span>
                      <span className="text-muted"> · {formatSGD(s.saleAmount)} · {format(s.salesDate, "d MMM yyyy")}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] ${autoPending ? "text-muted" : "text-success"}`}>
                        {autoPending ? t("sdAuto") : t("sdApproved")}
                      </span>
                      <AdminApproveSplitButton id={s.id} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
                      <span className="text-muted">{t("closer")}: </span>
                      <span className="font-medium text-ink">{s.closingAssociate.fullName}</span>
                    </span>
                    <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
                      <span className="text-muted">{t("director")}: </span>
                      <span className="font-medium text-ink">{s.splitDirectorId ? nameById.get(s.splitDirectorId) ?? "—" : t("noDirector")}</span>
                    </span>
                    {s.associate2Id && (
                      <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
                        <span className="text-muted">{t("associate2")}: </span>
                        <span className="font-medium text-ink">{nameById.get(s.associate2Id) ?? s.associate2Id}</span>
                        <span className="text-muted"> ({fmtShare(s.associate2ValueType, s.associate2Value)})</span>
                      </span>
                    )}
                    {s.associate3Id && (
                      <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
                        <span className="text-muted">{t("associate3")}: </span>
                        <span className="font-medium text-ink">{nameById.get(s.associate3Id) ?? s.associate3Id}</span>
                        <span className="text-muted"> ({fmtShare(s.associate3ValueType, s.associate3Value)})</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                    {s.lineItems.map((li, i) => (
                      <span key={i}>{li.productName}</span>
                    ))}
                    <span>· {humanize(s.paymentPlan)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
