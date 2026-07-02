"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function updateNameCard(input: {
  chineseName?: string;
  customTitle?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in." };

  const chineseName = input.chineseName?.trim() || null;
  const customTitle = input.customTitle?.trim() || null;

  // NameCard is one-to-many with User in the schema, so upsert by the first
  // existing card for this user (or create one).
  const existing = await prisma.nameCard.findFirst({ where: { userId: session.user.id }, select: { id: true } });
  if (existing) {
    await prisma.nameCard.update({ where: { id: existing.id }, data: { chineseName, customTitle } });
  } else {
    await prisma.nameCard.create({ data: { userId: session.user.id, chineseName, customTitle } });
  }

  revalidatePath("/portal/name-card");
  revalidatePath("/admin/name-card");
  return { ok: true };
}
