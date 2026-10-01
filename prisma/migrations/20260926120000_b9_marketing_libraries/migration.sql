-- B-9: Marketing libraries (Flyers / EDMs / Customisation / Greetings).
-- Purely additive — two new tables, nothing altered on any existing table,
-- no backfill. Guarded so a manual re-run is a no-op (standing runbook rule).
-- Rollback (safe only before anyone has uploaded through this feature):
-- DROP TABLE IF EXISTS "marketing_assets";
-- DROP TABLE IF EXISTS "marketing_collections"; DROP TYPE IF EXISTS
-- "MarketingCategory". Once assets exist, fix forward instead of dropping.

DO $$ BEGIN
  CREATE TYPE "MarketingCategory" AS ENUM ('Flyers', 'EDMs', 'Customisation', 'Greetings');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "marketing_collections" (
  "id" UUID NOT NULL,
  "category" "MarketingCategory" NOT NULL,
  "name" TEXT NOT NULL,
  "created_by" UUID,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "marketing_assets" (
  "id" UUID NOT NULL,
  "collection_id" UUID NOT NULL,
  "file_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "archived_at" TIMESTAMP(3),
  "uploaded_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "marketing_collections_category_idx" ON "marketing_collections"("category");
CREATE INDEX IF NOT EXISTS "marketing_assets_collection_id_idx" ON "marketing_assets"("collection_id");

-- ADR-0002 U2: dedupe is per collection, and only among ACTIVE (non-archived)
-- assets — a partial unique index, which Prisma's schema DSL can't express,
-- so this migration.sql (not @@unique in schema.prisma) is the source of
-- truth for this constraint. On a Postgres unique-violation (P2002 from the
-- app), the app deletes the file it just wrote and returns the existing row's
-- link instead of a second copy.
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_assets_collection_sha256_active_key"
  ON "marketing_assets"("collection_id", "sha256")
  WHERE "archived_at" IS NULL;

DO $$ BEGIN
  ALTER TABLE "marketing_assets"
    ADD CONSTRAINT "marketing_assets_collection_id_fkey"
    FOREIGN KEY ("collection_id") REFERENCES "marketing_collections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
