"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { DocumentType, DocumentAssignment } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { putObject, deleteObject } from "@/lib/storage";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

export type DocumentUpload = {
  title: string;
  type: DocumentType;
  assignment: "All" | "Team" | "Associate";
  assignedTeam?: string;
  assignedAssociateCode?: string;
  file: File;
};

const MAX_BYTES = 15_000_000;

export async function uploadDocument(input: DocumentUpload): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!input.title?.trim()) return { ok: false, error: t("titleRequired") };
  if (!input.file || input.file.size === 0) return { ok: false, error: t("fileRequired") };
  if (input.file.size > MAX_BYTES) return { ok: false, error: t("fileTooLarge") };

  let assignedAssociateId: string | null = null;
  if (input.assignment === "Associate") {
    if (!input.assignedAssociateCode?.trim()) return { ok: false, error: t("associateCodeRequired") };
    const a = await prisma.associate.findUnique({ where: { associateCode: input.assignedAssociateCode.trim() }, select: { id: true } });
    if (!a) return { ok: false, error: t("associateCodeNotFound") };
    assignedAssociateId = a.id;
  }
  if (input.assignment === "Team" && !input.assignedTeam?.trim()) return { ok: false, error: t("teamNameRequired") };

  const safeName = input.file.name.replace(/[^\w.\-]/g, "_").slice(-80) || "document";
  const key = `documents/${randomUUID()}/${safeName}`;
  await putObject(key, Buffer.from(await input.file.arrayBuffer()));

  const doc = await prisma.document.create({
    data: {
      type: input.type,
      title: input.title.trim(),
      fileKey: key,
      assignment: DocumentAssignment[input.assignment],
      assignedTeam: input.assignment === "Team" ? input.assignedTeam!.trim() : null,
      assignedAssociateId,
      uploadedById: session.user.id,
    },
  });
  await logAudit({ action: "document.uploaded", entityType: "Document", entityId: doc.id, actorUserId: session.user.id });
  revalidatePath("/admin/documents");
  revalidatePath("/portal/documents");
  return { ok: true };
}

export async function deleteDocument(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const doc = await prisma.document.findUnique({ where: { id }, select: { fileKey: true } });
  if (doc?.fileKey) await deleteObject(doc.fileKey);
  await prisma.document.delete({ where: { id } });
  await logAudit({ action: "document.deleted", entityType: "Document", entityId: id, actorUserId: session.user.id });
  revalidatePath("/admin/documents");
  revalidatePath("/portal/documents");
  return { ok: true };
}
