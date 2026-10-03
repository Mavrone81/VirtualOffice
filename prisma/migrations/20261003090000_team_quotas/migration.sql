-- Team-level monthly / yearly targets. NEW TABLE + NEW ENUM ONLY: no existing
-- table, column or row is altered (sales_quotas and teams are untouched), and
-- there is no backfill. Guarded so a manual re-run is a no-op.
--
-- Rollback (safe at any time; it only discards team targets entered through
-- this feature): DROP TABLE IF EXISTS "team_quotas"; DROP TYPE IF EXISTS "TargetPeriodType";
-- then DELETE FROM "_prisma_migrations" WHERE migration_name = '20261003090000_team_quotas';
-- if the migration had been recorded as applied.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TargetPeriodType" AS ENUM ('Monthly', 'Yearly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_quotas" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "period_type" "TargetPeriodType" NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "set_by_role" "AppRole" NOT NULL,
    "set_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_quotas_pkey" PRIMARY KEY ("id"),
    -- period_type and period must agree: the type is the source of truth, the
    -- string's shape is checked against it, never used to infer it.
    CONSTRAINT "team_quotas_period_matches_type" CHECK (
      ("period_type" = 'Monthly' AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
      OR ("period_type" = 'Yearly' AND "period" ~ '^[0-9]{4}$')
    ),
    CONSTRAINT "team_quotas_amount_positive" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "team_quotas_team_id_period_type_period_key" ON "team_quotas"("team_id", "period_type", "period");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "team_quotas" ADD CONSTRAINT "team_quotas_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
