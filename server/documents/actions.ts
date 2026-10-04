"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma, DocumentType, DocumentAssignment } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { putObject, deleteObject } from "@/lib/storage";
import { assertDocumentUpload } from "@/lib/file-type";

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

  const bytes = Buffer.from(await input.file.arrayBuffer());
  try {
    assertDocumentUpload(bytes, input.file.name);
  } catch {
    return { ok: false, error: t("invalidFileType") };
  }

  const safeName = input.file.name.replace(/[^\w.\-]/g, "_").slice(-80) || "document";
  const key = `documents/${randomUUID()}/${safeName}`;
  await putObject(key, bytes);

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

  // INT-5. Order matters, and it is not symmetrical: the row delete can be
  // REFUSED, the file delete essentially cannot. `documents_superseded_by_fkey`
  // (documents.superseded_by -> documents.id, ON DELETE RESTRICT) refuses to
  // delete any row a retired template still points at — which is every current
  // template row that has ever been replaced. Removing the file first turned
  // that refusal into a surviving row pointing at a file that is already gone:
  // the document still lists and still opens in the UI, and fails only at
  // download, with nothing detecting it afterwards.
  //
  // So: commit the DB truth FIRST, then remove the file — the same ordering
  // rule as deleteMarketingCollection (server/marketing/actions.ts). The
  // explicit transaction matters here because that FK is DEFERRABLE INITIALLY
  // DEFERRED: its check runs at COMMIT, not at the DELETE statement, so the
  // refusal can only be known once the transaction has resolved. Nothing is
  // destroyed before that point, which makes the refusal retryable.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id } });
    });
  } catch (e) {
    // P2003 = FK constraint; P2014 = Prisma's own required-relation refusal.
    // Any other error rethrows exactly as before — in every case the file is
    // still untouched, because this runs before the delete below.
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, error: t("documentStillReferenced") };
    }
    throw e;
  }

  // The row is gone, so nothing references this object any more. If removing it
  // fails, the file is an orphan: it costs disk and breaks nothing, which is
  // strictly the better failure than the inverse, so it does not fail the
  // operation. Logged (tag, id and error class only) so it is not silent —
  // deleteObject itself already swallows a missing file.
  if (doc?.fileKey) {
    await deleteObject(doc.fileKey).catch((e: unknown) => {
      console.error(`[orphaned-object] document ${id} ${e instanceof Error ? e.name : "error"}`);
    });
  }
  await logAudit({ action: "document.deleted", entityType: "Document", entityId: id, actorUserId: session.user.id });
  revalidatePath("/admin/documents");
  revalidatePath("/portal/documents");
  return { ok: true };
}
