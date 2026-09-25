-- SEC-5: when an edit last changed a submission's commission split terms (and
-- cleared its split approvals). The SD step's 3-day auto-approve counts from here
-- when set, else from created_at. Additive, nullable, no default: every existing
-- row keeps its current clock, so no in-flight sale changes behaviour at deploy.
-- Guarded, so a manual re-run is a no-op.
ALTER TABLE "sales_submissions" ADD COLUMN IF NOT EXISTS "split_edited_at" TIMESTAMP(3);
