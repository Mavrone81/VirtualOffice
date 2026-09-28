"use server";

import { auth } from "@/auth";
import { isFullAdmin } from "@/lib/rbac";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { previewNricRetention, runNricRetention, type NricRetentionCounts } from "@/server/agreements/nric-retention-engine";

export type { NricRetentionCounts };

/** Business-Admin-only manual panel: Preview (dry run) — counts only, no writes,
 *  never gated by NRIC_RETENTION_ENABLED. */
export async function nricRetentionPreview(): Promise<{ ok: boolean; error?: string; counts?: NricRetentionCounts }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return { ok: false, error: t("forbidden") };
  return { ok: true, counts: await previewNricRetention() };
}

/** Business-Admin-only manual panel: Run now — refused while
 *  NRIC_RETENTION_ENABLED is off; otherwise the same lock/cap as the
 *  opportunistic trigger, skipping only the 24h cooldown. */
export async function nricRetentionRunNow(): Promise<{ ok: boolean; error?: string; counts?: NricRetentionCounts }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return { ok: false, error: t("forbidden") };
  if (!env.NRIC_RETENTION_ENABLED) return { ok: false, error: t("nricRetentionDisabled") };
  const r = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: session.user.id, skipCooldown: true });
  return { ok: true, counts: r.counts };
}
