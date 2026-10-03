import Link from "next/link";
import { LedgerLineType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { teamScopeIds } from "@/lib/team";
import { canSetQuota } from "@/lib/quota";
import { QuotaCell } from "./quota-cell";
import { humanize } from "@/lib/labels";
import { formatSGD, sum } from "@/lib/money";
import { parseTab } from "@/lib/recruitment-view";
import { RecruitmentView } from "@/components/recruitment/recruitment-view";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { getTranslations } from "next-intl/server";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Team Dashboard · Enshrine Portal" };

// C-8 (owner ruling, 2026-10-03): this page and the former "Recruitment
// Dashboard" (app/portal/recruitment/associates) are now ONE canonical page.
// This page's 4 stat tiles + downline/quota table are unchanged; the
// All/Direct/Downline associate tabs below the tiles are the other page's
// RecruitmentView, embedded. /portal/recruitment/associates itself now
// redirects here — see that file.
export default async function TeamDashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; mgr?: string }> }) {
  const session = await auth();
  const t = await getTranslations("team");
  const tc = await getTranslations("common");
  const sp = await searchParams;

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("overview.noProfileTitle")} subtitle={t("overview.noProfile")} />;

  const dlIds = await teamScopeIds(associateId);
  const teamIds = dlIds.filter((id) => id !== associateId); // team members excluding self

  const [me, members, submissions, ledger, myOverrides] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId } }),
    prisma.associate.findMany({ where: { id: { in: teamIds } }, orderBy: { associateCode: "asc" }, include: { directUpline: true } }),
    prisma.salesSubmission.findMany({ where: { closingAssociateId: { in: teamIds } }, select: { closingAssociateId: true, saleAmount: true } }),
    prisma.commissionLedger.findMany({ where: { associateId: { in: teamIds } }, select: { associateId: true, amount: true } }),
    prisma.commissionLedger.findMany({ where: { associateId, lineType: LedgerLineType.Override }, select: { amount: true } }),
  ]);

  const teamSales = sum(submissions.map((s) => s.saleAmount));
  const teamCommission = sum(ledger.map((l) => l.amount));
  const myOverride = sum(myOverrides.map((l) => l.amount));

  // Monthly quota per member (16-Jul §3) — editable by SAM+ (director overrides manager).
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const canEditQuota = session ? canSetQuota(session.user.role) : false;
  const thisYear = String(now.getFullYear());
  // Monthly ("YYYY-MM") and yearly ("YYYY") targets share the table (A4).
  const quotas = await prisma.salesQuota.findMany({
    where: { associateId: { in: teamIds }, month: { in: [thisMonth, thisYear] } },
    select: { associateId: true, month: true, amount: true },
  });
  const quotaByAssoc = new Map(quotas.filter((q) => q.month === thisMonth).map((q) => [q.associateId, q.amount.toString()]));
  const yearTargetByAssoc = new Map(quotas.filter((q) => q.month === thisYear).map((q) => [q.associateId, q.amount.toString()]));

  return (
    <>
      <PageHeader
        title={t("overview.pageTitle")}
        subtitle={`${t("overview.yourDownline")} — ${humanize(me?.designation)} · ${me?.associateCode}${me?.teamName ? ` · ${me.teamName}` : ""}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("overview.teamSize")} value={members.length} sub={t("overview.associatesInDownline")} />
        <StatTile label={t("overview.teamSales")} value={formatSGD(teamSales)} sub={t("overview.allSubmittedDownline")} />
        <StatTile label={t("overview.teamCommission")} value={formatSGD(teamCommission)} sub={t("overview.earnedByYourTeam")} />
        <StatTile label={t("overview.myOverrides")} value={formatSGD(myOverride)} sub={t("overview.yourOverrideEarnings")} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 font-display text-[18px] text-ink">{t("overview.rosterHeading")}</h2>
        <RecruitmentView mode="people" basePath="/portal/team" tab={parseTab(sp.tab)} mgr={sp.mgr ?? null} embedded />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">{t("overview.downlineHeading")}</h2>
          <Link href="/portal/team/performance" className="text-[12px] text-action hover:underline">{t("overview.teamPerformanceLink")}</Link>
        </div>
        {members.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("overview.noDownline")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colId")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colDesignation")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colUpline")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colSales")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colCommission")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colQuota")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colYearTarget")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((a) => {
                  const memberSales = sum(submissions.filter((s) => s.closingAssociateId === a.id).map((s) => s.saleAmount));
                  const memberComm = sum(ledger.filter((l) => l.associateId === a.id).map((l) => l.amount));
                  return (
                    <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                      <td className="px-5 py-3 font-medium text-ink">{a.associateCode}</td>
                      <td className="px-5 py-3 text-ink">{a.fullName}</td>
                      <td className="px-5 py-3 text-muted">{humanize(a.designation)}</td>
                      <td className="px-5 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>
                      <td className="px-5 py-3 text-right text-ink">{formatSGD(memberSales)}</td>
                      <td className="px-5 py-3 text-right text-ink">{formatSGD(memberComm)}</td>
                      <td className="px-5 py-3">
                        <QuotaCell associateId={a.id} month={thisMonth} current={quotaByAssoc.get(a.id) ?? null} canEdit={canEditQuota} />
                      </td>
                      <td className="px-5 py-3">
                        <QuotaCell associateId={a.id} month={thisYear} current={yearTargetByAssoc.get(a.id) ?? null} canEdit={canEditQuota} />
                      </td>
                      <td className="px-5 py-3"><StatusPill status={a.associateStatus} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
