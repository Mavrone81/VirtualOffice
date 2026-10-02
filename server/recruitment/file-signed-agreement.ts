import { PFileDocType, type Prisma } from "@prisma/client";

/**
 * C-4: file a signed Associate Agreement into its owner's P-File. The single
 * code path for both the portal approval flow (approveCandidate) and the
 * offline/admin upload — so the two can never diverge on what "filed"
 * means. Upserts the P-File by userId (PFile.userId is unique and
 * non-nullable, so a P-File can't be created without one) rather than
 * assuming it already exists: a pre-existing user re-onboarding under the
 * same email may already have one from a prior associate record.
 */
export async function fileSignedAgreement(
  tx: Prisma.TransactionClient,
  userId: string,
  associateId: string,
  fileKey: string,
  filedById: string | null,
): Promise<void> {
  const pFile = await tx.pFile.upsert({
    where: { userId },
    update: { associateId },
    create: { userId, associateId },
  });
  await tx.pFileDocument.create({
    data: {
      pFileId: pFile.id,
      docType: PFileDocType.SignedAssociateAgreement,
      title: "Signed Associate Agreement",
      fileKey,
      filedById,
      filedAt: new Date(),
    },
  });
}
