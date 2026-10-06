import Link from "next/link";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { searchDownlineCandidates, getDownlineLookup, type Period } from "@/server/team/downline-lookup";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Downline Lookup · Enshrine Admin" };

// ITEM 7. Reached under /admin because today's layouts are mutually
// exclusive (app/admin/layout.tsx redirects anyone who is NOT isAdminRole;
// app/portal/layout.tsx redirects anyone who IS) -- a Director cannot open
// this URL as the admin layout stands. That is a real gap against the
// owner's "director can only see his/her own team" ruling, which implies a
// director uses this too: reported to AD rather than resolved here by
// widening either layout's gate unasked. The authorisation logic below
// (downlineLookupScope, server/team/downline-lookup.ts) is already correct
// for a director's identity regardless of which URL calls it -- the gap is
// in NAVIGATION reachability, not in the check itself, and the tests prove
// the check's behaviour directly rather than by driving a browser through
// a URL a director cannot currently load.
export default async function DownlineLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; subject?: string; period?: string }>;
}) {
  const session = await auth();
  const t = await getTranslations("team");
  const tc = await getTranslations("common");
  if (!session?.user) return <PageHeader title={t("overview.pageTitle")} />;

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const period: Period = sp.period === "year" ? "year" : "month";
  const subjectId = sp.subject?.trim();

  // Admin/Accounts have no associate record; downlineLookupScope never
  // reads viewer.id for them (short-circuits on role first), so an empty
  // string here is never dereferenced for that branch. A non-admin with no
  // associateId (should not happen -- every portal role has one) gets no
  // access rather than a crash, by passing an id downlineIds can't match.
  const viewer = { id: session.user.associateId ?? "00000000-0000-0000-0000-000000000000", role: session.user.role };

  const qs = (overrides: Record<string, string | undefined>) => {
    const merged = { q, period, subject: subjectId, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const candidates = q ? await searchDownlineCandidates(viewer, q) : [];
  const lookup = subjectId ? await getDownlineLookup(viewer, subjectId, period) : null;

  const periodLabel = period === "month" ? t("overview.thisMonth") : t("overview.thisYear");
  const money = (s: string) => `S$${Number(s).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const targetCell = (target: { amount: string; source: "individual" | "team" } | null) =>
    target ? `${money(target.amount)}${target.source === "team" ? ` ${t("overview.teamTargetTag")}` : ""}` : "—";

  return (
    <>
      <PageHeader title={t("overview.downlineLookupTitle")} subtitle={t("overview.downlineLookupSubtitle")} />

      <Card className="p-5">
        <form method="GET" className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="period" value={period} />
          {subjectId && <input type="hidden" name="subject" value={subjectId} />}
          <input
            type="text" name="q" defaultValue={q} placeholder={t("overview.searchPlaceholder")}
            className="h-11 flex-1 min-w-[220px] rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
          />
          <button type="submit" className="h-11 rounded-lg bg-action px-4 text-[13px] font-semibold text-white">
            {t("overview.searchBtn")}
          </button>
        </form>

        {q && (
          <div className="mt-4 divide-y divide-line-200 border-t border-line">
            {candidates.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted">{t("overview.noMatches")}</p>
            ) : (
              candidates.map((c) => (
                <Link key={c.id} href={qs({ subject: c.id })} className="flex items-center justify-between gap-3 py-3 hover:bg-paper-100">
                  <div>
                    <span className="font-medium text-ink">{c.associateCode}</span>{" "}
                    <span className="text-ink">· {c.fullName}</span>
                    <div className="text-[11px] text-muted-2">{humanize(c.designation)}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </Card>

      {subjectId && !lookup && (
        <Card className="mt-6 px-5 py-12 text-center text-[13px] text-muted">{t("overview.subjectNotFound")}</Card>
      )}

      {lookup && (
        <>
          <Card className="mt-6 bg-ink p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-[19px] text-white">{lookup.subject.fullName}</span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">{lookup.subject.associateCode}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-white/70">
                  {humanize(lookup.subject.designation)}{lookup.subject.teamName ? ` · ${lookup.subject.teamName}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={qs({ period: "month" })} className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${period === "month" ? "bg-white text-ink" : "text-white/75 hover:text-white"}`}>
                  {t("overview.thisMonth")}
                </Link>
                <Link href={qs({ period: "year" })} className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${period === "year" ? "bg-white text-ink" : "text-white/75 hover:text-white"}`}>
                  {t("overview.thisYear")}
                </Link>
              </div>
            </div>
          </Card>

          <Card className="mt-6 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-[17px] text-ink">{t("overview.downlineHeading")}</h2>
              <span className="text-[11.5px] text-muted-2">{periodLabel}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className={TABLE_HEAD_ROW_CLS}>
                    <th className={`px-4 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colLevel")}</th>
                    <th className={`px-4 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colId")}</th>
                    <th className={`px-4 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colAssociate")}</th>
                    <th className={`px-4 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colDesignation")}</th>
                    <th className={`px-4 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colUpline")}</th>
                    <th className={`px-4 py-3 text-right font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colClosed")}</th>
                    <th className={`px-4 py-3 text-right font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colPending")}</th>
                    <th className={`px-4 py-3 text-right font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colRejected")}</th>
                    <th className={`px-4 py-3 text-right font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colCommission")}</th>
                    <th className={`px-4 py-3 text-right font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("overview.colTarget")}</th>
                    <th className={`px-4 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b-2 border-action-100 bg-action-50">
                    <td className="px-4 py-3 text-muted-2">—</td>
                    <td className="px-4 py-3 font-medium text-ink">{lookup.subject.associateCode}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-ink">{lookup.subject.fullName}</span>
                      <span className="ml-2 rounded-full bg-action px-2 py-0.5 text-[10px] font-bold text-white">{t("overview.subjectTag")}</span>
                    </td>
                    <td className="px-4 py-3 text-body">{humanize(lookup.subject.designation)}</td>
                    <td className="px-4 py-3 text-muted-2">—</td>
                    <td className="px-4 py-3 text-right font-medium text-ink">{money(lookup.subject.closed)}</td>
                    <td className="px-4 py-3 text-right text-gold">{money(lookup.subject.pending)}</td>
                    <td className="px-4 py-3 text-right text-danger">{money(lookup.subject.rejected)}</td>
                    <td className="px-4 py-3 text-right font-medium text-ink">{money(lookup.subject.commission)}</td>
                    <td className="px-4 py-3 text-right text-ink">{targetCell(lookup.subject.target)}</td>
                    <td className="px-4 py-3"><StatusPill status="Active" /></td>
                  </tr>
                  {lookup.rows.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">{t("overview.noDownline")}</td></tr>
                  ) : (
                    lookup.rows.map((r) => (
                      <tr key={r.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                        <td className="px-4 py-3 text-muted-2">L{r.level}</td>
                        <td className="px-4 py-3 font-medium text-ink">{r.associateCode}</td>
                        <td className="px-4 py-3 text-ink" style={{ paddingLeft: `${16 + (r.level - 1) * 18}px` }}>{r.fullName}</td>
                        <td className="px-4 py-3 text-body">{humanize(r.designation)}</td>
                        <td className="px-4 py-3 text-muted-2">{r.uplineCode ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-ink">{money(r.closed)}</td>
                        <td className="px-4 py-3 text-right text-gold">{money(r.pending)}</td>
                        <td className="px-4 py-3 text-right text-danger">{money(r.rejected)}</td>
                        <td className="px-4 py-3 text-right text-ink">{money(r.commission)}</td>
                        <td className="px-4 py-3 text-right text-ink">{targetCell(r.target)}</td>
                        <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-5 py-3 text-[11.5px] text-muted-2">{t("overview.dashHint")}</div>
          </Card>
        </>
      )}
    </>
  );
}
