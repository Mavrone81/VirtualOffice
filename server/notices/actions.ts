"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { NoticeAudience, AppRole } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { putObject, deleteObject } from "@/lib/storage";

const MAX_BYTES = 15_000_000;

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

async function storeUpload(prefix: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(-80) || "file";
  const key = `${prefix}/${randomUUID()}/${safeName}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()));
  return key;
}

export type NoticeInput = {
  title: string;
  body: string;
  audience: "All" | "Team" | "Role";
  audienceTeam?: string;
  audienceRole?: AppRole;
  attachment?: File | null;
};

export async function createNotice(input: NoticeInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!input.title?.trim()) return { ok: false, error: t("titleRequired") };
  if (!input.body?.trim()) return { ok: false, error: t("messageBodyRequired") };
  if (input.audience === "Team" && !input.audienceTeam?.trim()) return { ok: false, error: t("teamNameRequiredForTeam") };
  if (input.audience === "Role" && !input.audienceRole) return { ok: false, error: t("roleRequiredForRole") };

  let attachmentFileKey: string | null = null;
  if (input.attachment && input.attachment.size > 0) {
    if (input.attachment.size > MAX_BYTES) return { ok: false, error: t("fileTooLarge") };
    attachmentFileKey = await storeUpload("notices", input.attachment);
  }

  const notice = await prisma.notice.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      audience: NoticeAudience[input.audience],
      audienceTeam: input.audience === "Team" ? input.audienceTeam!.trim() : null,
      audienceRole: input.audience === "Role" ? input.audienceRole! : null,
      attachmentFileKey,
      postedById: session.user.id,
    },
  });
  await logAudit({ action: "notice.published", entityType: "Notice", entityId: notice.id, actorUserId: session.user.id });
  revalidatePath("/admin/notices");
  revalidatePath("/portal/notices");
  return { ok: true };
}

export async function deleteNotice(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const notice = await prisma.notice.findUnique({ where: { id }, select: { attachmentFileKey: true } });
  if (notice?.attachmentFileKey) await deleteObject(notice.attachmentFileKey);
  await prisma.noticeRead.deleteMany({ where: { noticeId: id } });
  await prisma.notice.delete({ where: { id } });
  await logAudit({ action: "notice.deleted", entityType: "Notice", entityId: id, actorUserId: session.user.id });
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
