"use server";

import { revalidatePath } from "next/cache";
import { NoticeAudience, AppRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

export type NoticeInput = {
  title: string;
  body: string;
  audience: "All" | "Team" | "Role";
  audienceTeam?: string;
  audienceRole?: AppRole;
};

export async function createNotice(input: NoticeInput): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };
  if (!input.title?.trim()) return { ok: false, error: "Title is required." };
  if (!input.body?.trim()) return { ok: false, error: "Message body is required." };
  if (input.audience === "Team" && !input.audienceTeam?.trim()) return { ok: false, error: "Team name is required for a team notice." };
  if (input.audience === "Role" && !input.audienceRole) return { ok: false, error: "Role is required for a role notice." };

  await prisma.notice.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      audience: NoticeAudience[input.audience],
      audienceTeam: input.audience === "Team" ? input.audienceTeam!.trim() : null,
      audienceRole: input.audience === "Role" ? input.audienceRole! : null,
      postedById: session.user.id,
    },
  });
  revalidatePath("/admin/notices");
  revalidatePath("/portal/notices");
  return { ok: true };
}

export async function deleteNotice(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };
  await prisma.noticeRead.deleteMany({ where: { noticeId: id } });
  await prisma.notice.delete({ where: { id } });
  revalidatePath("/admin/notices");
  revalidatePath("/portal/notices");
  return { ok: true };
}

export async function markNoticeRead(noticeId: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false };
  await prisma.noticeRead.upsert({
    where: { noticeId_userId: { noticeId, userId: session.user.id } },
    update: {},
    create: { noticeId, userId: session.user.id },
  });
  revalidatePath("/portal/notices");
  return { ok: true };
}
