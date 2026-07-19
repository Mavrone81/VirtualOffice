import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { UAT_SECTIONS, UAT_TOTAL } from "@/lib/uat-cases";
import { summarizeUat, type UatRow } from "@/lib/uat-summary";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";

export const dynamic = "force-dynamic";
export const metadata = { title: "UAT results · Enshrine Admin" };

const caseMeta = new Map(UAT_SECTIONS.flatMap((s) => s.cases.map((c) => [c.id, { action: c.action, section: `${s.idx} ${s.title}` }])));

export default async function AdminUatPage() {
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");

  const rows = await prisma.uatResult.findMany({ orderBy: [{ testerName: "asc" }, { updatedAt: "desc" }] });
  const summary = summarizeUat(rows as unknown as UatRow[], UAT_TOTAL);
  const problems = rows.filter((r) => r.status === "Fail" || r.status === "Blocked");

  return (
    <>
      <PageHeader title="UAT results" subtitle={`Acceptance testing · build main · aafae85 · ${UAT_TOTAL} cases`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Testers" value={summary.overall.testerCount} sub="have recorded results" />
        <StatTile label="Passed" value={summary.overall.pass} sub="across all testers" />
        <StatTile label="Failed" value={summary.overall.fail} sub="need attention" />
        <StatTile label="Blocked" value={summary.overall.blocked} sub="cannot proceed" />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">Per-tester progress</h2>
        </div>
        {summary.testers.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">No results recorded yet. Testers record at <span className="font-medium text-ink">/uat</span>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Tester</th>
                  <th className="px-5 py-3 font-medium text-right">Pass</th>
                  <th className="px-5 py-3 font-medium text-right">Fail</th>
                  <th className="px-5 py-3 font-medium text-right">Blocked</th>
                  <th className="px-5 py-3 font-medium text-right">Left</th>
                  <th className="px-5 py-3 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {summary.testers.map((t) => (
                  <tr key={t.tester} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{t.tester}</td>
                    <td className="px-5 py-3 text-right text-success">{t.pass}</td>
                    <td className="px-5 py-3 text-right text-danger">{t.fail}</td>
                    <td className="px-5 py-3 text-right text-action">{t.blocked}</td>
                    <td className="px-5 py-3 text-right text-muted">{t.untested}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
                          <div className="h-full rounded-full bg-action" style={{ width: `${t.pct}%` }} />
                        </div>
                        <span className="text-[12px] tabular-nums text-muted">{t.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-[18px] text-ink">Failures &amp; blockers {problems.length > 0 && <span className="text-[13px] text-muted">· {problems.length}</span>}</h2>
        </div>
        {problems.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">Nothing failed or blocked. 🎉</p>
        ) : (
          <div className="divide-y divide-line-200">
            {problems.map((p) => {
              const meta = caseMeta.get(p.caseId);
              return (
                <div key={p.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-paper-100 px-2 py-1 font-mono text-[12px] font-semibold text-action">TC-{p.caseId}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${p.status === "Fail" ? "bg-danger-50 text-danger" : "bg-action-50 text-action"}`}>{p.status === "Fail" ? "FAILED" : "BLOCKED"}</span>
                    <span className="text-[12px] text-muted">{meta?.section}</span>
                    <span className="ml-auto text-[12px] font-medium text-ink">{p.testerName}</span>
                  </div>
                  <div className="mt-1.5 text-[13px] text-ink">{meta?.action}</div>
                  {p.notes && <div className="mt-1 text-[13px] text-muted"><span className="font-semibold text-ink">Note:</span> {p.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
