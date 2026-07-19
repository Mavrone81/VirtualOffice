"use client";

import { useEffect, useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import type { UatSection } from "@/lib/uat-cases";
import { UAT_TOTAL } from "@/lib/uat-cases";
import { setUatResult, getUatResults } from "@/server/uat/actions";

type Res = { status: string; notes: string | null };
const STATUSES: { key: string; label: string; on: string; off: string }[] = [
  { key: "Pass", label: "Pass", on: "bg-success-50 border-success text-success", off: "" },
  { key: "Fail", label: "Fail", on: "bg-danger text-white border-danger", off: "" },
  { key: "Blocked", label: "Block", on: "bg-action text-white border-action", off: "" },
];

export function UatRunner({ sections, defaultTester }: { sections: UatSection[]; defaultTester: string }) {
  const [draft, setDraft] = useState(defaultTester);
  const [tester, setTester] = useState(defaultTester);
  const [results, setResults] = useState<Record<string, Res>>({});
  const [, start] = useTransition();

  useEffect(() => {
    const s = localStorage.getItem("vo-uat-tester");
    if (s) { setDraft(s); setTester(s); }
  }, []);

  useEffect(() => {
    if (!tester) { setResults({}); return; }
    let alive = true;
    getUatResults(tester).then((r) => { if (alive) setResults(r); });
    return () => { alive = false; };
  }, [tester]);

  const commitTester = () => {
    const n = draft.trim();
    setTester(n);
    if (n) localStorage.setItem("vo-uat-tester", n);
  };

  const persist = (caseId: string, next: Res) => {
    setResults((p) => ({ ...p, [caseId]: next }));
    if (tester) start(() => { setUatResult({ caseId, testerName: tester, status: next.status, notes: next.notes ?? undefined }); });
  };
  const setStatus = (caseId: string, status: string) => {
    const cur = results[caseId] ?? { status: "Untested", notes: null };
    persist(caseId, { ...cur, status: cur.status === status ? "Untested" : status });
  };
  const setNote = (caseId: string, notes: string) => {
    const cur = results[caseId] ?? { status: "Untested", notes: null };
    persist(caseId, { ...cur, notes });
  };

  const counts = Object.values(results).reduce(
    (a, r) => { if (r.status === "Pass") a.pass++; else if (r.status === "Fail") a.fail++; else if (r.status === "Blocked") a.block++; return a; },
    { pass: 0, fail: 0, block: 0 },
  );
  const done = counts.pass + counts.fail + counts.block;
  const pct = UAT_TOTAL ? Math.round((done / UAT_TOTAL) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-action">✦ Enshrine VirtualOffice</div>
      <h1 className="font-display text-[30px] text-ink">Acceptance testing</h1>
      <p className="mt-1 text-[14px] text-muted">
        Build <code className="rounded bg-paper-200 px-1.5 py-0.5 text-[12px]">main · aafae85</code>. Record what you see — your results save to the platform and the team tracks them in Admin → UAT.
      </p>

      {/* Tester + progress */}
      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-[13px] text-muted">
            <span className="mb-1 block">Your name (used to group your results)</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTester}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="e.g. Angeline"
              className="h-11 w-64 rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
            />
          </label>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="font-display text-[26px] leading-none text-ink">{pct}%</div>
              <div className="text-[11px] text-muted">{done}/{UAT_TOTAL} done</div>
            </div>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-action transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <span className="rounded-full border border-success/40 bg-success-50 px-3 py-1 font-medium text-success">Pass {counts.pass}</span>
          <span className="rounded-full border border-danger/40 bg-danger-50 px-3 py-1 font-medium text-danger">Fail {counts.fail}</span>
          <span className="rounded-full border border-line bg-paper-100 px-3 py-1 font-medium text-muted">Blocked {counts.block}</span>
          <span className="rounded-full border border-line bg-paper-100 px-3 py-1 font-medium text-muted">Left {UAT_TOTAL - done}</span>
        </div>
        {!tester && <p className="mt-3 text-[12px] text-danger">Enter your name above before recording results.</p>}
      </Card>

      {/* Sections */}
      {sections.map((s) => (
        <section key={s.idx} className="mt-8">
          <div className="flex items-baseline gap-3 border-b border-line pb-2">
            <span className="font-mono text-[12px] font-semibold text-action">{s.idx}</span>
            <h2 className="flex-1 font-display text-[19px] text-ink">{s.title}</h2>
            <span className="rounded-md bg-action-50 px-2 py-0.5 text-[11px] font-medium text-action">{s.tag}</span>
          </div>
          {s.note && <p className="mt-3 rounded-lg border border-action-50 bg-action-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-action">{s.note}</p>}

          <div className="mt-3 flex flex-col gap-2.5">
            {s.cases.map((c) => {
              const r = results[c.id] ?? { status: "Untested", notes: null };
              const stripe = r.status === "Pass" ? "border-l-success" : r.status === "Fail" ? "border-l-danger" : r.status === "Blocked" ? "border-l-action" : "border-l-line";
              return (
                <div key={c.id} className={`rounded-xl border border-line border-l-4 ${stripe} bg-white p-4 shadow-sm`}>
                  <div className="flex flex-wrap items-start gap-2.5">
                    <span className="rounded-md bg-paper-100 px-2 py-1 font-mono text-[12px] font-semibold text-action">TC-{c.id}</span>
                    <span className="rounded-md border border-line bg-paper-100 px-2 py-1 text-[10.5px] font-bold uppercase tracking-wide text-muted">{c.who}</span>
                    <div className="min-w-[240px] flex-1">
                      <div className="text-[14px] font-medium text-ink">{c.action}</div>
                      <div className="mt-0.5 text-[13px] text-muted"><span className="font-semibold text-ink">Expect:</span> {c.expect}</div>
                    </div>
                    <div className="ml-auto flex gap-1.5">
                      {STATUSES.map((st) => (
                        <button
                          key={st.key}
                          type="button"
                          disabled={!tester}
                          aria-pressed={r.status === st.key}
                          onClick={() => setStatus(c.id, st.key)}
                          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-40 ${r.status === st.key ? st.on : "border-line bg-white text-muted hover:border-action"}`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(r.status === "Fail" || r.status === "Blocked" || r.notes) && (
                    <input
                      defaultValue={r.notes ?? ""}
                      onBlur={(e) => setNote(c.id, e.target.value)}
                      placeholder="Notes — what you saw, screenshot reference…"
                      disabled={!tester}
                      className="mt-3 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-[13px] text-ink focus:border-action focus:outline-none"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="mt-10 border-t border-line pt-4 text-[12px] text-muted">
        Results are saved to the platform as you go. The team reviews them in <span className="font-medium text-ink">Admin → UAT results</span>.
      </p>
    </div>
  );
}
