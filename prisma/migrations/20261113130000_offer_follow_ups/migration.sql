-- Offer follow-ups (issue #449): one row per follow-up email the office sent a
-- client about an offer still waiting on them, and the outbox kind that sends
-- it once.

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'OFFER_FOLLOW_UP_SEND';

-- CreateTable
CREATE TABLE "OfferFollowUp" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attemptKey" TEXT NOT NULL,

    CONSTRAINT "OfferFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferFollowUp_attemptKey_key" ON "OfferFollowUp"("attemptKey");

-- CreateIndex
CREATE INDEX "OfferFollowUp_offerId_sentAt_idx" ON "OfferFollowUp"("offerId", "sentAt");

-- AddForeignKey
ALTER TABLE "OfferFollowUp" ADD CONSTRAINT "OfferFollowUp_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferFollowUp" ADD CONSTRAINT "OfferFollowUp_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
