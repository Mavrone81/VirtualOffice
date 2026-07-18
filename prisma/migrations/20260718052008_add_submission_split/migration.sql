-- AlterTable
ALTER TABLE "sales_submissions" ADD COLUMN     "associate2_id" UUID,
ADD COLUMN     "associate2_value" DECIMAL(14,4),
ADD COLUMN     "associate2_value_type" "ComValueType",
ADD COLUMN     "associate3_id" UUID,
ADD COLUMN     "associate3_value" DECIMAL(14,4),
ADD COLUMN     "associate3_value_type" "ComValueType";
