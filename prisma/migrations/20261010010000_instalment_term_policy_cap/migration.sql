-- Owner's ruling, 2026-10-09: the maximum instalment term is 72 months.
--
-- This replaces no constraint -- it TIGHTENS the existing one. The table was
-- created with CHECK ("months" > 0), which is an arithmetic invariant: a zero
-- or negative term divides by zero wherever a monthly figure is derived. The
-- upper bound is a different kind of rule. It is policy, it has an owner, and
-- it will change when he changes it -- which is exactly why it belongs in a
-- migration rather than in a constant someone edits. Changing how long a
-- customer may be committed for should be deliberate and auditable.
--
-- It is in the database and not only in zod for the same reason the lower
-- bound is: a raw write, a seed script, a backfill in a later migration, or a
-- server action nobody has written yet all reach this table without passing
-- through the schema. A bad term here does not raise a validation error. It
-- produces a signed contract with a payment schedule nobody agreed to.
--
-- Named ..._within_policy rather than ..._months_valid so that whoever reads
-- it in two years knows it is a business rule with an owner, not an invariant.
--
-- Rollback: ALTER TABLE "product_instalment_plans"
--             DROP CONSTRAINT IF EXISTS "product_instalment_plans_within_policy";
--           The lower bound is a separate constraint and is untouched.

-- Fail loudly rather than silently skipping, if any row already violates it.
-- There should be none -- the live table is empty and the backfill only ever
-- wrote 12 and 24 -- but a constraint added over bad data is worse than none.
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad FROM "product_instalment_plans" WHERE "months" > 72;
  IF bad > 0 THEN
    RAISE EXCEPTION 'cannot apply the 72-month policy cap: % row(s) exceed it', bad;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_instalment_plans"
    ADD CONSTRAINT "product_instalment_plans_within_policy" CHECK ("months" <= 72);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
