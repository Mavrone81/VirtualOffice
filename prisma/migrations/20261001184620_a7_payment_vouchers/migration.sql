-- A-7: payment voucher per settling payout (build-plan A stream, item A-7;
-- Samuel Q42, decided (b) — one voucher per payout, not per transaction).
-- Purely additive: one new table, no change to any existing one. No
-- backfill — a (transaction, associate, payout) triple simply has no
-- voucher until first downloaded; getOrCreateVoucher issues it on demand.
--
-- Every statement is guarded, so re-running this file by hand is a no-op
-- (prisma migrate deploy already skips it once recorded in
-- _prisma_migrations).

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_vouchers" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "associate_id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "associate_name" TEXT NOT NULL,
    "associate_code" TEXT NOT NULL,
    "transaction_code" TEXT NOT NULL,
    "client_initials" TEXT NOT NULL,
    "payout_months" TEXT[],
    "paid_date" TIMESTAMP(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "total_paid" DECIMAL(14,2) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,

    CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_vouchers_reference_key" ON "payment_vouchers"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_vouchers_transaction_id_associate_id_idx" ON "payment_vouchers"("transaction_id", "associate_id");

-- CreateIndex: also the uniqueness that makes getOrCreateVoucher's
-- first-request race safe — two concurrent POSTs for the SAME
-- (transaction, associate, payout) collide here, and the loser reads back
-- the winner's row instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_vouchers_transaction_id_associate_id_payout_id_key" ON "payment_vouchers"("transaction_id", "associate_id", "payout_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "sales_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_associate_id_fkey"
    FOREIGN KEY ("associate_id") REFERENCES "associates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_payout_id_fkey"
    FOREIGN KEY ("payout_id") REFERENCES "monthly_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
