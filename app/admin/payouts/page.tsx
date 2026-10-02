import { format } from "date-fns";
import { LedgerStatus, PayoutStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD, sum } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { isFullAdmin } from "@/lib/rbac";
import { previewPayoutRun } from "@/server/payouts/actions";
import { classifyPreviewPlans } from "@/lib/payout-preview";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { PayoutRowActions, BankFileButton } from "./payout-actions";
import { RunPayoutsBar } from "./run-payouts-bar";
import { PreviewPanel } from "./preview-panel";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Payouts · Enshrine Admin" };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const t = await getTranslations("payouts");
  const tc = await getTranslations("common");
  const session = await auth();

  const sp = await searchParams;
  let month = sp.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const latest = await prisma.commissionLedger.findFirst({
      where: { status: LedgerStatus.Eligible },
      orderBy: { payoutMonth: "desc" },
      select: { payoutMonth: true },
    });
    month = latest?.payoutMonth ?? format(new Date(), "yyyy-MM");
  }

  const [payouts, preview] = await Promise.all([
    prisma.monthlyPayout.findMany({
      where: { payoutMonth: month },
      orderBy: [{ totalPayable: "desc" }, { seq: "asc" }],
    }),
    previewPayoutRun(month),
  ]);

  const totalPayable = sum(payouts.map((p) => p.totalPayable));
  const totalPaid = sum(payouts.filter((p) => p.payoutStatus === PayoutStatus.Paid).map((p) => p.totalPayable));
  const pendingCount = payouts.filter((p) => p.payoutStatus === PayoutStatus.Pending).length;

  const previewOk = preview.ok;
  const plans = previewOk ? preview.plans : [];
  const blockedIds = previewOk ? preview.blockedAssociateIds : [];
  const { willBePaid, carriedForward, total: runTotal } = classifyPreviewPlans(plans);

  const blockedAssociates = blockedIds.length
    ? await prisma.associate.findMany({ where: { id: { in: blockedIds } }, select: { id: true, fullName: true } })
    : [];

  const canReconcile = !!session?.user && isFullAdmin(session.user.role);

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")}>
        <form method="get" className="flex items-center gap-2">
          <input type="month" name="month" defaultValue={month} className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink" />
          <button className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-[13px] text-ink hover:bg-paper-100">{t("go")}</button>
        </form>
      </PageHeader>

      {!previewOk && <p className="mb-4 text-[13px] text-danger">{preview.error}</p>}

      <PreviewPanel month={month} plans={plans} blockedAssociates={blockedAssociates} canReconcile={canReconcile} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <RunPayoutsBar
          month={month}
          total={runTotal.toString()}
          payCount={willBePaid.length}
          hasWork={plans.length > 0}
          carriedCount={carriedForward.length}
          blockedCount={blockedAssociates.length}
        />
        <BankFileButton month={month} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("statTotalPayable")} value={formatSGD(totalPayable)} sub={month} />
        <StatTile label={t("statPaid")} value={formatSGD(totalPaid)} sub={t("statMarkedPaid")} />
        <StatTile label={t("statAssociates")} value={payouts.length} sub={t("statWithPayout")} />
        <StatTile label={t("statPendingApproval")} value={pendingCount} sub={t("statAwaiting")} />
      </div>

      <Card className="mt-6 overflow-hidden">
        {payouts.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">
            {t("noPayoutsPrefix", { month })}{" "}
            <span className="font-medium text-ink">{t("runPayouts")}</span>
            {" "}{t("noPayoutsSuffix")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colRank")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colPersonal")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colOverride")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colAddon")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colTotal")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("colMethod")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}></th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-ink">
                      {p.associateName}
                      {p.seq > 0 && <span className="ml-2 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold">{t("adjustment", { seq: p.seq })}</span>}
                    </td>
                    <td className="px-5 py-3 text-muted">{humanize(p.designation)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.personalCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.overrideCommission)}</td>
                    <td className="px-5 py-3 text-muted">{formatSGD(p.addonCommission)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(p.totalPayable)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(p.paymentMethod) || "—"}</td>
                    <td className="px-5 py-3"><StatusPill status={p.payoutStatus} /></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <a href={`/payouts/${p.id}/statement`} target="_blank" rel="noopener" className="whitespace-nowrap text-[12px] text-action hover:underline">{t("statementLink")}</a>
                        <PayoutRowActions id={p.id} status={p.payoutStatus} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
