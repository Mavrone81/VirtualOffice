import { addMonths, format } from "date-fns";

// Owner ruling 2026-10-17: the CANDIDATE now sets their own, mandatory
// Commencement Date at final onboarding submission (the inviter's own
// invite-time field becomes a non-binding suggestion only — see
// inviteCandidateSchema in lib/schemas.ts). The allowed window is today
// through 12 calendar months ahead, in the app's own day — the process TZ,
// Asia/Singapore by default, same convention as
// server/products/commission-edit.ts's earliestRateChangeDate.

/** Inclusive yyyy-mm-dd bounds a candidate's own Commencement Date may fall in. */
export function commencementDateBounds(now: Date = new Date()): { min: string; max: string } {
  return { min: format(now, "yyyy-MM-dd"), max: format(addMonths(now, 12), "yyyy-MM-dd") };
}

/** `v` must already be a yyyy-mm-dd string (format is checked separately —
 *  this only tests the range, by plain string comparison, which is safe
 *  because yyyy-mm-dd sorts lexicographically the same as chronologically). */
export function isWithinCommencementDateRange(v: string, now: Date = new Date()): boolean {
  const { min, max } = commencementDateBounds(now);
  return v >= min && v <= max;
}
