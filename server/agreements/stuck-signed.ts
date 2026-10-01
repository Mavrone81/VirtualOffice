"use server";

import { auth } from "@/auth";
import { isFullAdmin } from "@/lib/rbac";
import { getTranslations } from "next-intl/server";
import { runStuckSignedCheck, type StuckSignedAgreement } from "@/server/agreements/stuck-signed-reconciler";

export type { StuckSignedAgreement };

/** Business-Admin-only: an immediate check, skipping the opportunistic
 *  trigger's cooldown — for a dashboard "Check now" button. Read-only; the
 *  only write is the one audit entry runStuckSignedCheck itself makes. */
export async function stuckSignedCheckNow(): Promise<{ ok: boolean; error?: string; stuck?: StuckSignedAgreement[] }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return { ok: false, error: t("forbidden") };
  const r = await runStuckSignedCheck({ trigger: "manual", actorUserId: session.user.id, skipCooldown: true });
  return { ok: true, stuck: r.stuck };
}
