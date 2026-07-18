-- AlterTable
ALTER TABLE "sales_submissions" ADD COLUMN     "sd_approved_at" TIMESTAMP(3),
ADD COLUMN     "sd_approved_by" UUID;
