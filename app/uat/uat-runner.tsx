"use client";

import { useEffect, useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import type { UatSection } from "@/lib/uat-cases";
import { UAT_TOTAL, UAT_ACCOUNTS, UAT_PASSWORD } from "@/lib/uat-cases";
import { setUatResult, getUatResults, getUatTesters } from "@/server/uat/actions";

type Res = { status: string; notes: string | null };
const STATUS_KEYS = ["Pass", "Fail", "Blocked"] as const;
const STATUS_LABEL: Record<string, string> = { Pass: "Pass", Fail: "Fail", Blocked: "Block" };
const STATUS_ON: Record<string, string> = {
  Pass: "bg-success-50 border-success text-success",
  Fail: "bg-danger text-white border-danger",
  Blocked: "bg-action text-white border-action",
};

export function UatRunner({ sections, defaultTester }: { sections: UatSection[]; defaultTester: string }) {
  const [draft, setDraft] = useState(defaultTester);
  const [tester, setTester] = useState(defaultTester);
  const [results, setResults] = useState<Record<string, Res>>({});
  const [testers, setTesters] = useState<string[]>([]);
  const [isPending, start] = useTransition();
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => {
      setCopied(v);
      setTimeout(() => setCopied((c) => (c === v ? null : c)), 1200);
    }).catch(() => {});
  };

  useEffect(() => {
    const s = localStorage.getItem("vo-uat-tester");
    if (s) { setDraft(s); setTester(s); }
    getUatTesters().then(setTesters).catch(() => {});
  }, []);

  useEffect(() => {
    if (!tester) { setResults({}); return; }
    let alive = true;
    getUatResults(tester).then((r) => { if (alive) setResults(r); });
    return () => { alive = false; };
  }, [tester]);

  const commitTester = () => {
    const n = draft.trim();
    if (n === tester) return;
    setTester(n);
    setTouched(false);
    if (n) localStorage.setItem("vo-uat-tester", n);
  };

  const persist = (caseId: string, next: Res) => {
    setResults((p) => ({ ...p, [caseId]: next }));
    setTouched(true);
    if (tester) start(() => { setUatResult({ caseId, testerName: tester, status: next.status, notes: next.notes ?? undefined }); });
  };
  const setStatus = (caseId: string, status: string) => {
    const cur = results[caseId] ?? { status: "Untested", notes: null };
    persist(caseId, { ...cur, status: cur.status === status ? "Untested" : status });
  };
  const setNote = (caseId: string, notes: string) => {
    const cur = results[caseId] ?? { status: "Untested", notes: null };
    if ((cur.notes ?? "") === notes) return;
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
        Build <code className="rounded bg-paper-200 px-1.5 py-0.5 text-[12px]">main · latest</code>. Open each screen, try it, and record what you see — results save to the platform and the team tracks them in Admin → UAT.
      </p>

      {/* Tester + progress */}
      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-[13px] text-muted">
            <span className="mb-1 block">Your name — enter it to start, or type/pick a name to resume</span>
            <input
              value={draft}
              list="uat-testers"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTester}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="e.g. Angeline"
              className="h-11 w-64 rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
            />
            <datalist id="uat-testers">
              {testers.map((t) => <option key={t} value={t} />)}
            </datalist>
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="rounded-full border border-success/40 bg-success-50 px-3 py-1 font-medium text-success">Pass {counts.pass}</span>
          <span className="rounded-full border border-danger/40 bg-danger-50 px-3 py-1 font-medium text-danger">Fail {counts.fail}</span>
          <span className="rounded-full border border-line bg-paper-100 px-3 py-1 font-medium text-muted">Blocked {counts.block}</span>
          <span className="rounded-full border border-line bg-paper-100 px-3 py-1 font-medium text-muted">Left {UAT_TOTAL - done}</span>
          <span className="ml-auto text-[12px] text-muted">
            {!tester ? <span className="text-danger">Enter your name to begin.</span>
              : isPending ? "Saving…"
              : done > 0 ? `Continuing as ${tester} · ${done} recorded · saved ✓`
              : touched ? "Saved ✓" : `Ready — ${tester}`}
          </span>
        </div>
      </Card>

      {/* Test accounts — how to log in per role */}
      <details open className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-display text-[16px] text-ink">
          Test accounts
          <span className="text-[12px] font-normal text-muted">— log in with these per role · click a value to copy</span>
        </summary>
        <div className="px-5 pb-5">
          <div className="mb-3 text-[13px] text-muted">
            Log in at <a href="/login" target="_blank" rel="noopener" className="font-medium text-action hover:underline">/login</a> using the email as the username. All accounts share one password:
            <button type="button" onClick={() => copy(UAT_PASSWORD)} className="ml-1.5 rounded bg-paper-100 px-2 py-0.5 font-mono text-[12.5px] text-ink transition hover:bg-action-50">
              {UAT_PASSWORD}{copied === UAT_PASSWORD ? " ✓" : ""}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Login (email)</th>
                  <th className="py-2 font-medium">Who</th>
                </tr>
              </thead>
              <tbody>
                {UAT_ACCOUNTS.map((a) => (
                  <tr key={a.login} className="border-b border-line-200 last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{a.role}</td>
                    <td className="py-2 pr-4">
                      <button type="button" onClick={() => copy(a.login)} className="rounded bg-paper-100 px-2 py-0.5 font-mono text-[12.5px] text-ink transition hover:bg-action-50">
                        {a.login}{copied === a.login ? " ✓" : ""}
                      </button>
                    </td>
                    <td className="py-2 text-muted">{a.who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

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
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      {c.go && (
                        <a href={c.go} target="_blank" rel="noopener"
                          className="rounded-lg border border-action bg-action-50 px-3 py-1.5 text-[12.5px] font-semibold text-action transition hover:bg-action hover:text-white">
                          Open ↗
                        </a>
                      )}
                      <span className="mx-0.5 hidden h-5 w-px bg-line sm:inline-block" />
                      {STATUS_KEYS.map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!tester}
                          aria-pressed={r.status === st}
                          onClick={() => setStatus(c.id, st)}
                          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-40 ${r.status === st ? STATUS_ON[st] : "border-line bg-white text-muted hover:border-action"}`}
                        >
                          {STATUS_LABEL[st]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(r.status === "Fail" || r.status === "Blocked" || r.notes) && (
                    <input
                      key={`${tester}:${c.id}`}
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
        Results save to the platform as you go — close the tab and come back any time, enter the same name, and continue. The team reviews everything in <span className="font-medium text-ink">Admin → UAT results</span>.
      </p>
    </div>
  );
}
