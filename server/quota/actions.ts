"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/money";
import { canSetQuota, canOverrideQuota } from "@/lib/quota";
import { downlineIds } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

/**
 * Set a team member's monthly sales quota (16-Jul §3). The setter must be
 * SAM+, the target must be in their downline (or self), and a lower authority
 * cannot overwrite a quota a higher one already set (director overrides manager).
 */
export async function setQuota(input: {
  associateId: string;
  month: string;
  amount: number;
}): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user.associateId || !canSetQuota(session.user.role)) return { ok: false, error: t("forbidden") };
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { ok: false, error: t("badMonth") };

  const scope = new Set([session.user.associateId, ...(await downlineIds(session.user.associateId))]);
  if (!scope.has(input.associateId)) return { ok: false, error: t("forbidden") };

  const key = { associateId_month: { associateId: input.associateId, month: input.month } };
  const existing = await prisma.salesQuota.findUnique({ where: key });
  if (existing && !canOverrideQuota(existing.setByRole, session.user.role)) {
    return { ok: false, error: t("quotaLocked") };
  }

  await prisma.salesQuota.upsert({
    where: key,
    create: {
      associateId: input.associateId, month: input.month, amount: round2(input.amount),
      setByRole: session.user.role, setById: session.user.id,
    },
    update: { amount: round2(input.amount), setByRole: session.user.role, setById: session.user.id },
  });
  await logAudit({
    action: "quota.set", entityType: "SalesQuota",
    entityId: `${input.associateId}:${input.month}`, actorUserId: session.user.id,
  });
  revalidatePath("/portal/team");
  revalidatePath("/portal/dashboard");
  return { ok: true };
}
