import { decryptPiiRaw } from "@/lib/crypto";
import { auditTx, PiiAuditUnavailableError } from "@/lib/audit";
import { prisma } from "@/lib/db";

// Audit-before-reveal: PiiAuditUnavailableError lives in lib/audit.ts (free of the
// crypto/env imports, so any caller can catch it cheaply); re-exported here.
export { PiiAuditUnavailableError };

let authModule: Promise<typeof import("@/auth")> | undefined;

async function recordPiiAccess(opts: {
  action: "decrypt_pii" | "pii.plaintext_read";
  subjectType: string;
  subjectId: string;
  field: PiiField;
  actorUserId?: string | null;
}): Promise<void> {
  try {
    let actor = opts.actorUserId;
    if (actor === undefined) {
      // Same lazy session lookup as logAudit (tools-image scripts always pass one),
      // memoised so concurrent reveals (e.g. the 4 NRICs of an ashes PDF) share one import.
      const { auth } = await (authModule ??= import("@/auth"));
      actor = (await auth())?.user?.id ?? null;
    }
    await auditTx(prisma, {
      action: opts.action, entityType: opts.subjectType, entityId: opts.subjectId,
      after: { field: opts.field }, // the field name only — never the value
      actorUserId: actor,
    });
  } catch (e) {
    throw new PiiAuditUnavailableError(e);
  }
}

export type PiiField =
  | "nric" | "bankAccount"
  | "vendorSignerNric" | "applicant1Nric" | "applicant2Nric" | "applicantWitnessNric" | "companyWitnessNric";

/**
 * Decrypt a C3-PII field, recording a `decrypt_pii` audit entry FIRST
 * (audit-before-reveal). Returns null when there is nothing to decrypt or the
 * ciphertext is bad (the access attempt is still recorded), so it drops in
 * wherever the old `safeDecrypt(blob)` helpers were used. Throws
 * PiiAuditUnavailableError — and reveals nothing — if the audit can't be written.
 */
export async function decryptPiiAudited(opts: {
  blob: string | null | undefined;
  field: PiiField;
  subjectType: "Associate" | "Candidate" | "VendorReferral" | "PetsAshesAgreement";
  subjectId: string;
  actorUserId?: string | null;
}): Promise<string | null> {
  if (!opts.blob) return null;
  await recordPiiAccess({ action: "decrypt_pii", subjectType: opts.subjectType, subjectId: opts.subjectId, field: opts.field, actorUserId: opts.actorUserId });
  try {
    return decryptPiiRaw(opts.blob);
  } catch {
    return null;
  }
}

/**
 * SEC-12 (P-1): tolerant read for the transition window between shipping
 * encrypt-on-write and running the backfill. `v1:` -> an audited decrypt,
 * exactly like the associate fields. Anything else is still-plaintext legacy
 * data — return it as-is (never throws; `decryptPiiRaw` would), and audit
 * only the field name and entity id, never the value. Remove the plaintext
 * branch in a later release once the `pii.plaintext_read` count is 0.
 */
export async function readNric(opts: {
  blob: string | null | undefined;
  field: Exclude<PiiField, "nric" | "bankAccount">;
  subjectType: "VendorReferral" | "PetsAshesAgreement";
  subjectId: string;
  actorUserId?: string | null;
}): Promise<string | null> {
  if (!opts.blob) return null;
  if (opts.blob.startsWith("v1:")) {
    // Unlike decryptPiiAudited (whose existing callers — bank files, the
    // P-File page, the payout statement PDF — all rely on a null return to
    // degrade gracefully), a `v1:` value here feeds a legal agreement PDF, so
    // a decrypt failure throws rather than rendering a blank NRIC.
    // Audit-before-reveal: recorded first; throws PiiAuditUnavailableError if not.
    await recordPiiAccess({ action: "decrypt_pii", subjectType: opts.subjectType, subjectId: opts.subjectId, field: opts.field, actorUserId: opts.actorUserId });
    try {
      return decryptPiiRaw(opts.blob);
    } catch (cause) {
      throw new Error(
        `readNric: failed to decrypt ${opts.field} for ${opts.subjectType} ${opts.subjectId} — refusing to render a blank NRIC`,
        { cause },
      );
    }
  }
  // Legacy plaintext (pre-backfill): the read is recorded first, too.
  await recordPiiAccess({ action: "pii.plaintext_read", subjectType: opts.subjectType, subjectId: opts.subjectId, field: opts.field, actorUserId: opts.actorUserId });
  return opts.blob;
}
