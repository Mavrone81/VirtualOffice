-- The code a candidate has been allotted at signing, so the agreement PDF can
-- print it. Nullable: a candidate holds no reservation until they sign, and
-- Postgres excludes NULL from uniqueness, so any number of candidates can hold
-- none without colliding.
--
-- The unique index is the concurrency guard itself, not a hint — it is what
-- makes simultaneous submissions take distinct codes. Dropping it fails the
-- three concurrency tests and leaves the other three passing, which is how we
-- know it is load-bearing rather than decorative.
--
-- Both statements are additive and safe on a populated table: existing rows
-- take NULL and nothing is rewritten.

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "reserved_associate_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "candidates_reserved_associate_code_key" ON "candidates"("reserved_associate_code");
