-- 16-Jul (d): company cut + SM/SD overrides may each be a % of the sale OR an
-- absolute $ amount. Widen the rate columns to hold an absolute value, and
-- record which each is (existing rows keep Percentage semantics).
ALTER TABLE "products" ALTER COLUMN "company_cut_pct" TYPE DECIMAL(14,4);
ALTER TABLE "products" ALTER COLUMN "sm_override_pct" TYPE DECIMAL(14,4);
ALTER TABLE "products" ALTER COLUMN "sd_override_pct" TYPE DECIMAL(14,4);

ALTER TABLE "products" ADD COLUMN "company_cut_type" "ComValueType" NOT NULL DEFAULT 'Percentage';
ALTER TABLE "products" ADD COLUMN "sm_override_type" "ComValueType" NOT NULL DEFAULT 'Percentage';
ALTER TABLE "products" ADD COLUMN "sd_override_type" "ComValueType" NOT NULL DEFAULT 'Percentage';
