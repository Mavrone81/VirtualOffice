"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { putObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { renderQuotationPdf } from "@/lib/pdf/quotation";
import { addSubmissionDocuments } from "@/server/documents/submission-docs";
import { logAudit } from "@/lib/audit";

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

/**
 * Client signs the quotation on-system (23-Jul parallel workflow, issue 4).
 * Renders the approved quotation with the client's signature + name embedded and
 * stores it as a Signed docket document — the same signal an uploaded signed PDF
 * gives, which then unlocks the associate's Close Sale. Only the closing
 * associate (or an admin) may capture it, and only once the quotation is
 * approved and the sale isn't closed yet.
 */
export async function signQuotationOnSystem(
  submissionId: string,
  signatureDataUrl: string,
  signerName: string,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    select: { closingAssociateId: true, status: true, transaction: { select: { id: true } } },
  });
  if (!sub) return { ok: false, error: t("notFound") };

  const allowed = isAdminRole(session.user.role) || (!!session.user.associateId && session.user.associateId === sub.closingAssociateId);
  if (!allowed) return { ok: false, error: t("forbidden") };
  if (sub.transaction) return { ok: false, error: t("alreadyProcessed") };
  if (sub.status !== SubmissionStatus.QuotationApproved) return { ok: false, error: t("quotationNotApproved") };

  const name = signerName.trim();
  if (!name) return { ok: false, error: t("allFieldsRequired") };

  // Decode + validate the PNG signature (magic-byte sniff, same as onboarding).
  const sig = signatureDataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!sig) return { ok: false, error: t("signatureInvalid") };
  const signatureBytes = new Uint8Array(Buffer.from(sig[1], "base64"));
  try {
    assertUpload(signatureBytes, ["png"]);
  } catch {
    return { ok: false, error: t("signatureInvalid") };
  }

  const pdf = await renderQuotationPdf(submissionId, { dataUrl: signatureDataUrl, signerName: name, signedDate: new Date() });
  if (!pdf) return { ok: false, error: t("notFound") };

  const key = `submissions/${submissionId}/${randomUUID()}.pdf`;
  await putObject(key, pdf.buffer);
  await prisma.submissionDocument.create({
    data: { submissionId, kind: "Signed", fileKey: key, fileName: `Signed-${pdf.filename}`, uploadedById: session.user.id },
  });

  await logAudit({ action: "quotation.signed_on_system", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id, after: { signerName: name } });
  revalidatePath("/portal/quotations");
  return { ok: true };
}
