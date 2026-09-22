-- WhatsApp Business outreach for leads (issue #333).
--
-- Additive only: new enums, new tables, nullable Lead columns and three enum
-- values. No existing row is rewritten here. `Lead.phoneE164` starts NULL for
-- every existing lead and is filled by `pnpm whatsapp:backfill-phones`, which
-- uses the same normaliser the app writes with (lib/domain/leads/whatsapp/
-- phone.ts) and reports numbers it cannot normalise or that several leads
-- share instead of guessing. Until it runs, an inbound message from an
-- existing lead lands in the unmatched review queue rather than being lost.
--
-- Postgres cannot use a value added by ALTER TYPE ... ADD VALUE inside the
-- same transaction, and nothing below does.


-- CreateEnum
CREATE TYPE "WhatsAppConsentSource" AS ENUM ('VERBAL', 'WRITTEN', 'WEB_FORM', 'CUSTOMER_INITIATED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppMessageKind" AS ENUM ('TEXT', 'TEMPLATE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "WhatsAppUnmatchedReason" AS ENUM ('NO_MATCH', 'AMBIGUOUS', 'UNKNOWN_BUSINESS_NUMBER');

-- CreateEnum
CREATE TYPE "WhatsAppUnmatchedStatus" AS ENUM ('PENDING', 'ATTACHED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "LeadTaskType" ADD VALUE 'WHATSAPP';

-- AlterEnum
ALTER TYPE "HistoryType" ADD VALUE 'WHATSAPP';

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'LEAD_WHATSAPP_SEND';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "phoneE164" TEXT,
ADD COLUMN     "whatsappConsentAt" TIMESTAMP(3),
ADD COLUMN     "whatsappConsentNote" TEXT,
ADD COLUMN     "whatsappConsentRecordedById" TEXT,
ADD COLUMN     "whatsappConsentSource" "WhatsAppConsentSource",
ADD COLUMN     "whatsappOptedOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadWhatsAppConversation" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER NOT NULL,
    "businessPhoneNumberId" TEXT NOT NULL,
    "businessDisplayNumber" TEXT NOT NULL,
    "customerPhoneE164" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "windowExpiresAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadWhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadWhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "leadId" INTEGER NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "kind" "WhatsAppMessageKind" NOT NULL,
    "body" TEXT NOT NULL,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "templateParameters" JSONB,
    "providerMessageId" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL,
    "statusAt" TIMESTAMP(3) NOT NULL,
    "providerErrorCode" TEXT,
    "providerErrorTitle" TEXT,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "authorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadWhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppStatusEvent" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppUnmatchedMessage" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "businessPhoneNumberId" TEXT NOT NULL,
    "fromPhoneE164" TEXT NOT NULL,
    "profileName" TEXT,
    "kind" "WhatsAppMessageKind" NOT NULL,
    "body" TEXT NOT NULL,
    "reason" "WhatsAppUnmatchedReason" NOT NULL,
    "candidateLeadIds" INTEGER[],
    "status" "WhatsAppUnmatchedStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedLeadId" INTEGER,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppUnmatchedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadWhatsAppConversation_customerPhoneE164_idx" ON "LeadWhatsAppConversation"("customerPhoneE164");

-- CreateIndex
CREATE INDEX "LeadWhatsAppConversation_leadId_lastMessageAt_idx" ON "LeadWhatsAppConversation"("leadId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadWhatsAppConversation_leadId_businessPhoneNumberId_custo_key" ON "LeadWhatsAppConversation"("leadId", "businessPhoneNumberId", "customerPhoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "LeadWhatsAppMessage_providerMessageId_key" ON "LeadWhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadWhatsAppMessage_idempotencyKey_key" ON "LeadWhatsAppMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LeadWhatsAppMessage_conversationId_occurredAt_idx" ON "LeadWhatsAppMessage"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadWhatsAppMessage_leadId_occurredAt_idx" ON "LeadWhatsAppMessage"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadWhatsAppMessage_status_idx" ON "LeadWhatsAppMessage"("status");

-- CreateIndex
CREATE INDEX "WhatsAppStatusEvent_appliedAt_idx" ON "WhatsAppStatusEvent"("appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppStatusEvent_providerMessageId_status_key" ON "WhatsAppStatusEvent"("providerMessageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppUnmatchedMessage_providerMessageId_key" ON "WhatsAppUnmatchedMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppUnmatchedMessage_status_receivedAt_idx" ON "WhatsAppUnmatchedMessage"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WhatsAppUnmatchedMessage_fromPhoneE164_idx" ON "WhatsAppUnmatchedMessage"("fromPhoneE164");

-- CreateIndex
CREATE INDEX "Lead_phoneE164_idx" ON "Lead"("phoneE164");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_whatsappConsentRecordedById_fkey" FOREIGN KEY ("whatsappConsentRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWhatsAppConversation" ADD CONSTRAINT "LeadWhatsAppConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWhatsAppMessage" ADD CONSTRAINT "LeadWhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LeadWhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWhatsAppMessage" ADD CONSTRAINT "LeadWhatsAppMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWhatsAppMessage" ADD CONSTRAINT "LeadWhatsAppMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppUnmatchedMessage" ADD CONSTRAINT "WhatsAppUnmatchedMessage_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

