"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { DocumentType, DocumentAssignment } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
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
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };
  if (!input.title?.trim()) return { ok: false, error: "Title is required." };
  if (!input.file || input.file.size === 0) return { ok: false, error: "Please choose a file." };
  if (input.file.size > MAX_BYTES) return { ok: false, error: "File must be under 15 MB." };

  let assignedAssociateId: string | null = null;
  if (input.assignment === "Associate") {
    if (!input.assignedAssociateCode?.trim()) return { ok: false, error: "Associate code is required." };
    const a = await prisma.associate.findUnique({ where: { associateCode: input.assignedAssociateCode.trim() }, select: { id: true } });
    if (!a) return { ok: false, error: "Associate code not found." };
    assignedAssociateId = a.id;
  }
  if (input.assignment === "Team" && !input.assignedTeam?.trim()) return { ok: false, error: "Team name is required." };

  const safeName = input.file.name.replace(/[^\w.\-]/g, "_").slice(-80) || "document";
  const key = `documents/${randomUUID()}/${safeName}`;
  await putObject(key, Buffer.from(await input.file.arrayBuffer()));

  await prisma.document.create({
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
  revalidatePath("/admin/documents");
  revalidatePath("/portal/documents");
  return { ok: true };
}

export async function deleteDocument(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };
  const doc = await prisma.document.findUnique({ where: { id }, select: { fileKey: true } });
  if (doc?.fileKey) await deleteObject(doc.fileKey);
  await prisma.document.delete({ where: { id } });
  revalidatePath("/admin/documents");
  revalidatePath("/portal/documents");
  return { ok: true };
}
