-- B-5: Doc Template admin uploads (Option 1 — replace only the browsable
-- reference copy on the Doc Template portal page; the e-signing pipeline and
-- signed PDFs are untouched, and the built-in templates under
-- public/templates/ are NOT this feature's subject — they are sha-pinned
-- generation masters for the e-signing renderer, unrelated to this column).
-- Purely additive on "documents" — one enum, three nullable columns, no
-- backfill. Guarded so a manual re-run is a no-op (standing runbook rule).
-- Rollback (safe only before anyone has uploaded a template through this
-- feature): ALTER TABLE "documents" DROP COLUMN IF EXISTS "superseded_by",
-- DROP COLUMN IF EXISTS "retired_at", DROP COLUMN IF EXISTS "category";
-- DROP TYPE IF EXISTS "TemplateCategory". Once a template has been
-- uploaded, fix forward instead of dropping.

DO $$ BEGIN
  CREATE TYPE "TemplateCategory" AS ENUM ('PetsAfterlife', 'HumanAfterlife');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "category" "TemplateCategory";
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "superseded_by" UUID;

-- Self-referencing: a retired row's "superseded_by" points at the row that
-- replaced it. RESTRICT (not CASCADE) mirrors B-9's collection FK reasoning —
-- deleting the referenced row would otherwise either cascade (orphaning the
-- retired row's chain) or silently null out a pointer that's supposed to be
-- permanent traceability; neither is acceptable, so deletion of a row that is
-- still pointed to is refused instead.
--
-- DEFERRABLE INITIALLY DEFERRED: the app retires the OLD row (setting
-- superseded_by to the new row's id) BEFORE inserting the new row in the
-- same transaction — insert-first-then-retire isn't available, because
-- inserting a second non-retired row for the category before the old one is
-- retired would immediately trip the partial unique index below, even with
-- no concurrency at all. A same-statement FK check would reject the retire
-- for pointing at an id that doesn't exist yet; deferring the check to COMMIT
-- lets it validate against the transaction's final state instead, where the
-- new row exists.
DO $$ BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_superseded_by_fkey"
    FOREIGN KEY ("superseded_by") REFERENCES "documents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- "Exactly one non-retired upload per template category" is not expressible
-- in Prisma's schema DSL (no partial-index support), so this migration.sql
-- (not @@unique in schema.prisma) is the sole source of truth for this
-- constraint — directly mirroring B-9's
-- marketing_assets_collection_sha256_active_key. NULL "category" values
-- (every Document row that isn't a template) never collide in a unique
-- index, so this has no effect outside the two template categories. On a
-- Postgres unique-violation (P2002), the app deletes the file it just wrote
-- and returns a "someone just replaced this — refresh" error instead of
-- leaving a second live row.
CREATE UNIQUE INDEX IF NOT EXISTS "documents_category_active_key"
  ON "documents"("category")
  WHERE "retired_at" IS NULL;
