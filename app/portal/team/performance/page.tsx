import { format } from "date-fns";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isManagerRole } from "@/lib/rbac";
import { parseTab } from "@/lib/recruitment-view";
import { formatSGD, ZERO } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { TEAM_SEARCH_KEY } from "@/lib/team-search-params";
import { resolveMyOverridesPeriod } from "@/lib/my-overrides-period";
import { summarizeTeamPerformance } from "@/lib/team-performance";
import { fetchTeamPerformance } from "@/server/team/performance";
import { teamSalesCommissionFor } from "@/server/sales/team-commission-column";
import { RecruitmentView } from "@/components/recruitment/recruitment-view";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";
import { MyOverridesControls } from "@/components/team/my-overrides-controls";
import { TeamSearchFilter } from "@/components/team/team-search-filter";

export const metadata = { title: "Team Performance · Enshrine Portal" };

const BASE_PATH = "/portal/team/performance";

// C11 (2026-10-03): Team Sales + Team Commissions + the old Downline
// Performance page are ONE page. Open to every associate (the nav item has no
// `roles`); CONTENT differentiates by role, and each branch gates its own
// DATA, not just its markup:
//   - isManagerRole (SAM/SM/SD): the six tiles + the team sales and
//     commission tables. fetchTeamPerformance refuses a non-manager before
//     its first query, so this branch is not the only line of defence.
//     Below them RecruitmentView is embedded unconditionally, and resolves
//     canRecruit itself: SM/SD get the per-associate downline table
//     (transacted value, gross commission, my direct / 2nd upline
//     overriding), everyone else gets the "not eligible for recruitment yet"
//     card. The downline queries still only run when canRecruit is true.
//   - everyone else: the same RecruitmentView mode="performance" on its own,
//     via the early return, never running the team-wide queries.
// Sales Assistant Manager is the role where the two checks disagree
// (isManagerRole true, canRecruit false): it takes the manager branch here,
// exactly as it could already reach Team Sales / Team Commissions, and now
// gets the not-eligible card under its tiles (owner request, 7 Oct 2026).
// Until then that one role saw the page simply stop after the commission
// table — no table, no card, no explanation.
export default async function TeamPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ moView?: string; moMonth?: string; moYear?: string; [TEAM_SEARCH_KEY]?: string; tab?: string; mgr?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = await searchParams;

  if (!isManagerRole(session.user.role)) {
    return <RecruitmentView mode="performance" basePath={BASE_PATH} tab={parseTab(sp.tab)} mgr={sp.mgr ?? null} />;
  }

  const t = await getTranslations("team");
  const tc = await getTranslations("common");

  const associateId = session.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("performance.pageTitle")} subtitle={t("performance.noProfile")} />;

  // Two independent mechanisms on this one page, deliberately kept apart
  // (owner ruling): moView/moMonth/moYear drive ONLY the My Overrides card;
  // teamSearch drives the other five tiles and both tables. Neither reads the
  // other's params.
  const { view, month, year, payoutMonth, yearOptions } = resolveMyOverridesPeriod(sp, new Date());

  const data = await fetchTeamPerformance({ associateId, role: session.user.role, teamSearch: sp[TEAM_SEARCH_KEY], payoutMonth });
  if (!data) return <PageHeader title={t("performance.pageTitle")} subtitle={t("performance.noProfile")} />; // unreachable for a manager; fail closed
  const { members, teams, submissions, ledger, overrides, commissionByTxnAssociate } = data;

  // Tiles come from the SAME rows the tables below render.
  const s = summarizeTeamPerformance(submissions, ledger);
  const myOverride = view === "received" ? overrides.received : overrides.overall;

  return (
    <>
      <PageHeader title={t("performance.pageTitle")} subtitle={t("performance.pageSubtitle")} />

      <div className="mb-4">
        <TeamSearchFilter
          individuals={members.map((m) => ({ id: m.id, label: `${m.fullName} · ${m.associateCode}` }))}
          teams={teams.map((tm) => ({ id: tm.id, label: tm.name }))}
          allLabel={t("search.all")}
          individualGroupLabel={t("search.individuals")}
          teamGroupLabel={t("search.teams")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label={t("sales.submissions")} value={s.submissionCount} sub={t("sales.fromDownline")} />
        <StatTile label={t("sales.totalSubmitted")} value={formatSGD(s.totalSubmitted)} sub={t("sales.allStatuses")} />
        <StatTile label={t("sales.verified")} value={formatSGD(s.verifiedTotal)} sub={t("sales.verifiedCount", { count: s.verifiedCount })} />
        <StatTile label={t("commissions.teamCommission")} value={formatSGD(s.teamCommission)} sub={t("commissions.earnedByDownline")} />
        <StatTile label={t("commissions.teamEligible")} value={formatSGD(s.teamPending)} sub={t("commissions.readyForPayout")} />
      </div>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{t("commissions.myOverrides")}</div>
          <MyOverridesControls
            view={view}
            month={month}
            year={year}
            yearOptions={yearOptions}
            labels={{
              overall: t("commissions.overridesOverall"),
              received: t("commissions.overridesReceived"),
              month: t("commissions.overridesMonth"),
              year: t("commissions.overridesYear"),
            }}
          />
        </div>
        <div className="mt-1.5 font-display text-[26px] leading-none text-ink">{formatSGD(myOverride)}</div>
        {/* NOT a bug: this card ignores the team search on purpose (owner
            ruling, kept from the old Team Commissions page). Filter to one
            person and the five tiles + both tables move; this one stays the
            viewer's own override earnings for its own period. Not a team
            figure at all, so a team filter has nothing to narrow.
            The card's own selected period, shown explicitly so this figure is
            never read against the other tiles above (which are all-time,
            filtered only by the team search) — same raw "YYYY-MM" format the
            ledger table below already uses for its Month column. */}
        <div className="mt-1.5 text-[12px] text-muted-2">
          {t("commissions.yourEarningsFromTeam")} · {payoutMonth}
        </div>
      </Card>

      <h2 className="mb-3 mt-6 font-display text-[18px] text-ink">{t("performance.salesHeading")}</h2>
      <Card className="overflow-hidden">
        {submissions.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("sales.noSales")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colDate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colClient")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colProducts")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colAmount")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colPlan")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colCommission")}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((row) => (
                  <tr key={row.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(row.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">
                      {row.closingAssociate.fullName}
                      <span className="ml-1 text-[11px] text-muted-2">{row.closingAssociate.associateCode}</span>
                    </td>
                    <td className="px-5 py-3 text-ink">{row.clientName}</td>
                    <td className="px-5 py-3 text-muted">{row.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-right text-ink">{formatSGD(row.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(row.paymentPlan)}</td>
                    <td className="px-5 py-3"><StatusPill status={row.status} /></td>
                    <td className="px-5 py-3 text-right text-ink">
                      {row.transaction
                        ? formatSGD(teamSalesCommissionFor(commissionByTxnAssociate, row.transaction.id, row.closingAssociateId) ?? ZERO)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 className="mb-3 mt-6 font-display text-[18px] text-ink">{t("performance.commissionHeading")}</h2>
      <Card className="overflow-hidden">
        {ledger.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("commissions.noCommission")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colTxn")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colType")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colMonth")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("commissions.colCommission")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-ink">
                      {l.associateName ?? "—"}
                      {l.associate?.associateCode ? <span className="ml-1 text-[11px] text-muted-2">{l.associate.associateCode}</span> : null}
                    </td>
                    <td className="px-5 py-3 font-medium text-ink">{l.transaction.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{humanize(l.lineType)}{l.comCode ? ` · ${l.comCode}` : ""}</td>
                    <td className="px-5 py-3 text-muted">{l.payoutMonth}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{formatSGD(l.amount)}</td>
                    <td className="px-5 py-3"><StatusPill status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Rendered for EVERY manager role, eligible to recruit or not. The
          component owns the distinction: canRecruit true (SM/SD) gives the
          downline table, false (Sales Assistant Manager) gives the "not
          eligible for recruitment yet" card — the same card a non-manager
          already sees via the early return above. It is not gated here, so a
          SAM can no longer land on a page that simply stops after the
          commission table with nothing saying why. Ineligible costs no extra
          queries: RecruitmentView sets treeIds = [me] without walking a
          downline when canRecruit is false. */}
      <div className="mt-6">
        <h2 className="mb-3 font-display text-[18px] text-ink">{t("performance.downlineHeading")}</h2>
        <RecruitmentView mode="performance" basePath={BASE_PATH} tab={parseTab(sp.tab)} mgr={sp.mgr ?? null} embedded />
      </div>
    </>
  );
}
