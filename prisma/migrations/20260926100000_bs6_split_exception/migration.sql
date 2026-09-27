-- B-S6: split exception (warn + Business Admin approval) on sales_submissions.
-- Additive: one NOT NULL boolean with a default (false for every existing row) and five
-- nullable columns. No existing data changes. Guarded, so a manual re-run is a no-op.
ALTER TABLE "sales_submissions"
  ADD COLUMN IF NOT EXISTS "split_exception_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "split_exception_approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "split_exception_approved_by" UUID,
  ADD COLUMN IF NOT EXISTS "split_exception_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "split_exception_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "split_exception_version" TIMESTAMP(3);
