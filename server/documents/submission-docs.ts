import { randomUUID } from "crypto";
import { SubmissionDocKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";

/** Per-file size cap (16-Jul quotation workflow). Server Action body limit is
 * 10 MB total, so callers should keep the combined payload under that. */
export const MAX_DOC_BYTES = 15_000_000;

/**
 * Validate (size cap, SEC-11 magic-byte sniff — PDF/PNG/JPEG only) and store
 * one file's bytes in the object store. Returns the storage key, or null on a
 * bad/oversize file — never throws. Callers that need the submission_documents
 * row written inside their OWN transaction (e.g. a Tier-A audited write, see
 * addSubmissionRequiredDocument in server/sales/actions.ts) create the row
 * themselves after this; addSubmissionDocuments below does both steps itself
 * for its own best-effort, unaudited, freeform-batch case.
 */
export async function storeSubmissionUploadBytes(submissionId: string, file: File): Promise<string | null> {
  if (!file || file.size === 0 || file.size > MAX_DOC_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let ext: "png" | "jpeg" | "pdf";
  try {
    ext = assertUpload(bytes, ["pdf", "png", "jpeg"]);
  } catch {
    return null;
  }
  const key = `submissions/${submissionId}/${randomUUID()}.${ext}`;
  await putObject(key, Buffer.from(bytes));
  return key;
}

/**
 * Attach freeform documents to a sale (16-Jul quotation workflow). `Supporting`
 * = uploaded at submission (admin reviews before approving the quotation);
 * `Signed` = client-signed documents in the docket after generation. A bad or
 * oversize file is skipped and reported, never thrown, so it can't fail the
 * surrounding action.
 */
export async function addSubmissionDocuments(
  submissionId: string,
  files: File[],
  kind: SubmissionDocKind,
  uploaderId: string | null,
): Promise<{ stored: number; rejected: string[] }> {
  const rejected: string[] = [];
  let stored = 0;
  for (const file of files) {
    if (!file || file.size === 0) continue;
    const key = await storeSubmissionUploadBytes(submissionId, file);
    if (!key) { rejected.push(file.name); continue; }
    await prisma.submissionDocument.create({
      data: { submissionId, kind, fileKey: key, fileName: file.name, uploadedById: uploaderId },
    });
    stored++;
  }
  return { stored, rejected };
}

/** Documents attached to a sale, oldest first. */
export async function listSubmissionDocuments(submissionId: string) {
  return prisma.submissionDocument.findMany({
    where: { submissionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, fileName: true, fileKey: true },
  });
}
