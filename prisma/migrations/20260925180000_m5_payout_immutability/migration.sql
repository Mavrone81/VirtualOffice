-- M5: payouts are immutable once Approved/Paid. Additive: new enum, two new
-- columns with defaults, one nullable FK column. The (associate, month) unique
-- key is widened to (associate, month, seq) so a month can carry adjustment
-- payouts; every existing row gets seq = 0, so the new key holds for all of them.
-- No existing data is modified or removed. Linking existing ledger lines to their
-- payouts is a separate, reviewed step (scripts/backfill-payout-ids.ts, dry-run).

-- CreateEnum
CREATE TYPE "PayoutKind" AS ENUM ('Regular', 'Adjustment');

-- AlterTable
ALTER TABLE "monthly_payouts" ADD COLUMN     "kind" "PayoutKind" NOT NULL DEFAULT 'Regular',
ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- Widen the unique key: create the new one before dropping the old one.
CREATE UNIQUE INDEX "monthly_payouts_associate_id_payout_month_seq_key" ON "monthly_payouts"("associate_id", "payout_month", "seq");
DROP INDEX "monthly_payouts_associate_id_payout_month_key";

-- AlterTable
ALTER TABLE "commission_ledger" ADD COLUMN     "payout_id" UUID;

-- CreateIndex
CREATE INDEX "commission_ledger_payout_id_idx" ON "commission_ledger"("payout_id");

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "monthly_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
