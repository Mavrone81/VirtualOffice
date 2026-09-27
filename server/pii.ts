import { decryptPiiRaw } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

export type PiiField =
  | "nric" | "bankAccount"
  | "vendorSignerNric" | "applicant1Nric" | "applicant2Nric" | "applicantWitnessNric" | "companyWitnessNric";

/**
 * Decrypt a C3-PII field and record a `decrypt_pii` audit entry. Returns null
 * (without auditing) when there is nothing to decrypt or the ciphertext is bad,
 * so it drops in wherever the old `safeDecrypt(blob)` helpers were used.
 */
export async function decryptPiiAudited(opts: {
  blob: string | null | undefined;
  field: PiiField;
  subjectType: "Associate" | "Candidate" | "VendorReferral" | "PetsAshesAgreement";
  subjectId: string;
  actorUserId?: string | null;
}): Promise<string | null> {
  if (!opts.blob) return null;
  let value: string;
  try {
    value = decryptPiiRaw(opts.blob);
  } catch {
    return null;
  }
  await logAudit({
    action: "decrypt_pii",
    entityType: opts.subjectType,
    entityId: opts.subjectId,
    after: { field: opts.field },
    actorUserId: opts.actorUserId,
  });
  return value;
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
    let value: string;
    try {
      value = decryptPiiRaw(opts.blob);
    } catch (cause) {
      throw new Error(
        `readNric: failed to decrypt ${opts.field} for ${opts.subjectType} ${opts.subjectId} — refusing to render a blank NRIC`,
        { cause },
      );
    }
    await logAudit({
      action: "decrypt_pii",
      entityType: opts.subjectType,
      entityId: opts.subjectId,
      after: { field: opts.field },
      actorUserId: opts.actorUserId,
    });
    return value;
  }
  await logAudit({
    action: "pii.plaintext_read",
    entityType: opts.subjectType,
    entityId: opts.subjectId,
    after: { field: opts.field }, // counts-only: never the value
    actorUserId: opts.actorUserId,
  });
  return opts.blob;
}
