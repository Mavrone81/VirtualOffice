"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { round2 } from "@/lib/money";
import { isPeriodFor, isTargetPeriod, canOverrideQuota, type TargetPeriodKind } from "@/lib/quota";
import { logAudit } from "@/lib/audit";

// Team targets are set by the Business Admin only (the team section itself is
// Admin-only). Individual overrides for a manager's own scope stay with
// server/quota/actions.ts setQuota — an Admin cannot use that path (it
// requires an associateId, which a Business Admin need not have, and then
// scopes to team membership, which excludes Admin). setIndividualQuota below
// is the Admin-only individual-target writer, gated the same way setTeamQuota
// is: by role, not by associate scope.
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

/**
 * Admin-only individual target, on the same SalesQuota row setQuota writes
 * (associateId + month). Deliberately NOT routed through setQuota: that
 * function requires session.user.associateId (a Business Admin need not have
 * one) and then scopes the target to the setter's own team membership or
 * downline (lib/team.ts teamScopeIds), which excludes Admin by design. This
 * action mirrors setTeamQuota's gate instead — role only, no associate scope
 * — so "every team" visibility (already true for Admin on this page) extends
 * to individual targets the same way it already does to team targets.
 */
export async function setIndividualQuota(input: {
  associateId: string;
  month: string;
  amount: number;
}): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!isTargetPeriod(input.month)) return { ok: false, error: t("badMonth") };
  // No zero/negative: "no target" is the absence of a row, never a stored 0
  // (same rule as setTeamQuota, same reason).
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) {
    return { ok: false, error: t("invalidInput") };
  }
  if (!(await prisma.associate.findUnique({ where: { id: input.associateId }, select: { id: true } }))) {
    return { ok: false, error: t("notFound") };
  }

  const key = { associateId_month: { associateId: input.associateId, month: input.month } };
  const existing = await prisma.salesQuota.findUnique({ where: key });
  // Kept for audit-trail coherence, not because it can actually block an
  // Admin: quotaAuthority(Admin) is the joint-highest authority, so this
  // never rejects them — it exists so this action is never mistaken for a
  // lock bypass by a future reader.
  if (existing && !canOverrideQuota(existing.setByRole, session.user.role)) {
    return { ok: false, error: t("quotaLocked") };
  }

  const amount = round2(input.amount);
  await prisma.salesQuota.upsert({
    where: key,
    create: { associateId: input.associateId, month: input.month, amount, setByRole: session.user.role, setById: session.user.id },
    update: { amount, setByRole: session.user.role, setById: session.user.id },
  });
  await logAudit({
    action: "quota.set", entityType: "SalesQuota",
    entityId: `${input.associateId}:${input.month}`, actorUserId: session.user.id,
    before: existing ? { amount: existing.amount.toString() } : undefined, after: { amount: amount.toString() },
  });
  revalidatePath("/admin/teams");
  revalidatePath("/portal/team");
  revalidatePath("/portal/dashboard");
  return { ok: true };
}

export async function clearIndividualQuota(input: { associateId: string; month: string }): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!isTargetPeriod(input.month)) return { ok: false, error: t("badMonth") };
  const r = await prisma.salesQuota.deleteMany({ where: { associateId: input.associateId, month: input.month } });
  if (r.count > 0) {
    await logAudit({
      action: "quota.cleared", entityType: "SalesQuota",
      entityId: `${input.associateId}:${input.month}`, actorUserId: session.user.id,
    });
  }
  revalidatePath("/admin/teams");
  revalidatePath("/portal/team");
  revalidatePath("/portal/dashboard");
  return { ok: true };
}
