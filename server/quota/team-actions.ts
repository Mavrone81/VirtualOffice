"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { round2 } from "@/lib/money";
import { isPeriodFor, type TargetPeriodKind } from "@/lib/quota";
import { logAudit } from "@/lib/audit";

// Team targets are set by the Business Admin only (the team section itself is
// Admin-only). Individual overrides stay with server/quota/actions.ts setQuota.
const MAX_AMOUNT = 999_999_999_999.99; // DECIMAL(14,2)

async function requireBusinessAdmin() {
  const session = await auth();
  return session && isFullAdmin(session.user.role) ? session : null;
}

export async function setTeamQuota(input: {
  teamId: string;
  periodType: TargetPeriodKind;
  period: string;
  amount: number;
}): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!isPeriodFor(input.periodType, input.period)) return { ok: false, error: t("badMonth") };
  // No zero/negative: "no target" is the absence of a row, never a stored 0.
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) {
    return { ok: false, error: t("invalidInput") };
  }
  if (!(await prisma.team.findUnique({ where: { id: input.teamId }, select: { id: true } }))) {
    return { ok: false, error: t("notFound") };
  }

  const amount = round2(input.amount);
  const key = { teamId_periodType_period: { teamId: input.teamId, periodType: input.periodType, period: input.period } };
  const before = await prisma.teamQuota.findUnique({ where: key, select: { amount: true } });
  await prisma.teamQuota.upsert({
    where: key,
    create: { teamId: input.teamId, periodType: input.periodType, period: input.period, amount, setByRole: session.user.role, setById: session.user.id },
    update: { amount, setByRole: session.user.role, setById: session.user.id },
  });
  await logAudit({
    action: "team.quota_set", entityType: "TeamQuota",
    entityId: `${input.teamId}:${input.periodType}:${input.period}`, actorUserId: session.user.id,
    before: before ? { amount: before.amount.toString() } : undefined, after: { amount: amount.toString() },
  });
  revalidatePath("/admin/teams");
  revalidatePath("/portal/team");
  revalidatePath("/portal/dashboard");
  return { ok: true };
}

export async function clearTeamQuota(input: {
  teamId: string;
  periodType: TargetPeriodKind;
  period: string;
}): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!isPeriodFor(input.periodType, input.period)) return { ok: false, error: t("badMonth") };
  const r = await prisma.teamQuota.deleteMany({ where: { teamId: input.teamId, periodType: input.periodType, period: input.period } });
  if (r.count > 0) {
    await logAudit({
      action: "team.quota_cleared", entityType: "TeamQuota",
      entityId: `${input.teamId}:${input.periodType}:${input.period}`, actorUserId: session.user.id,
    });
  }
  revalidatePath("/admin/teams");
  revalidatePath("/portal/team");
  revalidatePath("/portal/dashboard");
  return { ok: true };
}
