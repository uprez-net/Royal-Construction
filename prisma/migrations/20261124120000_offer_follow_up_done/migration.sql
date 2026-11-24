-- Marking an offer's follow-up done without emailing from the app: a phone
-- call, a text, a word on site. One row per press. Additive only; an offer
-- with no row behaves exactly as before.

-- CreateTable
CREATE TABLE "OfferFollowUpDone" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneById" TEXT,

    CONSTRAINT "OfferFollowUpDone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferFollowUpDone_offerId_doneAt_idx" ON "OfferFollowUpDone"("offerId", "doneAt");

-- AddForeignKey
ALTER TABLE "OfferFollowUpDone" ADD CONSTRAINT "OfferFollowUpDone_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferFollowUpDone" ADD CONSTRAINT "OfferFollowUpDone_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
