// The Closed/Pending predicate, as a pure function over plain rows — no
// Prisma, no Postgres. There are exactly two booking paths in this codebase
// and they mark a booked sale in DIFFERENT fields:
//   closeSale (flow=Legacy)      sets closedAt, never touches status
//   verifySale (flow=ClosedDeal) sets status=Verified, never touches closedAt
// A predicate keyed on status alone is correct for ClosedDeal rows and wrong
// for Legacy ones — this file proves the fixed predicate handles both, and
// is written so it can be run with no database at all.
import { describe, it, expect } from "vitest";
import { SubmissionStatus } from "@prisma/client";
import { isClosedSubmission, isPendingSubmission } from "./downline-lookup";

type Row = { status: SubmissionStatus; closedAt: Date | null };

const LEGACY_CLOSED: Row = { status: SubmissionStatus.Submitted, closedAt: new Date("2026-06-01") };
const CLOSEDDEAL_CLOSED: Row = { status: SubmissionStatus.Verified, closedAt: null };
const GENUINELY_PENDING: Row = { status: SubmissionStatus.Submitted, closedAt: null };
const GENUINELY_PENDING_QUOTED: Row = { status: SubmissionStatus.QuotationApproved, closedAt: null };
const REJECTED: Row = { status: SubmissionStatus.Rejected, closedAt: null };

describe("isClosedSubmission — the Legacy booking path (closeSale sets closedAt, never status)", () => {
  // THE CASE THIS WHOLE FIX IS FOR. Must be watched failing against the
  // pre-fix predicate above (status === Verified only) before the fix lands.
  it("a Legacy row that closed through closeSale (closedAt set, status still Submitted) IS closed", () => {
    expect(isClosedSubmission(LEGACY_CLOSED)).toBe(true);
  });

  it("a ClosedDeal row that closed through verifySale (status Verified, closedAt null) IS closed", () => {
    expect(isClosedSubmission(CLOSEDDEAL_CLOSED)).toBe(true);
  });

  it("a genuinely open row (neither closedAt nor Verified) is NOT closed", () => {
    expect(isClosedSubmission(GENUINELY_PENDING)).toBe(false);
    expect(isClosedSubmission(GENUINELY_PENDING_QUOTED)).toBe(false);
  });

  it("a rejected row with no closedAt is NOT closed", () => {
    expect(isClosedSubmission(REJECTED)).toBe(false);
  });
});

describe("isPendingSubmission — never true for a row isClosedSubmission already counted", () => {
  it("the Legacy-closed row is NOT pending (it must not be double-counted as both)", () => {
    expect(isPendingSubmission(LEGACY_CLOSED)).toBe(false);
  });

  it("the ClosedDeal-closed row is NOT pending", () => {
    expect(isPendingSubmission(CLOSEDDEAL_CLOSED)).toBe(false);
  });

  it("a genuinely open row IS pending, whether Submitted or QuotationApproved", () => {
    expect(isPendingSubmission(GENUINELY_PENDING)).toBe(true);
    expect(isPendingSubmission(GENUINELY_PENDING_QUOTED)).toBe(true);
  });

  it("a rejected row is NEVER pending, even with no closedAt", () => {
    expect(isPendingSubmission(REJECTED)).toBe(false);
  });

  // CONTROL: isClosedSubmission and isPendingSubmission must never both be
  // true for the same row (a sale double-counted in two columns at once).
  // This assertion examines all 5 fixture rows declared above, one at a time.
  it("CONTROL — closed and pending are mutually exclusive on every fixture row", () => {
    const rows = [LEGACY_CLOSED, CLOSEDDEAL_CLOSED, GENUINELY_PENDING, GENUINELY_PENDING_QUOTED, REJECTED];
    for (const r of rows) expect(isClosedSubmission(r) && isPendingSubmission(r)).toBe(false);
  });
});
