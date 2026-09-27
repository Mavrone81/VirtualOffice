"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { validate } from "@/lib/validate";
import { nameCardSchema, NAME_CARD_CHINESE_NAME_MAX, NAME_CARD_CUSTOM_TITLE_MAX } from "@/lib/schemas";

type CardData = { chineseName?: string | null; customTitle?: string | null };
type CardSnapshot = { chineseName: string | null; customTitle: string | null };

/**
 * A specific tooLong error per field (UIUX review) instead of the generic
 * invalidInput the shared validate() helper would give — checked ahead of it
 * since it's the only way either field can actually fail this schema.
 */
function lengthError(input: { chineseName?: string; customTitle?: string }): { key: "chineseNameTooLong" | "customTitleTooLong"; max: number } | null {
  if (input.chineseName !== undefined && input.chineseName.trim().length > NAME_CARD_CHINESE_NAME_MAX) {
    return { key: "chineseNameTooLong", max: NAME_CARD_CHINESE_NAME_MAX };
  }
  if (input.customTitle !== undefined && input.customTitle.trim().length > NAME_CARD_CUSTOM_TITLE_MAX) {
    return { key: "customTitleTooLong", max: NAME_CARD_CUSTOM_TITLE_MAX };
  }
  return null;
}

async function readCard(userId: string): Promise<CardSnapshot> {
  const existing = await prisma.nameCard.findFirst({ where: { userId }, select: { chineseName: true, customTitle: true } });
  return existing ?? { chineseName: null, customTitle: null };
}

async function upsertCard(userId: string, data: CardData) {
  const existing = await prisma.nameCard.findFirst({ where: { userId }, select: { id: true } });
  if (existing) await prisma.nameCard.update({ where: { id: existing.id }, data });
  else await prisma.nameCard.create({ data: { userId, ...data } });
}

/**
 * Update the signed-in user's own name card. Only fields that are provided are
 * changed. Everyone may set their own Chinese name; the card TITLE is
 * admin-only (docs/05_RBAC.md §3 "manage_others_name_card" also covers an
 * admin's own title override) even when editing your OWN card, so this is
 * enforced here — not left to the UI, which simply doesn't render the field
 * for a non-admin (a direct call would otherwise bypass that).
 */
export async function updateNameCard(input: { chineseName?: string; customTitle?: string }): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("notSignedIn") };

  if (input.customTitle !== undefined && !can(session.user.role, "manage_others_name_card")) {
    return { ok: false, error: t("forbidden") };
  }
  const lenErr = lengthError(input);
  if (lenErr) return { ok: false, error: t(lenErr.key, { max: lenErr.max }) };
  const v = validate(nameCardSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };

  const data: CardData = {};
  if (v.data.chineseName !== undefined) data.chineseName = v.data.chineseName || null;
  if (v.data.customTitle !== undefined) data.customTitle = v.data.customTitle || null;

  await upsertCard(session.user.id, data);
  revalidatePath("/portal/name-card");
  revalidatePath("/admin/name-card");
  return { ok: true };
}

/**
 * Admin-only: edit ANY associate's name card (B-8, the project owner 2026-09-26 — the
 * login-page card is unchanged, this only covers portal/admin name cards).
 * Every edit is audited with who (actorUserId), whose card (associateId +
 * associateCode), and the before/after field values.
 */
export async function updateAssociateNameCard(
  associateId: string,
  input: { chineseName?: string; customTitle?: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !can(session.user.role, "manage_others_name_card")) return { ok: false, error: t("forbidden") };

  const assoc = await prisma.associate.findUnique({
    where: { id: associateId },
    select: { associateCode: true, user: { select: { id: true } } },
  });
  if (!assoc?.user) return { ok: false, error: t("associateNoLogin") };
  const lenErr = lengthError(input);
  if (lenErr) return { ok: false, error: t(lenErr.key, { max: lenErr.max }) };
  const v = validate(nameCardSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };

  const before = await readCard(assoc.user.id);
  const data: CardData = {};
  if (v.data.chineseName !== undefined) data.chineseName = v.data.chineseName || null;
  if (v.data.customTitle !== undefined) data.customTitle = v.data.customTitle || null;

  await upsertCard(assoc.user.id, data);

  const whoseCard = { associateId, associateCode: assoc.associateCode };
  await logAudit({
    action: "name_card.updated_by_admin",
    entityType: "NameCard",
    // Keyed by associateId (stable across the card being created/recreated),
    // not the NameCard row's own id, so a lookup for "this associate's card
    // history" doesn't miss the very first edit (before any card row exists).
    entityId: associateId,
    actorUserId: session.user.id,
    before: { ...whoseCard, chineseName: before.chineseName, customTitle: before.customTitle },
    after: {
      ...whoseCard,
      chineseName: data.chineseName !== undefined ? data.chineseName : before.chineseName,
      customTitle: data.customTitle !== undefined ? data.customTitle : before.customTitle,
    },
  });

  revalidatePath(`/admin/associates/${associateId}`);
  revalidatePath("/admin/name-card");
  return { ok: true };
}
