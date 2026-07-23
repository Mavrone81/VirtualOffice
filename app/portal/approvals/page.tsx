import { redirect } from "next/navigation";
import { SubmissionStatus, ComValueType } from "@prisma/client";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { humanize } from "@/lib/labels";
import { ApproveSplitButton } from "./approve-split-button";
import { RevertSplitButton } from "./revert-split-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Split approvals · Enshrine Portal" };

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function fmtShare(type: ComValueType | null, value: { toString(): string } | null): string {
  if (type == null || value == null) return "";
  return type === ComValueType.Percentage ? `${Number(value)}%` : formatSGD(value as never);
}

// 16-Jul §4 SD portal surface: submissions from this SD's team awaiting split
// approval. Approve here, or let it auto-approve 3 days after submission. A
// Business Admin sees every pending split (they can also act from /admin).
export default async function PortalApprovalsPage() {
  const session = await auth();
  const role = session?.user.role;
  if (!session || (role !== "SalesDirector" && role !== "Admin")) redirect("/portal/dashboard");

  const t = await getTranslations("portal");
  const isAdmin = role === "Admin";
  const associateId = session.user.associateId;

  // The split is routed to the SD assigned at submission (23-Jul, issue 2): a
  // Director sees the sales whose splitDirectorId is them. A Business Admin sees
  // every pending split (they also have /admin/split-approvals for their step).
  const splitFilter: object = isAdmin ? {} : { splitDirectorId: associateId ?? "__none__" };

  const include = { closingAssociate: true, lineItems: true } as const;
  const [subs, approvedSubs] = await Promise.all([
    prisma.salesSubmission.findMany({ where: { status: SubmissionStatus.Submitted, sdApprovedAt: null, closedAt: null, ...splitFilter }, orderBy: { createdAt: "asc" }, include }),
    // SD-approved but the admin hasn't signed off yet — revertable until then.
    prisma.salesSubmission.findMany({ where: { status: SubmissionStatus.Submitted, sdApprovedAt: { not: null }, splitAdminApprovedAt: null, closedAt: null, ...splitFilter }, orderBy: { createdAt: "desc" }, include }),
  ]);

  const extraIds = [
    ...new Set([...subs, ...approvedSubs].flatMap((s) => [s.associate2Id, s.associate3Id]).filter((x): x is string => !!x)),
  ];
  const extras = extraIds.length
    ? await prisma.associate.findMany({ where: { id: { in: extraIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(extras.map((a) => [a.id, a.fullName]));
  const now = Date.now();

  const daysLeft = (s: (typeof subs)[number]) =>
    Math.max(0, Math.ceil((s.createdAt.getTime() + THREE_DAYS_MS - now) / (24 * 60 * 60 * 1000)));

  const row = (s: (typeof subs)[number], meta: React.ReactNode, action: React.ReactNode) => (
    <div key={s.id} className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px]">
          <span className="font-medium text-ink">{s.clientName}</span>
          <span className="text-muted"> · {formatSGD(s.saleAmount)} · {format(s.salesDate, "d MMM yyyy")}</span>
        </div>
        <div className="flex items-center gap-3">{meta}{action}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
          <span className="text-muted">{t("approvals.associate1")}: </span>
          <span className="font-medium text-ink">{s.closingAssociate.fullName}</span>
        </span>
        {s.associate2Id && (
          <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
            <span className="text-muted">{t("approvals.associate2")}: </span>
            <span className="font-medium text-ink">{nameById.get(s.associate2Id) ?? s.associate2Id}</span>
            <span className="text-muted"> ({fmtShare(s.associate2ValueType, s.associate2Value)})</span>
          </span>
        )}
        {s.associate3Id && (
          <span className="rounded-lg border border-line bg-paper-100 px-3 py-1.5">
            <span className="text-muted">{t("approvals.associate3")}: </span>
            <span className="font-medium text-ink">{nameById.get(s.associate3Id) ?? s.associate3Id}</span>
            <span className="text-muted"> ({fmtShare(s.associate3ValueType, s.associate3Value)})</span>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {s.lineItems.map((li) => (
          <span key={li.id}>{li.productName} · <span className="text-ink">{formatSGD(li.lineSaleAmount)}</span></span>
        ))}
        {s.clientContact && <span>· {s.clientContact}</span>}
        <span>· {humanize(s.paymentPlan)}</span>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title={t("approvals.pageTitle")} subtitle={t("approvals.pageSubtitle")} />

      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-3 font-display text-[15px] text-ink">{t("approvals.pendingTitle")}</div>
        {subs.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">{t("approvals.empty")}</p>
        ) : (
          <div className="divide-y divide-line-200">
            {subs.map((s) => row(s, <span className="text-[11px] text-muted">{t("approvals.autoIn", { days: daysLeft(s) })}</span>, <ApproveSplitButton id={s.id} />))}
          </div>
        )}
      </Card>

      {approvedSubs.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-line px-5 py-3 font-display text-[15px] text-ink">{t("approvals.approvedTitle")}</div>
          <div className="divide-y divide-line-200">
            {approvedSubs.map((s) => row(s, <span className="text-[11px] text-success">{t("approvals.approvedTag")}</span>, <RevertSplitButton id={s.id} />))}
          </div>
        </Card>
      )}
    </>
  );
}
