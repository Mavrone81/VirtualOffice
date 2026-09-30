-- CreateEnum
CREATE TYPE "InstalmentOption" AS ENUM ('None', 'Months12', 'Months12or24');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "booking_fee" DECIMAL(14,2),
ADD COLUMN     "discounted_price" DECIMAL(14,2),
ADD COLUMN     "instalment_option" "InstalmentOption" NOT NULL DEFAULT 'None',
ADD COLUMN     "listed_price" DECIMAL(14,2),
ADD COLUMN     "monthly_instalment_12" DECIMAL(14,2),
ADD COLUMN     "monthly_instalment_24" DECIMAL(14,2);
