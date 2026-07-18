import { describe, it, expect } from "vitest";
import { isSdApproved } from "./approval";

const now = new Date("2026-07-18T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

// 16-Jul §4: the SD approves the split; if not actioned within 3 calendar days
// it auto-approves.
describe("isSdApproved", () => {
  it("is approved (not auto) when the SD explicitly approved", () => {
    expect(isSdApproved({ sdApprovedAt: daysAgo(1), createdAt: daysAgo(2) }, now)).toEqual({ approved: true, auto: false });
  });
  it("is NOT approved before 3 days with no SD action", () => {
    expect(isSdApproved({ sdApprovedAt: null, createdAt: daysAgo(2) }, now)).toEqual({ approved: false, auto: false });
  });
  it("auto-approves at 3 days", () => {
    expect(isSdApproved({ sdApprovedAt: null, createdAt: daysAgo(3) }, now)).toEqual({ approved: true, auto: true });
  });
  it("stays auto-approved past 3 days", () => {
    expect(isSdApproved({ sdApprovedAt: null, createdAt: daysAgo(5) }, now)).toEqual({ approved: true, auto: true });
  });
});
