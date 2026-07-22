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

  // Approval follows the team (16-Jul §7): a member's split-approver + Tier-1
  // commission override is the team Director, so sync their direct upline to the
  // Director. Skip if the team has no director or the member IS the director.
  const team = await prisma.team.findUnique({ where: { id: input.teamId }, select: { directorId: true } });
  if (team?.directorId && team.directorId !== input.associateId) {
    await prisma.associate.update({ where: { id: input.associateId }, data: { directUplineId: team.directorId } });
    await logAudit({ action: "associate.upline.team_synced", entityType: "Associate", entityId: input.associateId, actorUserId: session.user.id, after: { directUplineId: team.directorId } });
    revalidatePath("/admin/associates");
  }
  revalidatePath("/admin/teams");
  return { ok: true };
}

/**
 * Change a team's leader/director (Issues v1.0 — Teams). Admin only. Re-syncs
 * every current member's direct upline to the new Director (approval follows the
 * team) so split-approval + Tier-1 overrides track the new leader. Pass null to
 * clear the director.
 */
export async function setTeamDirector(input: { teamId: string; directorId: string | null }): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireBusinessAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const team = await prisma.team.findUnique({ where: { id: input.teamId }, include: { members: { select: { associateId: true } } } });
  if (!team) return { ok: false, error: t("notFound") };

  const directorId = input.directorId || null;
  await prisma.team.update({ where: { id: input.teamId }, data: { directorId } });

  if (directorId) {
    const memberIds = team.members.map((m) => m.associateId).filter((id) => id !== directorId);
    if (memberIds.length) {
      await prisma.associate.updateMany({ where: { id: { in: memberIds } }, data: { directUplineId: directorId } });
    }
  }
  await logAudit({ action: "team.director_changed", entityType: "Team", entityId: input.teamId, actorUserId: session.user.id, after: { directorId } });
  revalidatePath("/admin/teams");
  revalidatePath("/admin/associates");
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
