const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

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
