// Pure aggregation for the /admin/uat dashboard. Keeps the DB-read layer thin
// and the roll-up logic unit-tested.

export type UatStatusStr = "Untested" | "Pass" | "Fail" | "Blocked";
export type UatRow = { caseId: string; testerName: string; status: UatStatusStr };

export type TesterProgress = {
  tester: string;
  pass: number;
  fail: number;
  blocked: number;
  done: number;
  untested: number;
  pct: number;
};

export type UatSummary = {
  testers: TesterProgress[];
  overall: { pass: number; fail: number; blocked: number; recorded: number; testerCount: number };
};

export function summarizeUat(rows: UatRow[], total: number): UatSummary {
  const byTester = new Map<string, { pass: number; fail: number; blocked: number }>();
  let pass = 0, fail = 0, blocked = 0;

  for (const r of rows) {
    const t = byTester.get(r.testerName) ?? { pass: 0, fail: 0, blocked: 0 };
    if (r.status === "Pass") { t.pass++; pass++; }
    else if (r.status === "Fail") { t.fail++; fail++; }
    else if (r.status === "Blocked") { t.blocked++; blocked++; }
    byTester.set(r.testerName, t);
  }

  const testers: TesterProgress[] = [...byTester.entries()]
    .map(([tester, c]) => {
      const done = c.pass + c.fail + c.blocked;
      return {
        tester,
        pass: c.pass,
        fail: c.fail,
        blocked: c.blocked,
        done,
        untested: Math.max(0, total - done),
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.tester.localeCompare(b.tester));

  return {
    testers,
    overall: { pass, fail, blocked, recorded: pass + fail + blocked, testerCount: byTester.size },
  };
}
