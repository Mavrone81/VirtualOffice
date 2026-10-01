-- CreateEnum
CREATE TYPE "ClosingBasis" AS ENUM ('ListedPrice', 'DiscountedPrice');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "closing_basis" "ClosingBasis" NOT NULL DEFAULT 'ListedPrice';
