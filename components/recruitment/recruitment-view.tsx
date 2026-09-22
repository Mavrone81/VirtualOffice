import Link from "next/link";
import { FileSearch } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LedgerStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canRecruit, downlineIds } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { formatSGD } from "@/lib/money";
import { managerOptions, performanceByAssociate, RECRUIT_TABS, selectRecruits, type RecruitTab } from "@/lib/recruitment-view";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

/**
 * Recruitment Dashboard ("people") and Downline Performance ("performance") —
 * associate-portal changes, Sep 2026 (A8/A10). Same tabs and manager filter on
 * both; tabs and filter are URL params so a view can be bookmarked.
 *
 * Eligibility: designations that cannot recruit see the "not eligible yet"
 * state instead of the table. The rule is lib/rbac canRecruit (Assistant
 * Manager and above) — the PDF says "below Manager", which conflicts with the
 * earlier AM+ decision; kept as-is until Samuel confirms (item A9).
 */
export async function RecruitmentView({ mode, basePath, tab, mgr }: {
  mode: "people" | "performance";
  basePath: string;
  tab: RecruitTab;
  mgr: string | null;
}) {
  const t = await getTranslations("recruitment.board");
  const tc = await getTranslations("common");
  const session = await auth();
  const me = session?.user.associateId ?? null;
  const title = mode === "people" ? t("peopleTitle") : t("performanceTitle");

  if (!session || !me) return <PageHeader title={title} subtitle={t("noProfile")} />;
  const eligible = canRecruit(session.user.role);

  const treeIds = eligible ? await downlineIds(me) : [me];
  // Only what the tables show — no contact details or date of birth for uplines.
  const tree = await prisma.associate.findMany({
    where: { id: { in: treeIds }, archivedAt: null },
    orderBy: { associateCode: "asc" },
    select: {
      id: true, associateCode: true, fullName: true, designation: true, directUplineId: true, associateStatus: true,
      directUpline: { select: { associateCode: true } },
    },
  });
  const managers = managerOptions(tree, me);
  const mgrValid = mgr && managers.some((m) => m.id === mgr) ? mgr : null;
  const rows = selectRecruits(tree, me, tab, mgrValid);

  let perf: ReturnType<typeof performanceByAssociate> | null = null;
  if (mode === "performance" && rows.length) {
    const ids = rows.map((r) => r.id);
    const txns = await prisma.salesTransaction.findMany({
      where: { closingAssociateId: { in: ids } },
      select: { id: true, closingAssociateId: true, saleAmount: true, directUplineId: true, secondUplineId: true },
    });
    const lines = await prisma.commissionLedger.findMany({
      where: {
        status: { not: LedgerStatus.Cancelled },
        OR: [{ associateId: { in: ids } }, { associateId: me, transactionId: { in: txns.map((x) => x.id) } }],
      },
      select: { transactionId: true, associateId: true, lineType: true, status: true, amount: true },
    });
    perf = performanceByAssociate(ids, txns, lines, me);
  }

  const href = (next: { tab?: RecruitTab; mgr?: string | null }) => {
    const p = new URLSearchParams();
    const nt = next.tab ?? tab;
    const nm = next.mgr === undefined ? mgrValid : next.mgr;
    if (nt !== "all") p.set("tab", nt);
    if (nm) p.set("mgr", nm);
    const q = p.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  const tabLabel = (k: RecruitTab) => (mode === "people" ? t(`tab.${k}`) : t(`perfTab.${k}`));
  const showUpline = tab !== "direct";
  const th = "px-4 py-3 font-medium";

  return (
    <>
      <PageHeader title={title} subtitle={mode === "people" ? t("peopleSubtitle") : t("performanceSubtitle")} />

      <nav className="mb-4 flex flex-wrap gap-2" aria-label={title}>
        {RECRUIT_TABS.map((k) => (
          <Link
            key={k}
            href={href({ tab: k })}
            aria-current={k === tab ? "page" : undefined}
            className={
              "rounded-xl border-2 border-ink px-5 py-2.5 text-[14px] font-semibold transition-colors " +
              (k === tab ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper-100")
            }
          >
            {tabLabel(k)}
          </Link>
        ))}
      </nav>

      {eligible && managers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">{t("filterByManager")}</span>
          <Link href={href({ mgr: null })} className={"rounded-full border px-3 py-1 " + (!mgrValid ? "border-ink bg-ink text-white" : "border-line text-ink hover:bg-paper-100")}>
            {t("everyone")}
          </Link>
          {managers.map((m) => (
            <Link key={m.id} href={href({ mgr: m.id })} className={"rounded-full border px-3 py-1 " + (mgrValid === m.id ? "border-ink bg-ink text-white" : "border-line text-ink hover:bg-paper-100")}>
              {m.associateCode} · {m.fullName}
            </Link>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-ink text-[11px] uppercase tracking-wide text-white/85">
                <th className={th}>{t("col.id")}</th>
                <th className={th}>{t("col.associate")}</th>
                <th className={th}>{t("col.designation")}</th>
                {showUpline && <th className={th}>{t("col.upline")}</th>}
                {mode === "people" ? (
                  // Contact + date of birth deliberately NOT shown to uplines (Samuel, 2026-09-22).
                  <th className={th}>{tc("status")}</th>
                ) : (
                  <>
                    <th className={`${th} text-right`}>{t("col.transacted")}</th>
                    <th className={`${th} text-right`}>{t("col.commission")}</th>
                    <th className={`${th} text-right`}>{t("col.myDirect")}</th>
                    <th className={`${th} text-right`}>{t("col.mySecond")}</th>
                  </>
                )}
              </tr>
            </thead>
            {eligible && rows.length > 0 && (
              <tbody>
                {rows.map((a) => {
                  const p = perf?.get(a.id);
                  return (
                    <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                      <td className="px-4 py-3 font-medium text-ink">{a.associateCode}</td>
                      <td className="px-4 py-3 text-ink">{a.fullName}</td>
                      <td className="px-4 py-3 text-muted">{humanize(a.designation)}</td>
                      {showUpline && <td className="px-4 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>}
                      {mode === "people" ? (
                        <td className="px-4 py-3"><StatusPill status={a.associateStatus} /></td>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-right tabular-nums text-ink">{formatSGD(p?.transacted ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink">{formatSGD(p?.commission ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink">{formatSGD(p?.myDirect ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink">{formatSGD(p?.mySecond ?? 0)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>

        {!eligible ? (
          <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
            <FileSearch className="h-16 w-16 text-ink/70" strokeWidth={1.4} aria-hidden />
            <p className="font-display text-[22px] text-ink">{t("notEligible")}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</div>
        ) : null}
      </Card>
    </>
  );
}
