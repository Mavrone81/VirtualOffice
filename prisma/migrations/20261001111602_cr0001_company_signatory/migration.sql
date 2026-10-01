-- CR-0001: company signature + signatory name on the associate onboarding
-- agreement. Purely additive — no existing data changes, no backfill.
--
-- `company_signatory` is a SINGLETON: the current signatory/signature the
-- admin Company Data tab edits. The `singleton` column's unique constraint
-- makes a second row a DB error, not an app-enforced (racy) rule — writers
-- always `UPSERT ... WHERE singleton = true`.
--
-- `candidates`/`associates` each get an AT-SIGNING snapshot of the
-- signatory, captured once in the same write that sets
-- `signed_agreement_file_key` (server/recruitment/actions.ts), then copied
-- verbatim candidate → associate at approval — never re-read from
-- `company_signatory` after signing. This is what makes "the signatory as at
-- the signing date" true: a later edit in the Company Data tab changes
-- `company_signatory` but can never alter an already-signed agreement.
--
-- Every statement is guarded, so re-running this file by hand is a no-op
-- (prisma migrate deploy already skips it once recorded in
-- _prisma_migrations).

-- AlterTable
ALTER TABLE "candidates"
  ADD COLUMN IF NOT EXISTS "company_signatory_name_at_signing" TEXT,
  ADD COLUMN IF NOT EXISTS "company_signature_file_key_at_signing" TEXT;

-- AlterTable
ALTER TABLE "associates"
  ADD COLUMN IF NOT EXISTS "company_signatory_name_at_signing" TEXT,
  ADD COLUMN IF NOT EXISTS "company_signature_file_key_at_signing" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "company_signatory" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "signatory_name" TEXT NOT NULL,
    "signature_file_key" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_signatory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "company_signatory_singleton_key" ON "company_signatory"("singleton");
