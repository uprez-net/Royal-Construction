-- CreateTable
CREATE TABLE "UnconfirmedEnvelopeSend" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "docType" "EnvelopeDocType" NOT NULL,
    "sendAttemptId" TEXT NOT NULL,
    "attemptStartedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "foundDocusignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnconfirmedEnvelopeSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnconfirmedEnvelopeSend_sendAttemptId_key" ON "UnconfirmedEnvelopeSend"("sendAttemptId");

-- CreateIndex
CREATE INDEX "UnconfirmedEnvelopeSend_offerId_idx" ON "UnconfirmedEnvelopeSend"("offerId");

-- CreateIndex
CREATE INDEX "UnconfirmedEnvelopeSend_resolvedAt_idx" ON "UnconfirmedEnvelopeSend"("resolvedAt");

-- AddForeignKey
ALTER TABLE "UnconfirmedEnvelopeSend" ADD CONSTRAINT "UnconfirmedEnvelopeSend_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
