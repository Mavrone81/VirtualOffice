import { describe, it, expect } from "vitest";
import { canSetQuota, canOverrideQuota, inPeriod, isPeriodFor, isTargetPeriod, periodKeys, remainingToTarget, resolveTarget } from "./quota";

// 16-Jul §3: quota may be set by SAM/SM/SD/Business Admin; a Director's value
// overrides a Manager's (higher authority can overwrite, lower cannot).
describe("canSetQuota — SAM and above", () => {
  it.each([
    ["Admin", true],
    ["SalesDirector", true],
    ["SalesManager", true],
    ["SalesAssistantManager", true],
    ["SalesAssociate", false],
    ["Accounts", false],
  ] as const)("%s → %s", (role, allowed) => {
    expect(canSetQuota(role)).toBe(allowed);
  });
});

describe("canOverrideQuota — director overrides manager", () => {
  it("a Director can override a Manager's quota", () => {
    expect(canOverrideQuota("SalesManager", "SalesDirector")).toBe(true);
  });
  it("a Manager cannot override a Director's quota", () => {
    expect(canOverrideQuota("SalesDirector", "SalesManager")).toBe(false);
  });
  it("same-tier setters can overwrite each other", () => {
    expect(canOverrideQuota("SalesManager", "SalesManager")).toBe(true);
  });
  it("a Manager overrides an Assistant Manager", () => {
    expect(canOverrideQuota("SalesAssistantManager", "SalesManager")).toBe(true);
  });
  it("Business Admin can override anyone", () => {
    expect(canOverrideQuota("SalesDirector", "Admin")).toBe(true);
  });
});


describe("targets (A4)", () => {
  it("accepts monthly and yearly periods only", () => {
    expect(isTargetPeriod("2026-09")).toBe(true);
    expect(isTargetPeriod("2026")).toBe(true);
    expect(isTargetPeriod("2026-9")).toBe(false);
    expect(isTargetPeriod("26")).toBe(false);
  });
  it("derives this month's and this year's keys", () => {
    expect(periodKeys(new Date(2026, 8, 21))).toEqual({ month: "2026-09", year: "2026" });
    expect(periodKeys(new Date(2026, 0, 1))).toEqual({ month: "2026-01", year: "2026" });
  });
  it("matches payout months to a period", () => {
    expect(inPeriod("2026-09", "2026-09")).toBe(true);
    expect(inPeriod("2026-08", "2026-09")).toBe(false);
    expect(inPeriod("2026-01", "2026")).toBe(true);
    expect(inPeriod("2025-12", "2026")).toBe(false);
  });
  it("remaining = target − received, never below zero", () => {
    expect(remainingToTarget(5000, 1200)).toBe(3800);
    expect(remainingToTarget(5000, 6000)).toBe(0);
    expect(remainingToTarget(1000.1, 0.05)).toBe(1000.05);
    expect(remainingToTarget(5000, -3000)).toBe(5000); // bad data can't inflate it
  });
});

describe("resolveTarget — individual override, else team, else none", () => {
  it("team target only: returns the team figure, tagged team (1 team amount, no individual)", () => {
    expect(resolveTarget(null, ["5000.00"])).toEqual({ amount: "5000.00", source: "team" });
    expect(resolveTarget(undefined, [5000])).toEqual({ amount: "5000", source: "team" });
  });
  it("individual override present wins over the team figure (1 individual, 1 team amount)", () => {
    expect(resolveTarget("8000.00", ["5000.00"])).toEqual({ amount: "8000.00", source: "individual" });
  });
  it("an individual override LOWER than the team figure still wins (1 individual, 1 team amount)", () => {
    expect(resolveTarget("1000", ["5000"])).toEqual({ amount: "1000", source: "individual" });
  });
  it("an explicit individual 0 is a row and wins over the team figure", () => {
    expect(resolveTarget("0", ["5000"])).toEqual({ amount: "0", source: "individual" });
  });
  it("neither set: null, never a zero (0 individual, 0 team amounts)", () => {
    expect(resolveTarget(null, [])).toBeNull();
    expect(resolveTarget(undefined, [])).toBeNull();
  });
  it("several team targets: the highest applies, deterministic regardless of order (3 amounts)", () => {
    expect(resolveTarget(null, ["3000", "9000", "5000"])?.amount).toBe("9000");
    expect(resolveTarget(null, ["5000", "9000", "3000"])?.amount).toBe("9000");
  });
});

describe("isPeriodFor — the period type is explicit, the key shape must match it", () => {
  it.each([
    ["Monthly", "2026-10", true],
    ["Monthly", "2026", false],
    ["Monthly", "2026-13", false],
    ["Yearly", "2026", true],
    ["Yearly", "2026-10", false],
    ["Yearly", "", false],
  ] as const)("%s %s -> %s", (type, period, ok) => {
    expect(isPeriodFor(type, period)).toBe(ok);
  });
});
