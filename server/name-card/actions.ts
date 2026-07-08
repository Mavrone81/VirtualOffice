"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

type CardData = { chineseName?: string | null; customTitle?: string | null };

async function upsertCard(userId: string, data: CardData) {
  const existing = await prisma.nameCard.findFirst({ where: { userId }, select: { id: true } });
  if (existing) await prisma.nameCard.update({ where: { id: existing.id }, data });
  else await prisma.nameCard.create({ data: { userId, ...data } });
}

/**
 * Update the signed-in user's own name card. Only fields that are provided are
 * changed — associates edit their Chinese name; the card title is admin-only
 * (omitted here) except when an admin edits their own card.
 */
export async function updateNameCard(input: { chineseName?: string; customTitle?: string }): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("notSignedIn") };

  const data: CardData = {};
  if (input.chineseName !== undefined) data.chineseName = input.chineseName.trim() || null;
  if (input.customTitle !== undefined) data.customTitle = input.customTitle.trim() || null;

  await upsertCard(session.user.id, data);
  revalidatePath("/portal/name-card");
  revalidatePath("/admin/name-card");
  return { ok: true };
}

/** Admin-only: set the card title on another associate's name card (managing others' cards — docs/05_RBAC.md §3). */
export async function setAssociateCardTitle(associateId: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !can(session.user.role, "manage_others_name_card")) return { ok: false, error: t("forbidden") };

  const assoc = await prisma.associate.findUnique({ where: { id: associateId }, include: { user: { select: { id: true } } } });
  if (!assoc?.user) return { ok: false, error: t("associateNoLogin") };

  await upsertCard(assoc.user.id, { customTitle: title.trim() || null });
  revalidatePath(`/admin/associates/${associateId}`);
  return { ok: true };
}
