-- Owner's ruling (2026-10-09 addendum): maximum instalment term is 72
-- months (six years) -- raised from an unmade question. lib/schemas.ts
-- enforces 72 on BOTH sides (instalmentPlanShape here, saleSchema's
-- installmentCount), but zod is not the only way a row reaches this table:
-- a raw write, a seed script, a future server action, or a later backfill
-- can all get here without passing through it -- exactly the reasoning that
-- put "months_positive" on this table in the first migration, applied
-- consistently rather than selectively.
--
-- "months_positive" (20261009060000) is an INVARIANT: zero or negative
-- months is never valid, in any world. This constraint is a DECISION: 72 is
-- the policy today because the owner drew the line there, not because the
-- arithmetic demands it -- a future ruling could move it, and that move
-- would be a migration, deliberately: changing the maximum length of a
-- customer commitment should be cheap, auditable, and intentional, never a
-- silent code edit. The repeated "> 0" below is deliberate, not an oversight
-- -- this constraint states the full policy on its own terms rather than
-- leaning on the other one for half of it, so either can be dropped or
-- changed later without reasoning about what the other half covers.
--
-- Note for whoever preps a database for this migration (same note as
-- 20261009060000's own CHECK constraint, repeated because it is easy to
-- miss twice): `prisma db push` SKIPS raw SQL inside migrations -- a
-- database prepared that way will never get this constraint. `prisma
-- migrate deploy` is the only supported way to apply this file.
--
-- Rollback (safe at any time -- this constraint rejects writes, it does not
-- shape any stored data, so dropping it changes nothing already saved):
-- ALTER TABLE "product_instalment_plans" DROP CONSTRAINT IF EXISTS
-- "product_instalment_plans_months_within_policy"; then DELETE FROM
-- "_prisma_migrations" WHERE migration_name =
-- '20261009080000_product_instalment_plans_months_within_policy'; if
-- recorded as applied.

-- AddCheckConstraint
DO $$ BEGIN
  ALTER TABLE "product_instalment_plans"
    ADD CONSTRAINT "product_instalment_plans_months_within_policy" CHECK ("months" > 0 AND "months" <= 72);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
