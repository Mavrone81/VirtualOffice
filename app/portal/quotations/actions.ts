"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { addSubmissionDocuments } from "@/server/documents/submission-docs";

/**
 * Upload signed documents into a sale's docket (16-Jul quotation workflow). Only
 * the closing associate — or an admin — may add to a sale's docket. Freeform,
 * multiple; stored as Signed. Never throws over a bad file (skipped + reported).
 */
export async function uploadDocketDocuments(submissionId: string, files: File[]): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({ where: { id: submissionId }, select: { closingAssociateId: true } });
  if (!sub) return { ok: false, error: t("notFound") };

  const allowed = isAdminRole(session.user.role) || (!!session.user.associateId && session.user.associateId === sub.closingAssociateId);
  if (!allowed) return { ok: false, error: t("forbidden") };

  if (!files?.length) return { ok: false, error: t("fileRequired") };
  const r = await addSubmissionDocuments(submissionId, files, "Signed", session.user.id);
  if (r.stored === 0) return { ok: false, error: t("invalidFileType") };

  revalidatePath("/portal/quotations");
  return { ok: true };
}
