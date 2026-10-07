-- Managing Director's cut (owner, 2026-10-07).

-- 1. The designation. Safe inside Prisma's migration transaction on PostgreSQL
--    12+ (this server is 16) PRECISELY BECAUSE nothing below uses the new value
--    in the same transaction -- adding an enum value and then inserting a row
--    with it in one transaction is the thing that fails.
ALTER TYPE "Designation" ADD VALUE IF NOT EXISTS 'Managing Director';

-- 2. The per-product rate. Mechanically a sibling of sd_override_pct, so it
--    takes the same column shape.
--
--    DEFAULT 0 is the load-bearing part: every product that exists right now
--    keeps its exact current arithmetic until an admin sets a value. The "30%
--    of the company cut" default the owner asked for is applied by the product
--    FORM when creating a product, deliberately NOT here -- a column default of
--    30% would silently re-price every existing product the moment this ran,
--    and re-pricing a product changes what the company keeps on every future
--    sale of it.
ALTER TABLE "products" ADD COLUMN "md_cut_pct" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "md_cut_type" "ComValueType" NOT NULL DEFAULT 'Percentage';

-- 3. The ledger line type. Same transaction-safety note as the Designation
--    above: added here, first USED by a later runCommission, never in this
--    transaction.
ALTER TYPE "LedgerLineType" ADD VALUE IF NOT EXISTS 'Managing Director Cut';
