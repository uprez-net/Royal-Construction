-- Reply tracking for offer document sends (correlated via the [RCOFR-…] token).
ALTER TABLE "OfferDocumentSend" ADD COLUMN "repliedAt" TIMESTAMP(3);
ALTER TABLE "OfferDocumentSend" ADD COLUMN "lastReplyAt" TIMESTAMP(3);
