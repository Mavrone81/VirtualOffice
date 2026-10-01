"use server";

import { revalidatePath } from "next/cache";
import { MarketingCategory } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, isFullAdmin } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { deleteObject } from "@/lib/storage";
import { env } from "@/lib/env";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

// ADR-0002: deleting a collection is Business Admin only; archiving and
// uploading stay available to the admin area generally.
async function requireFullAdmin() {
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return null;
  return session;
}

function paths(category: MarketingCategory): string[] {
  const slug = category.toLowerCase();
  return [`/admin/marketing/${slug}`, `/portal/marketing/${slug}`];
}

export async function createMarketingCollection(input: { category: MarketingCategory; name: string }): Promise<{ ok: boolean; error?: string; id?: string }> {
  const t = await getTranslations("errors");
  // Build-now-ship-later: with the flag off, every action behaves as if the
  // feature doesn't exist — checked BEFORE the admin check, so a disabled
  // feature never distinguishes "you're not admin" from "this doesn't exist".
  if (!env.MARKETING_LIBRARY_ENABLED) return { ok: false, error: t("notFound") };
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: t("titleRequired") };

  const collection = await prisma.marketingCollection.create({
    data: { category: input.category, name, createdById: session.user.id },
  });
  await logAudit({ action: "marketing.collection_created", entityType: "MarketingCollection", entityId: collection.id, actorUserId: session.user.id });
  for (const p of paths(input.category)) revalidatePath(p);
  return { ok: true, id: collection.id };
}

// "No expiry" (build plan B-9) means no TTL, not "no way to retire one" — an
// archived collection and its assets stop showing to associates but nothing
// is deleted.
export async function archiveMarketingCollection(id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!env.MARKETING_LIBRARY_ENABLED) return { ok: false, error: t("notFound") };
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const collection = await prisma.marketingCollection.findUnique({ where: { id }, select: { category: true } });
  if (!collection) return { ok: false, error: t("notFound") };

  await prisma.marketingCollection.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await logAudit({
    action: archived ? "marketing.collection_archived" : "marketing.collection_unarchived",
    entityType: "MarketingCollection",
    entityId: id,
    actorUserId: session.user.id,
  });
  for (const p of paths(collection.category)) revalidatePath(p);
  return { ok: true };
}

export async function archiveMarketingAsset(id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!env.MARKETING_LIBRARY_ENABLED) return { ok: false, error: t("notFound") };
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const asset = await prisma.marketingAsset.findUnique({ where: { id }, select: { collection: { select: { category: true } } } });
  if (!asset) return { ok: false, error: t("notFound") };

  await prisma.marketingAsset.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await logAudit({
    action: archived ? "marketing.asset_archived" : "marketing.asset_unarchived",
    entityType: "MarketingAsset",
    entityId: id,
    actorUserId: session.user.id,
  });
  for (const p of paths(asset.collection.category)) revalidatePath(p);
  return { ok: true };
}

// ADR-0002 + Architect review M1/M4: onDelete is Restrict, not Cascade, and
// this is Business Admin only. Order matters — commit the DB truth FIRST
// (both rows deleted in one transaction), then delete the files. Deleting
// files first would leave live rows pointing at missing keys if the DB step
// then failed; an orphaned file after a successful DB delete is harmless
// (nothing references it) and can be swept later.
export async function deleteMarketingCollection(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!env.MARKETING_LIBRARY_ENABLED) return { ok: false, error: t("notFound") };
  const session = await requireFullAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const collection = await prisma.marketingCollection.findUnique({
    where: { id },
    select: { category: true, assets: { select: { id: true, fileKey: true } } },
  });
  if (!collection) return { ok: false, error: t("notFound") };

  await prisma.$transaction([
    prisma.marketingAsset.deleteMany({ where: { collectionId: id } }),
    prisma.marketingCollection.delete({ where: { id } }),
  ]);
  for (const asset of collection.assets) {
    await deleteObject(asset.fileKey);
  }
  await logAudit({ action: "marketing.collection_deleted", entityType: "MarketingCollection", entityId: id, actorUserId: session.user.id });
  for (const p of paths(collection.category)) revalidatePath(p);
  return { ok: true };
}
