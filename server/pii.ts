import { decryptPiiRaw } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

export type PiiField = "nric" | "bankAccount";

/**
 * Decrypt a C3-PII field and record a `decrypt_pii` audit entry. Returns null
 * (without auditing) when there is nothing to decrypt or the ciphertext is bad,
 * so it drops in wherever the old `safeDecrypt(blob)` helpers were used.
 */
export async function decryptPiiAudited(opts: {
  blob: string | null | undefined;
  field: PiiField;
  subjectType: "Associate" | "Candidate";
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
