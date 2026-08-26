-- CreateEnum
CREATE TYPE "TradiePriceUnit" AS ENUM ('HOURLY', 'FIXED');

-- AlterTable
ALTER TABLE "Tradie" ADD COLUMN     "lastQuotedPriceUnit" "TradiePriceUnit" NOT NULL DEFAULT 'HOURLY';
