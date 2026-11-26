-- A send whose delivery failed (#585): the report that arrives in the mailbox stamps
-- this once. Additive and nullable; a send with no report behaves exactly as before.

-- AlterTable
ALTER TABLE "OfferDocumentSend" ADD COLUMN "bouncedAt" TIMESTAMP(3);
