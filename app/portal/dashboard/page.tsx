import { LedgerStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { inPeriod, periodKeys, remainingToTarget } from "@/lib/quota";
import { dashboardScopeIds, dashboardMetrics } from "@/server/dashboard/metrics";
import { humanize } from "@/lib/labels";
import { formatSGD, sum } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Dashboard · Enshrine Portal" };

export default async function PortalDashboard() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const t = await getTranslations("portal");

  if (!associateId) {
    return <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.noProfile")} />;
  }

  // Consolidated-menu headline metrics (Sep 2026), scoped by role:
  //  Director → own team · Manager/Asst Mgr → own downline + team · Associate → self.
  const scopeIds = session ? await dashboardScopeIds(session.user.role, associateId) : [associateId];

  // Targets (A4, Sep 2026): personal monthly + yearly targets, measured in
  // commission. "Remaining" = target − MY commission received (paid ledger
  // lines) in that period, by payout month. Replaces the YTD / My sales /
  // Eligible / Pending / My downline tiles (A3 — downline lives in Recruitment).
  const { month: thisMonth, year: thisYear } = periodKeys(new Date());
  const [me, metrics, targets, myPaid] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId } }),
    dashboardMetrics(scopeIds),
    prisma.salesQuota.findMany({
      where: { associateId, month: { in: [thisMonth, thisYear] } },
      select: { month: true, amount: true },
    }),
    prisma.commissionLedger.findMany({
      where: { associateId, status: LedgerStatus.Paid, payoutMonth: { startsWith: thisYear + "-" } },
      select: { amount: true, payoutMonth: true },
    }),
  ]);
  const { totalTransactionValue, grossTransacted, grossReceived } = metrics;
  const monthTarget = targets.find((q) => q.month === thisMonth)?.amount ?? null;
  const yearTarget = targets.find((q) => q.month === thisYear)?.amount ?? null;
  const receivedIn = (period: string) =>
    Number(sum(myPaid.filter((l) => inPeriod(l.payoutMonth, period)).map((l) => l.amount)));
  const remaining = (target: typeof monthTarget, period: string) =>
    target === null ? null : remainingToTarget(Number(target), receivedIn(period));
  const monthRemaining = remaining(monthTarget, thisMonth);
  const yearRemaining = remaining(yearTarget, thisYear);

  const firstName = me?.businessName ?? me?.fullName?.split(/\s+/)[0] ?? "there";

  return (
    <>
      <PageHeader
        title={t("dashboard.welcomeBack", { name: firstName })}
        subtitle={`${humanize(me?.designation)} · ${me?.associateCode} · ${me?.teamName ?? ""}`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatTile id="transaction-value" label={t("dashboard.totalTransactionValue")} value={formatSGD(totalTransactionValue)} sub={t("dashboard.totalTransactionValueSub")} />
        <StatTile id="commission-transacted" label={t("dashboard.grossCommissionTransacted")} value={formatSGD(grossTransacted)} sub={t("dashboard.grossCommissionTransactedSub")} />
        <StatTile id="commission-received" label={t("dashboard.grossCommissionReceived")} value={formatSGD(grossReceived)} sub={t("dashboard.grossCommissionReceivedSub")} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-[66%]">
        <StatTile label={t("dashboard.monthlyTarget")} value={monthTarget !== null ? formatSGD(monthTarget) : t("dashboard.noQuota")} sub={t("dashboard.thisMonth")} />
        <StatTile label={t("dashboard.remainingMonth")} value={monthRemaining !== null ? formatSGD(monthRemaining) : "—"} sub={monthTarget !== null ? t("dashboard.thisMonth") : t("dashboard.setTargetFirst")} />
        <StatTile label={t("dashboard.yearlyTarget")} value={yearTarget !== null ? formatSGD(yearTarget) : t("dashboard.noQuota")} sub={t("dashboard.thisYear")} />
        <StatTile label={t("dashboard.remainingYear")} value={yearRemaining !== null ? formatSGD(yearRemaining) : "—"} sub={yearTarget !== null ? t("dashboard.thisYear") : t("dashboard.setTargetFirst")} />
      </div>

      <Card className="mt-6 p-6">
        <h3 className="font-display text-[17px] text-ink">{t("dashboard.virtualOfficeTitle")}</h3>
        <p className="mt-1.5 max-w-xl text-[13px] text-muted">
          {t("dashboard.virtualOfficeBody")}
        </p>
      </Card>
    </>
  );
}
