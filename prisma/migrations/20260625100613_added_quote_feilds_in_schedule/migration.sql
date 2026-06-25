-- AlterTable
ALTER TABLE "TradieSchedule" ADD COLUMN     "quotedPrice" TEXT,
ADD COLUMN     "requiresQuote" BOOLEAN NOT NULL DEFAULT false;
