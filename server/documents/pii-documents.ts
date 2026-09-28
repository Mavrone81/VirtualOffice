import { prisma } from "@/lib/db";

// Audit reliability (reviews/audit-reliability.md, Tier A "PII as documents"):
// which stored files carry personal data, so their download is recorded BEFORE
// the bytes leave ("no audit, no file"). Record-level access control says who
// MAY look; this records who DID.
//
// Fail-safe first (Architect A1, DevLead): EVERY object under associates/,
// candidates/, vendors/ or submissions/ is treated as PII-bearing — signed agreements (NRIC), IC/passport
// scans, onboarding submissions, photos, uploaded vendor agreements. Then exact
// DB lookups name the record where the key alone can't: P-File documents (any
// key; ID documents are the most sensitive files we hold), vendor agreements
// (generated or uploaded), and Pets Ashes agreement PDFs (which share
// submissions/<id>/ with ordinary sale documents).
const BY_PREFIX: { re: RegExp; entityType: string }[] = [
  { re: /^associates\/([0-9a-f-]{36})\//i, entityType: "Associate" },
  { re: /^candidates\/([0-9a-f-]{36})\//i, entityType: "Candidate" },
  { re: /^vendors\/([0-9a-f-]{36})\//i, entityType: "VendorReferral" },
  // The sale docket (DevLead, A-17 ✎6): client documents, signed quotations, ashes
  // agreements — INCLUDING earlier signed versions after a void/re-sign, which no
  // longer match agreementPdfKey — and signature images. All personal data, so
  // all recorded; the ashes lookup above still names a current agreement exactly.
  { re: /^submissions\/([0-9a-f-]{36})\//i, entityType: "SalesSubmission" },
];

export async function nricDocumentFor(key: string): Promise<{ entityType: string; entityId: string } | null> {
  const pfile = await prisma.pFileDocument.findFirst({ where: { fileKey: key }, select: { id: true } });
  if (pfile) return { entityType: "PFileDocument", entityId: pfile.id };
  const vendor = await prisma.vendorReferral.findFirst({ where: { OR: [{ agreementPdfKey: key }, { agreementFileKey: key }] }, select: { id: true } });
  if (vendor) return { entityType: "VendorReferral", entityId: vendor.id };
  if (key.startsWith("submissions/") && key.endsWith(".pdf")) {
    const ashes = await prisma.petsAshesAgreement.findFirst({ where: { agreementPdfKey: key }, select: { id: true } });
    if (ashes) return { entityType: "PetsAshesAgreement", entityId: ashes.id };
  }
  for (const { re, entityType } of BY_PREFIX) {
    const m = key.match(re);
    if (m) return { entityType, entityId: m[1] };
  }
  return null;
}
