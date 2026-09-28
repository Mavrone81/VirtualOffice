import type { VerifyGateResult } from "@/server/sales/actions";

export type ChecklistState = { gates: VerifyGateResult[]; allPass: boolean; contentVersion: number };
type ChecklistLoad = { ok: true; gates: VerifyGateResult[]; allPass: boolean; contentVersion: number } | { ok: false; error: string };

/** Screen 4's Verify button is enabled ONLY when the checklist the server
 * computed says allPass — never re-derived here (ADR-0001 §7's "one read
 * rule per entity": this panel renders what verifySale/getVerifyChecklist
 * already decided, it doesn't re-check gate logic itself). */
export function canConfirmVerify(checklist: ChecklistState | null, pending: boolean): boolean {
  return !!checklist && checklist.allPass && !pending;
}

/**
 * After verifySale refuses (e.g. G4: someone else edited the sale between
 * load and confirm), the panel reloads the checklist so the screen reflects
 * the CURRENT state before another attempt — never re-offer Verify against
 * stale data. If that reload ALSO fails (e.g. the admin's session expired
 * mid-flow), the stale checklist is discarded rather than left showing: an
 * old allPass:true next to a fresh error would let the admin retry blind
 * against data the panel can no longer vouch for.
 */
export function nextStateAfterVerifyRefusal(
  refusalError: string | undefined,
  reload: ChecklistLoad,
): { checklist: ChecklistState | null; error: string | null } {
  if (reload.ok) {
    return { checklist: { gates: reload.gates, allPass: reload.allPass, contentVersion: reload.contentVersion }, error: refusalError ?? null };
  }
  return { checklist: null, error: refusalError ?? reload.error };
}
