-- CreateTable
CREATE TABLE "WhatsAppCallPermissionReplyEvent" (
    "providerMessageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppCallPermissionReplyEvent_pkey" PRIMARY KEY ("providerMessageId")
);

-- CreateIndex
CREATE INDEX "WhatsAppCallPermissionReplyEvent_receivedAt_idx" ON "WhatsAppCallPermissionReplyEvent"("receivedAt");
