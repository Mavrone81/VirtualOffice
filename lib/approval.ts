import { Designation } from "@prisma/client";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

type UplineDesig = { designation: Designation } | null | undefined;

export type CloserChain = {
  directUplineId: string | null;
  directUpline?: UplineDesig;
  secondUplineId: string | null;
  secondUpline?: UplineDesig;
};

/**
 * The Sales Director who approves a submission's split (16-Jul §4). The approver
 * is the nearest SD in the closer's upline chain: the DIRECT upline when the
 * associate reports straight to an SD (2-level SD→SA — the common case in this
 * org), otherwise the SECOND upline (3-level SD→SM→SA). Returns null when no SD
 * sits above the closer (e.g. an SD closing their own sale) — there is then no
 * SD approver, so verification is not gated on one.
 *
 * The earlier code assumed the SD is always the second upline, which left every
 * sale from an associate reporting directly to an SD invisible to that SD and
 * stuck until the 3-day auto-approve.
 */
export function sdApproverId(closer: CloserChain): string | null {
  if (closer.directUpline?.designation === Designation.SalesDirector) return closer.directUplineId;
  if (closer.secondUpline?.designation === Designation.SalesDirector) return closer.secondUplineId;
  return null;
}

/**
 * Whether a submission still needs SD split approval before a Business Admin can
 * verify it. True only while an SD approver exists in the closer's chain AND
 * neither an explicit SD approval nor the 3-day auto-approve has landed. With no
 * SD above the closer there is no approver, so verification is not blocked.
 */
export function pendingSdApproval(
  sub: { sdApprovedAt: Date | null; createdAt: Date },
  closer: CloserChain,
  now: Date = new Date(),
): boolean {
  if (sdApproverId(closer) === null) return false;
  return !isSdApproved(sub, now).approved;
}

/**
 * The split director for a submission (23-Jul, issue 2): the director of the
 * earliest active team (that has a director) the closer belongs to — the "first"
 * SD when the closer is in several teams. Caller supplies the closer's teams
 * ordered by creation. Returns null when no directed team applies (callers fall
 * back to the upline SD via {@link sdApproverId}).
 */
export function pickSplitDirectorId(teams: { directorId: string | null }[]): string | null {
  for (const t of teams) if (t.directorId) return t.directorId;
  return null;
}

/**
 * Whether flow A (split) is fully approved (23-Jul parallel workflow): the SD
 * step has landed (an explicit SD approval or the 3-day auto-approve) AND a
 * Business Admin has signed off. This is the split gate a sale must clear before
 * the associate can close it.
 */
export function splitFullyApproved(
  sub: { sdApprovedAt: Date | null; createdAt: Date; splitAdminApprovedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return isSdApproved(sub, now).approved && sub.splitAdminApprovedAt !== null;
}

/**
 * Share-com split approval state (16-Jul §4). The team SD approves the split;
 * if it isn't actioned within 3 days of submission it auto-approves. `auto` is
 * true when approval came from the elapsed-time rule rather than an explicit SD
 * action (surfaced in the UI + logged as a system-actor approval).
 */
export function isSdApproved(
  sub: { sdApprovedAt: Date | null; createdAt: Date },
  now: Date = new Date(),
): { approved: boolean; auto: boolean } {
  if (sub.sdApprovedAt) return { approved: true, auto: false };
  const auto = now.getTime() - sub.createdAt.getTime() >= THREE_DAYS_MS;
  return { approved: auto, auto };
}
