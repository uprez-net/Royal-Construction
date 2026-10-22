-- CreateEnum
CREATE TYPE "TradieRequestKind" AS ENUM ('QUOTE', 'BOOKING');

-- AlterTable
ALTER TABLE "TradieRequest" ADD COLUMN     "kind" "TradieRequestKind" NOT NULL DEFAULT 'QUOTE';

-- AlterTable
ALTER TABLE "TradieRequestRecipient" ADD COLUMN     "refToken" TEXT;

-- AlterTable
ALTER TABLE "TradieSchedule" ADD COLUMN     "refToken" TEXT;

-- Backfill: every booking and request email already sent gets a reference,
-- so a reminder or reschedule sent from today carries one too. Same shape the
-- application mints (lib/domain/tradies/reply-reference.ts): prefix, then 12
-- upper-case hex characters. Hashing the row id with random() keeps two rows
-- from landing on the same value in one statement.
UPDATE "TradieRequestRecipient"
SET "refToken" = 'RCTRQ-' || upper(substr(md5(random()::text || "id"), 1, 12))
WHERE "refToken" IS NULL;

UPDATE "TradieSchedule"
SET "refToken" = 'RCTBK-' || upper(substr(md5(random()::text || "id"), 1, 12))
WHERE "refToken" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TradieRequestRecipient_refToken_key" ON "TradieRequestRecipient"("refToken");

-- CreateIndex
CREATE UNIQUE INDEX "TradieSchedule_refToken_key" ON "TradieSchedule"("refToken");
