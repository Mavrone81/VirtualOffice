import type { PrismaClient } from "@prisma/client";
import { encryptPII, decryptPiiCurrentKeyOnly } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

/** SEC-12: the 5 plaintext NRIC columns across 2 tables. */
export const NRIC_TARGETS = [
  { table: "vendor_referrals", column: "vendor_signer_nric", entityType: "VendorReferral" as const, field: "vendorSignerNric" as const },
  { table: "pets_ashes_agreements", column: "applicant1_nric", entityType: "PetsAshesAgreement" as const, field: "applicant1Nric" as const },
  { table: "pets_ashes_agreements", column: "applicant2_nric", entityType: "PetsAshesAgreement" as const, field: "applicant2Nric" as const },
  { table: "pets_ashes_agreements", column: "applicant_witness_nric", entityType: "PetsAshesAgreement" as const, field: "applicantWitnessNric" as const },
  { table: "pets_ashes_agreements", column: "company_witness_nric", entityType: "PetsAshesAgreement" as const, field: "companyWitnessNric" as const },
] as const;

export type NricPlanRow = { table: string; column: string; nonNull: number; alreadyEncrypted: number; toEncrypt: number };

type Db = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

/** Read-only: counts per column, never the values themselves. */
export async function planNricEncryptBackfill(db: Db): Promise<NricPlanRow[]> {
  const rows: NricPlanRow[] = [];
  for (const t of NRIC_TARGETS) rows.push(await planOne(db, t));
  return rows;
}

export type NricApplyRow = NricPlanRow & { encryptedNow: number };

/**
 * Write: encrypt every still-plaintext value in place, one table+column at a
 * time. Each row is re-checked against the `NOT LIKE 'v1:%'` guard immediately
 * before its own write (P-1: a value already re-typed as ciphertext by a
 * concurrent request is never re-encrypted), so a second run of this function
 * converges to `encryptedNow = 0` for every column — that's the idempotency
 * proof (the data changes once, then stops; a bug is recovered by restoring
 * the pre-backfill plain backup, not by decrypting back).
 *
 * Audit: `pii.nric_encrypted`, one entry per row, entityType/entityId/field
 * only — never the plaintext or the ciphertext.
 *
 * `actorUserId` is required, not optional: pass `null` for a system/CLI run.
 * There is no sensible default to fall back to.
 */
export async function applyNricEncryptBackfill(db: PrismaClient, actorUserId: string | null): Promise<NricApplyRow[]> {
  const results: NricApplyRow[] = [];
  for (const t of NRIC_TARGETS) {
    const rows = await db.$queryRawUnsafe<{ id: string; value: string }[]>(
      `SELECT id, "${t.column}" AS value FROM "${t.table}" WHERE "${t.column}" IS NOT NULL AND "${t.column}" NOT LIKE 'v1:%'`,
    );
    let encryptedNow = 0;
    for (const row of rows) {
      const ciphertext = encryptPII(row.value);
      const res = await db.$executeRawUnsafe(
        `UPDATE "${t.table}" SET "${t.column}" = $1 WHERE id = $2::uuid AND "${t.column}" NOT LIKE 'v1:%'`,
        ciphertext, row.id,
      );
      if (res > 0) {
        encryptedNow++;
        await logAudit({ action: "pii.nric_encrypted", entityType: t.entityType, entityId: row.id, after: { field: t.field }, actorUserId });
      }
    }
    const after = await planOne(db, t);
    results.push({ ...after, encryptedNow });
  }
  return results;
}

async function planOne(db: Db, t: (typeof NRIC_TARGETS)[number]): Promise<NricPlanRow> {
  const [{ non_null, already_encrypted }] = await db.$queryRawUnsafe<{ non_null: bigint; already_encrypted: bigint }[]>(
    `SELECT
       count(*) FILTER (WHERE "${t.column}" IS NOT NULL) AS non_null,
       count(*) FILTER (WHERE "${t.column}" LIKE 'v1:%') AS already_encrypted
     FROM "${t.table}"`,
  );
  const nonNull = Number(non_null);
  const alreadyEncrypted = Number(already_encrypted);
  return { table: t.table, column: t.column, nonNull, alreadyEncrypted, toEncrypt: nonNull - alreadyEncrypted };
}

/**
 * P-4, tightened per S1: confirms PII_ENCRYPTION_KEY against real data before
 * the backfill touches a row. Finds any existing `v1:` associate NRIC/
 * bank-account ciphertext (already written by the live encrypt-on-write
 * code) and decrypts it with the CURRENT key only (no `PII_ENCRYPTION_KEY_
 * PREVIOUS` fallback — `encryptPII`, and so the backfill, always writes with
 * the current key). Never creates a record to make this pass: aborts if
 * there's no existing ciphertext to check, or if the current key can't
 * decrypt it.
 */
export async function assertEncryptionCanary(db: Db): Promise<void> {
  const [row] = await db.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM (
       SELECT nric AS value FROM associates WHERE nric LIKE 'v1:%'
       UNION ALL
       SELECT bank_account_number AS value FROM associates WHERE bank_account_number LIKE 'v1:%'
     ) existing LIMIT 1`,
  );
  if (!row) {
    throw new Error(
      "Encryption canary failed: no existing encrypted associate NRIC/bank-account found to verify PII_ENCRYPTION_KEY against. Refusing to proceed with a key that's never been proven to decrypt real data.",
    );
  }
  try {
    decryptPiiCurrentKeyOnly(row.value);
  } catch {
    throw new Error(
      "Encryption canary failed: PII_ENCRYPTION_KEY cannot decrypt an existing associate ciphertext with the CURRENT key. Check the key — the backfill always writes with the current key, so PII_ENCRYPTION_KEY_PREVIOUS is not checked here.",
    );
  }
}
