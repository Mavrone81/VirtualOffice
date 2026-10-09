-- Owner's change (2026-10-09): instalments become a repeatable add-on list
-- instead of the fixed InstalmentOption enum (None/Months12/Months12or24) +
-- two month-shaped columns. Full payment is always available and is NOT a
-- row here -- a product with no plan rows means "full payment only".
--
-- NEW TABLE + BACKFILL. instalment_option / booking_fee / monthly_instalment_12
-- / monthly_instalment_24 on "products" are NOT touched, NOT dropped and NOT
-- read by this migration or by any code after it ships -- left in place,
-- nullable, for one release: that backfill below has never run on production
-- data, and a dropped column cannot be rolled back.
--
-- Rollback (safe at any time before the next release starts WRITING through
-- the new table -- i.e. before any plan row exists that wasn't produced by
-- this backfill): DROP TABLE IF EXISTS "product_instalment_plans"; then
-- DELETE FROM "_prisma_migrations" WHERE migration_name =
-- '20261009060000_product_instalment_plans'; if recorded as applied. The old
-- columns are untouched throughout, so rolling back loses nothing.

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_instalment_plans" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "months" INTEGER NOT NULL,
    "monthly_amount" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_instalment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex. Two plans on one product with the same month count is
-- nonsense (the owner's own framing) -- enforced here, not just in the form,
-- and this is also what makes the backfill below safely re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS "product_instalment_plans_product_id_months_key"
  ON "product_instalment_plans"("product_id", "months");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "product_instalment_plans"
    ADD CONSTRAINT "product_instalment_plans_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddCheckConstraint. months > 0 is enforced by zod today
-- (lib/schemas.ts's instalmentPlanShape: .int().positive()) but nowhere else
-- -- a raw write, a seed script, a future server action, or a backfill in
-- some later migration can all reach this table without going through that
-- schema, and a zero-month plan divides by zero wherever a monthly amount is
-- derived from it. The database is where this survives code that has not
-- been written yet.
--
-- Note for whoever preps a database for this migration: `prisma db push`
-- SKIPS raw SQL inside migrations, so a database prepared that way will
-- never get this constraint even after this line exists -- `prisma migrate
-- deploy` is the only supported way to apply this file, which is exactly why
-- that is the standing rule here, not merely a style preference.
DO $$ BEGIN
  ALTER TABLE "product_instalment_plans"
    ADD CONSTRAINT "product_instalment_plans_months_positive" CHECK ("months" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill. Derives the expected row count from a COUNT on the live shapes
-- (not from what the three old enum values are assumed to mean) -- the
-- build's own report states both the measured counts and the resulting row
-- counts side by side, so a drift between them is visible rather than
-- assumed away.
--
--   None           -> no rows (full payment only -- nothing to insert)
--   Months12       -> one row:  months = 12, monthly_amount = monthly_instalment_12
--   Months12or24   -> two rows: months = 12 (monthly_instalment_12)
--                              and months = 24 (monthly_instalment_24)
--
-- gen_random_uuid() is core Postgres (13+), no extension required. The
-- unique index above makes both statements safe to re-run: a product whose
-- (product_id, months) pair was already backfilled is skipped, never
-- duplicated or overwritten.
INSERT INTO "product_instalment_plans" ("id", "product_id", "months", "monthly_amount", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 12, "monthly_instalment_12", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "products"
WHERE "instalment_option" IN ('Months12', 'Months12or24')
ON CONFLICT ("product_id", "months") DO NOTHING;

INSERT INTO "product_instalment_plans" ("id", "product_id", "months", "monthly_amount", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 24, "monthly_instalment_24", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "products"
WHERE "instalment_option" = 'Months12or24'
ON CONFLICT ("product_id", "months") DO NOTHING;
