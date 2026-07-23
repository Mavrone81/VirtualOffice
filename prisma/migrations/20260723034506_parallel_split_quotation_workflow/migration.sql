-- AlterTable
ALTER TABLE "sales_submissions" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_by" UUID,
ADD COLUMN     "quote_date" DATE,
ADD COLUMN     "split_admin_approved_at" TIMESTAMP(3),
ADD COLUMN     "split_admin_approved_by" UUID,
ADD COLUMN     "split_director_id" UUID;

-- Backfill: default each submission's split director to its closer's team
-- director (23-Jul parallel workflow, issue 2) so in-flight submissions route to
-- the right SD. Picks the earliest-created active team (with a director) the
-- closer belongs to — the "first" SD when several. Only fills nulls.
UPDATE "sales_submissions" s
SET "split_director_id" = t."director_id"
FROM "team_members" tm
JOIN "teams" t ON t."id" = tm."team_id"
WHERE tm."associate_id" = s."closing_associate_id"
  AND t."active" = true
  AND t."director_id" IS NOT NULL
  AND s."split_director_id" IS NULL
  AND t."created_at" = (
    SELECT MIN(t2."created_at")
    FROM "team_members" tm2
    JOIN "teams" t2 ON t2."id" = tm2."team_id"
    WHERE tm2."associate_id" = s."closing_associate_id"
      AND t2."active" = true
      AND t2."director_id" IS NOT NULL
  );
