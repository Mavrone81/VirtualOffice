/**
 * SEC-12 backfill — encrypt the 5 plaintext NRIC columns (VendorReferral.
 * vendorSignerNric; PetsAshesAgreement.applicant1Nric/applicant2Nric/
 * applicantWitnessNric/companyWitnessNric) in place, once the encrypt-on-write
 * code has shipped (so no new plaintext rows can appear during the window).
 *
 * DRY RUN (default): read-only, counts only — never prints a value.
 *   DATABASE_URL="<url>&options=-c%20default_transaction_read_only%3Don" \
 *     pnpm tsx scripts/backfill-encrypt-nric.ts
 * It aborts unless the session reports transaction_read_only = on, same as
 * scripts/backfill-payout-ids.ts (M5).
 *
 * APPLY (Samuel's go; run through the tools image, deploy/vo-run-tool.sh, so
 * PII_ENCRYPTION_KEY is read from the .env allow-list, never passed on the
 * command line — P-4; see deploy/TOOLS.md):
 *   deploy/vo-run-tool.sh "$SHA" backfill-encrypt-nric.ts --digest "$DIGEST" \
 *     --vars PII_ENCRYPTION_KEY --dummy AUTH_SECRET --write -- --apply --expect <N>
 * Runs a canary first (S1): decrypts an EXISTING associate NRIC/bank-account
 * ciphertext with the CURRENT key only, and aborts if none decrypts — before
 * touching a single row. `--expect <N>` is required with --apply: N is the
 * dry run's own "total to encrypt", re-checked live right before any write,
 * binding the apply to that specific reviewed count (same guard shape as
 * M5/A-0's backfills). Idempotent: a second run always reports
 * encryptedNow = 0 for every column (pass --expect 0 then).
 */
import { PrismaClient } from "@prisma/client";
import {
  planNricEncryptBackfill, applyNricEncryptBackfill, assertEncryptionCanary, type NricPlanRow, type NricApplyRow,
} from "@/server/pii-nric-backfill";

/**
 * Unlike backfill-payout-ids.ts's model-operation allowlist, this dry-run path
 * only ever issues `$queryRawUnsafe` SELECTs (see pii-nric-backfill.ts) — a
 * Prisma client extension's `query` hook doesn't intercept raw queries anyway,
 * so the real enforcement here is the DB session itself: assertReadOnlySession
 * requires `transaction_read_only = on`, and Postgres then refuses any write
 * outright (`cannot execute UPDATE in a read-only transaction`), same as M5's
 * dry run.
 */
async function assertReadOnlySession(): Promise<void> {
  const base = new PrismaClient();
  try {
    const [row] = await base.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
    if (row?.transaction_read_only !== "on") {
      throw new Error(
        `DB session is not read-only (transaction_read_only=${row?.transaction_read_only ?? "?"}). ` +
          "Append options=-c%20default_transaction_read_only%3Don to DATABASE_URL (with & if it already has a ?).",
      );
    }
  } finally {
    await base.$disconnect();
  }
}

function printTable(rows: (NricPlanRow | NricApplyRow)[], extraCol?: "encryptedNow") {
  const header = extraCol
    ? "table                    column                      non_null  already_encrypted  to_encrypt  encrypted_now"
    : "table                    column                      non_null  already_encrypted  to_encrypt";
  console.log(header);
  for (const r of rows) {
    const base = `${r.table.padEnd(24)} ${r.column.padEnd(26)} ${String(r.nonNull).padStart(8)}  ${String(r.alreadyEncrypted).padStart(17)}  ${String(r.toEncrypt).padStart(10)}`;
    console.log(extraCol ? `${base}  ${String((r as NricApplyRow).encryptedNow).padStart(13)}` : base);
  }
}

async function dryRun() {
  await assertReadOnlySession();
  const db = new PrismaClient();
  const rows = await planNricEncryptBackfill(db);
  console.log("[DRY RUN] SEC-12 NRIC encryption — counts only, no values:\n");
  printTable(rows);
  const totalToEncrypt = rows.reduce((s, r) => s + r.toEncrypt, 0);
  console.log(`\ntotal to encrypt: ${totalToEncrypt}`);
  await db.$disconnect();
}

function parseExpect(): number {
  const i = process.argv.indexOf("--expect");
  if (i === -1 || !process.argv[i + 1]) {
    throw new Error(
      "--apply requires --expect <N>: N is the reviewed dry run's own \"total to encrypt\" — re-run the dry run first and pass its total (or --expect 0 to re-confirm an already-applied run is a no-op).",
    );
  }
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--expect must be a non-negative integer, got "${process.argv[i + 1]}"`);
  return n;
}

async function apply() {
  const expected = parseExpect();
  const db = new PrismaClient();
  try {
    console.log("Running encryption canary (decrypting an existing associate ciphertext with the current key)...");
    await assertEncryptionCanary(db);
    console.log("Canary OK. Checking the live count against --expect...");
    // Bound to the reviewed dry run (same guard shape as M5/A-0): the live
    // count must match --expect before any write.
    const plan = await planNricEncryptBackfill(db);
    const liveToEncrypt = plan.reduce((s, r) => s + r.toEncrypt, 0);
    if (liveToEncrypt !== expected) {
      throw new Error(
        `--expect ${expected} does not match the live count (${liveToEncrypt} rows still to encrypt right now). ` +
          "Re-run the dry run and pass its fresh total, or investigate before re-running.",
      );
    }
    console.log(`Live count matches --expect ${expected}. Encrypting...\n`);
    // Explicit null, not omitted: this is a system/CLI run, not a request.
    const rows = await applyNricEncryptBackfill(db, null);
    console.log("[APPLY] SEC-12 NRIC encryption — before/after counts, no values:\n");
    printTable(rows, "encryptedNow");
    const totalEncrypted = rows.reduce((s, r) => s + r.encryptedNow, 0);
    console.log(`\ntotal encrypted this run: ${totalEncrypted}`);
    const stillToEncrypt = rows.reduce((s, r) => s + r.toEncrypt, 0);
    if (stillToEncrypt > 0) console.log(`WARNING: ${stillToEncrypt} rows still not encrypted after this run — investigate before re-running.`);
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  if (process.argv.includes("--apply")) await apply();
  else await dryRun();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
