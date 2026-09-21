import { describe, it, expect } from "vitest";
import { canSetQuota, canOverrideQuota, inPeriod, isTargetPeriod, periodKeys, remainingToTarget } from "./quota";

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
