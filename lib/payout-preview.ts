import { sum } from "@/lib/money";

/** Mirrors previewPayoutRun's row shape (server/payouts/actions.ts) without importing the server module into a client component. */
export type PreviewPlanRow = {
  associateId: string;
  associateName: string;
  newLines: number;
  releasedLines: number;
  net: string;
  attach: boolean;
  policy: string;
  note?: string;
  isLeaver: boolean;
};

export type ClassifiedPreview = {
  /** attach: true AND net > 0 — this run actually pays them. */
  willBePaid: PreviewPlanRow[];
  /**
   * attach: true AND net <= 0 — the `hold` policy's fallback: attached to a
   * Pending payout but never approved, so no money moves this run either
   * (DevLead review U1). Distinct from `willBePaid`, and never counted in
   * the headline/button total or count.
   */
  held: PreviewPlanRow[];
  /** attach: false, not a leaver — an ordinary carry-forward. */
  carriedForward: PreviewPlanRow[];
  /** attach: false AND isLeaver — Screen 4's distinct "needs attention" flag, not shown as an ordinary carry. */
  leaverFlags: PreviewPlanRow[];
  /** Headline "this run will pay out {amount} to {count} associates" — willBePaid rows only. */
  total: ReturnType<typeof sum>;
  count: number;
};

/**
 * B/M5-CF Screen 1's sectioning: "Will be paid" / "Held" / "Carried forward"
 * / "Needs attention — leavers". Every row lands in exactly one section.
 * `attach: true` alone isn't "will be paid": under the `hold` policy (today's
 * PROD DEFAULT) a non-positive net still attaches to a Pending payout but is
 * never approved, so no money actually moves — that's `held`, and a negative
 * net there must never lower the paid-out total (DevLead review U1: check
 * the net's sign, not just the note string, since it's the real invariant).
 */
export function classifyPreviewPlans(plans: PreviewPlanRow[]): ClassifiedPreview {
  const attached = plans.filter((p) => p.attach);
  const willBePaid = attached.filter((p) => Number(p.net) > 0);
  const held = attached.filter((p) => Number(p.net) <= 0);
  const notAttached = plans.filter((p) => !p.attach);
  const leaverFlags = notAttached.filter((p) => p.isLeaver);
  const carriedForward = notAttached.filter((p) => !p.isLeaver);
  const total = sum(willBePaid.map((p) => p.net));
  return { willBePaid, held, carriedForward, leaverFlags, total, count: willBePaid.length };
}
