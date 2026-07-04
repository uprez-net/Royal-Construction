-- CreateTable
CREATE TABLE "LeadEmails" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER NOT NULL,
    "emailFrom" TEXT NOT NULL,
    "emailTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEmails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadEmails_checksum_key" ON "LeadEmails"("checksum");

-- CreateIndex
CREATE INDEX "LeadEmails_leadId_idx" ON "LeadEmails"("leadId");

-- CreateIndex
CREATE INDEX "LeadEmails_emailFrom_idx" ON "LeadEmails"("emailFrom");

-- CreateIndex
CREATE INDEX "LeadEmails_leadId_sentAt_idx" ON "LeadEmails"("leadId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "LeadEmails_sentAt_idx" ON "LeadEmails"("sentAt" DESC);

-- AddForeignKey
ALTER TABLE "LeadEmails" ADD CONSTRAINT "LeadEmails_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
