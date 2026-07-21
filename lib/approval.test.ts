import { describe, it, expect } from "vitest";
import { Designation } from "@prisma/client";
import { isSdApproved, sdApproverId, pendingSdApproval } from "./approval";

const now = new Date("2026-07-18T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const SD = { designation: Designation.SalesDirector };
const SM = { designation: Designation.SalesManager };

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

// The SD approver is the nearest SD in the chain: direct upline (2-level SD→SA)
// or second upline (3-level SD→SM→SA), else none.
describe("sdApproverId", () => {
  it("returns the DIRECT upline when the associate reports straight to an SD (2-level)", () => {
    expect(sdApproverId({ directUplineId: "sd1", directUpline: SD, secondUplineId: null, secondUpline: null })).toBe("sd1");
  });
  it("returns the SECOND upline in a 3-level SD→SM→SA chain", () => {
    expect(sdApproverId({ directUplineId: "sm1", directUpline: SM, secondUplineId: "sd1", secondUpline: SD })).toBe("sd1");
  });
  it("prefers the direct upline when both direct and second are SDs", () => {
    expect(sdApproverId({ directUplineId: "sd1", directUpline: SD, secondUplineId: "sd2", secondUpline: SD })).toBe("sd1");
  });
  it("returns null when no SD sits above the closer (SD at top of chain)", () => {
    expect(sdApproverId({ directUplineId: null, directUpline: null, secondUplineId: null, secondUpline: null })).toBeNull();
  });
  it("returns null when the only uplines are non-SD", () => {
    expect(sdApproverId({ directUplineId: "sm1", directUpline: SM, secondUplineId: null, secondUpline: null })).toBeNull();
  });
});

describe("pendingSdApproval", () => {
  const twoLevel = { directUplineId: "sd1", directUpline: SD, secondUplineId: null, secondUpline: null };
  const noSd = { directUplineId: null, directUpline: null, secondUplineId: null, secondUpline: null };

  it("is pending for a fresh submission with an SD approver in the chain", () => {
    expect(pendingSdApproval({ sdApprovedAt: null, createdAt: daysAgo(1) }, twoLevel, now)).toBe(true);
  });
  it("is NOT pending once the SD has approved", () => {
    expect(pendingSdApproval({ sdApprovedAt: daysAgo(1), createdAt: daysAgo(2) }, twoLevel, now)).toBe(false);
  });
  it("is NOT pending after the 3-day auto-approve", () => {
    expect(pendingSdApproval({ sdApprovedAt: null, createdAt: daysAgo(3) }, twoLevel, now)).toBe(false);
  });
  it("is NEVER pending when there is no SD approver in the chain", () => {
    expect(pendingSdApproval({ sdApprovedAt: null, createdAt: daysAgo(1) }, noSd, now)).toBe(false);
  });
});
