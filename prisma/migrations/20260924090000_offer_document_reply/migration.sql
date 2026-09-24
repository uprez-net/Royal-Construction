-- CreateTable
CREATE TABLE "OfferDocumentReply" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferDocumentReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferDocumentReply_graphMessageId_key" ON "OfferDocumentReply"("graphMessageId");

-- CreateIndex
CREATE INDEX "OfferDocumentReply_sendId_receivedAt_idx" ON "OfferDocumentReply"("sendId", "receivedAt");

-- AddForeignKey
ALTER TABLE "OfferDocumentReply" ADD CONSTRAINT "OfferDocumentReply_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "OfferDocumentSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
