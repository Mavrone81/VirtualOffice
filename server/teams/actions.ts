"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

// Team creation + membership is Business Admin only (16-Jul RBAC matrix §H).
async function requireBusinessAdmin() {
  const session = await auth();
  return session && isFullAdmin(session.user.role) ? session : null;
}

export async function createTeam(input: { name: string; directorId?: string }): Promise<{ ok: boolean; error?: string; id?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: t("teamNameRequired") };
  if (await prisma.team.findUnique({ where: { name }, select: { id: true } })) return { ok: false, error: t("teamNameTaken") };

  const team = await prisma.team.create({ data: { name, directorId: input.directorId || null } });
  await logAudit({ action: "team.created", entityType: "Team", entityId: team.id, actorUserId: session.user.id });
  revalidatePath("/admin/teams");
  return { ok: true, id: team.id };
}

export async function addTeamMember(input: { teamId: string; associateId: string }): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!input.associateId) return { ok: false, error: t("invalidInput") };

  await prisma.teamMember.upsert({
    where: { teamId_associateId: { teamId: input.teamId, associateId: input.associateId } },
    create: { teamId: input.teamId, associateId: input.associateId },
    update: {},
  });
  await logAudit({ action: "team.member_added", entityType: "Team", entityId: input.teamId, actorUserId: session.user.id });
  revalidatePath("/admin/teams");
  return { ok: true };
}

export async function removeTeamMember(input: { teamId: string; associateId: string }): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  await prisma.teamMember.deleteMany({ where: { teamId: input.teamId, associateId: input.associateId } });
  await logAudit({ action: "team.member_removed", entityType: "Team", entityId: input.teamId, actorUserId: session.user.id });
  revalidatePath("/admin/teams");
  return { ok: true };
}
