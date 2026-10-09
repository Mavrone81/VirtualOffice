-- Fixes a live defect in a document the CLIENT SIGNS: the Pet Ash agreement
-- PDF hardcoded "12 Months" / "a period of 12 calendar months" in its prose
-- regardless of the sale's actual instalment term (lib/pdf/ashes-agreement.tsx).
-- The real term already exists on the linked SalesSubmission
-- (installment_count) and already drives the correctly-computed monthly
-- figure shown alongside it -- only the MONTH COUNT in the prose was a
-- hardcoded literal, never read from anywhere.
--
-- NEW NULLABLE COLUMN + BACKFILL, additive. Rollback (safe at any time):
-- ALTER TABLE "pets_ashes_agreements" DROP COLUMN IF EXISTS "instalment_months";
-- then DELETE FROM "_prisma_migrations" WHERE migration_name =
-- '20261009070000_ashes_instalment_months'; if recorded as applied.

-- AlterTable
ALTER TABLE "pets_ashes_agreements" ADD COLUMN IF NOT EXISTS "instalment_months" INTEGER;

-- Backfill, scoped to Installment-plan agreements only (an agreement on
-- FullPayment has no instalment term to backfill -- stays NULL, same as a
-- Legacy row that predates this column, and the PDF's own "____" fallback
-- for a missing value is unreachable there anyway since isFull short-
-- circuits that whole block). Safe to re-run: every value it writes is
-- deterministic from the joined submission, so re-running it reproduces the
-- same result rather than compounding anything.
UPDATE "pets_ashes_agreements" AS paa
SET "instalment_months" = ss."installment_count"
FROM "sales_submissions" AS ss
WHERE paa."submission_id" = ss."id"
  AND paa."payment_plan" = 'Installment'
  AND ss."installment_count" IS NOT NULL;
