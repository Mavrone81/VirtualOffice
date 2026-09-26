-- M5 schema rollback: ONLY together with rolling the app code back to 0f89098
-- (the 0f89098 code needs the old unique key; M5 code needs the new columns).
-- See reviews/m5-deploy-runbook.md. Refuses if adjustment payouts exist, because
-- the old (associate, month) unique key cannot hold them: restore the backup instead.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM monthly_payouts WHERE seq > 0) THEN
    RAISE EXCEPTION 'adjustment payouts exist (seq > 0): resolve them first or restore the pre-deploy backup';
  END IF;
END $$;
ALTER TABLE commission_ledger DROP CONSTRAINT IF EXISTS commission_ledger_payout_id_fkey;
DROP INDEX IF EXISTS commission_ledger_payout_id_idx;
ALTER TABLE commission_ledger DROP COLUMN IF EXISTS payout_id;
CREATE UNIQUE INDEX IF NOT EXISTS monthly_payouts_associate_id_payout_month_key ON monthly_payouts (associate_id, payout_month);
DROP INDEX IF EXISTS monthly_payouts_associate_id_payout_month_seq_key;
ALTER TABLE monthly_payouts DROP COLUMN IF EXISTS seq, DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS "PayoutKind";
DELETE FROM _prisma_migrations WHERE migration_name = '20260925180000_m5_payout_immutability';
COMMIT;
