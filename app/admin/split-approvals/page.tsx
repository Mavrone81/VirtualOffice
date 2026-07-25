import { SubmissionStatus, ComValueType, Designation, AssociateStatus, ApprovalStatus } from "@prisma/client";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { AdminApproveSplitButton } from "./admin-approve-split-button";
import { ReassignDirector } from "./reassign-director";

export const dynamic = "force-dynamic";
export const metadata = { title: "Split approvals · Enshrine Admin" };

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function fmtShare(type: ComValueType | null, value: { toString(): string } | null): string {
  if (type == null || value == null) return "";
  return type === ComValueType.Percentage ? `${Number(value)}%` : formatSGD(value as never);
}

type Row = {
  id: string; clientName: string; saleAmount: unknown; salesDate: Date; createdAt: Date; paymentPlan: string;
  sdApprovedAt: Date | null; splitDirectorId: string | null;
  associate2Id: string | null; associate2ValueType: ComValueType | null; associate2Value: unknown;
  associate3Id: string | null; associate3ValueType: ComValueType | null; associate3Value: unknown;
  closingAssociate: { fullName: string };
  lineItems: { productName: string }[];
};

// Business Admin split pipeline (23-Jul parallel workflow, flow A). Two groups:
// sales still waiting on the assigned SD (reassignable here — issue 2 add-on),
// and sales the SD has cleared (or that auto-approved / have no SD) waiting on
// the admin's own sign-off.
export default async function AdminSplitApprovalsPage() {
  const t = await getTranslations("splitApprovals");
  const threeDaysAgo = new Date(Date.now() - THREE_DAYS_MS);
  const include = {
    closingAssociate: { select: { fullName: true } },
    lineItems: { select: { productName: true } },
  } as const;
  const openStatus = { in: [SubmissionStatus.Submitted, SubmissionStatus.QuotationApproved] };

  const [directors, awaitingSd, awaitingAdmin] = await Promise.all([
    prisma.associate.findMany({
      where: { designation: Designation.SalesDirector, associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    // Still waiting on a real SD who hasn't acted, before the 3-day auto — reassignable.
    prisma.salesSubmission.findMany({
      where: { status: openStatus, closedAt: null, splitAdminApprovedAt: null, sdApprovedAt: null, splitDirectorId: { not: null }, createdAt: { gt: threeDaysAgo } },
      orderBy: { createdAt: "asc" }, include,
    }),
    // SD cleared (explicit / 3-day auto) or no SD assigned — awaiting admin sign-off.
    prisma.salesSubmission.findMany({
      where: { status: openStatus, closedAt: null, splitAdminApprovedAt: null, OR: [{ sdApprovedAt: { not: null } }, { createdAt: { lte: threeDaysAgo } }, { splitDirectorId: null }] },
      orderBy: { createdAt: "asc" }, include,
    }),
  ]);

  const extraIds = [
    ...new Set([...awaitingSd, ...awaitingAdmin].flatMap((s) => [s.associate2Id, s.associate3Id, s.splitDirectorId]).filter((x): x is string => !!x)),
  ];
  const extras = extraIds.length
    ? await prisma.associate.findMany({ where: { id: { in: extraIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(extras.map((a) => [a.id, a.fullName]));
  const dirs = directors.map((d) => ({ id: d.id, name: d.fullName }));

  const daysLeft = (s: Row) => Math.max(0, Math.ceil((s.createdAt.getTime() + THREE_DAYS_MS - Date.now()) / (24 * 60 * 60 * 1000)));

  const row = (s: Row, meta: React.ReactNode, action: React.ReactNode) => (
    <div key={s.id} className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px]">
          <span className="font-medium text-ink">{s.clientName}</span>
          <span className="text-muted"> · {formatSGD(s.saleAmount as never)} · {format(s.salesDate, "d MMM yyyy")}</span>
        </div>
        <div className="flex items-center gap-3">{meta}{action}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
          <span className="text-muted">{t("closer")}: </span><span className="font-medium text-ink">{s.closingAssociate.fullName}</span>
        </span>
        {s.associate2Id && (
          <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
            <span className="text-muted">{t("associate2")}: </span><span className="font-medium text-ink">{nameById.get(s.associate2Id) ?? s.associate2Id}</span>
            <span className="text-muted"> ({fmtShare(s.associate2ValueType, s.associate2Value as never)})</span>
          </span>
        )}
        {s.associate3Id && (
          <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
            <span className="text-muted">{t("associate3")}: </span><span className="font-medium text-ink">{nameById.get(s.associate3Id) ?? s.associate3Id}</span>
            <span className="text-muted"> ({fmtShare(s.associate3ValueType, s.associate3Value as never)})</span>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {s.lineItems.map((li, i) => <span key={i}>{li.productName}</span>)}
        <span>· {humanize(s.paymentPlan)}</span>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title={t("adminTitle")} subtitle={t("adminSubtitle")} />

      {awaitingSd.length > 0 && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-line px-5 py-3 font-display text-[15px] text-ink">{t("sectionAwaitingSd")}</div>
          <div className="divide-y divide-line-200">
            {awaitingSd.map((s) =>
              row(
                s,
                <span className="text-[11px] text-muted">{t("autoIn", { days: daysLeft(s) })}</span>,
                <ReassignDirector submissionId={s.id} current={s.splitDirectorId} directors={dirs} />,
              ),
            )}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-3 font-display text-[15px] text-ink">{t("sectionAwaitingAdmin")}</div>
        {awaitingAdmin.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("adminEmpty")}</p>
        ) : (
          <div className="divide-y divide-line-200">
            {awaitingAdmin.map((s) => {
              const autoPending = !s.sdApprovedAt;
              return row(
                s,
                <span className={`text-[11px] ${autoPending ? "text-muted" : "text-success"}`}>
                  {autoPending ? t("sdAuto") : t("sdApproved")} · {t("director")}: {s.splitDirectorId ? nameById.get(s.splitDirectorId) ?? "—" : t("noDirector")}
                </span>,
                <AdminApproveSplitButton id={s.id} />,
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
