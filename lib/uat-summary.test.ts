import { describe, it, expect } from "vitest";
import { summarizeUat } from "./uat-summary";

const rows = (arr: [string, string, string][]) => arr.map(([caseId, testerName, status]) => ({ caseId, testerName, status: status as never }));

describe("summarizeUat", () => {
  it("returns empty when there are no results", () => {
    const s = summarizeUat([], 10);
    expect(s.testers).toEqual([]);
    expect(s.overall).toEqual({ pass: 0, fail: 0, blocked: 0, recorded: 0, testerCount: 0 });
  });

  it("counts a single tester's run and derives untested + pct from the total", () => {
    const s = summarizeUat(rows([["1.1", "Alice", "Pass"], ["1.2", "Alice", "Fail"], ["1.3", "Alice", "Blocked"]]), 10);
    expect(s.testers).toHaveLength(1);
    expect(s.testers[0]).toMatchObject({ tester: "Alice", pass: 1, fail: 1, blocked: 1, done: 3, untested: 7, pct: 30 });
    expect(s.overall).toEqual({ pass: 1, fail: 1, blocked: 1, recorded: 3, testerCount: 1 });
  });

  it("treats an Untested-status row as not-done (no double count)", () => {
    const s = summarizeUat(rows([["1.1", "Alice", "Pass"], ["1.2", "Alice", "Untested"]]), 4);
    expect(s.testers[0]).toMatchObject({ pass: 1, done: 1, untested: 3, pct: 25 });
  });

  it("aggregates multiple testers and sorts them by name", () => {
    const s = summarizeUat(rows([["1.1", "Bob", "Pass"], ["1.1", "Alice", "Fail"], ["1.2", "Alice", "Pass"]]), 5);
    expect(s.testers.map((t) => t.tester)).toEqual(["Alice", "Bob"]);
    expect(s.overall).toEqual({ pass: 2, fail: 1, blocked: 0, recorded: 3, testerCount: 2 });
  });
});
