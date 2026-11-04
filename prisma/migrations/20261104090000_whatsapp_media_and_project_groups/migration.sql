-- WhatsApp media in Blob storage, and a WhatsApp group per project.
--
-- Additive only: new enums, new tables, one nullable column and enum values.
-- No existing row is rewritten.

-- CreateEnum
CREATE TYPE "WhatsAppMediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER');

-- CreateEnum
CREATE TYPE "WhatsAppMediaStatus" AS ENUM ('PENDING', 'STORED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectWhatsAppGroupStatus" AS ENUM ('CREATING', 'ACTIVE', 'FAILED', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProjectWhatsAppGroupOrigin" AS ENUM ('CREATED', 'LINKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboxEventKind" ADD VALUE 'PROJECT_WHATSAPP_GROUP_CREATE';
ALTER TYPE "OutboxEventKind" ADD VALUE 'PROJECT_WHATSAPP_SEND';
ALTER TYPE "OutboxEventKind" ADD VALUE 'PROJECT_WHATSAPP_INVITE_SEND';

-- AlterEnum
ALTER TYPE "WhatsAppMessageKind" ADD VALUE 'MEDIA';

-- AlterEnum
ALTER TYPE "WhatsAppUnmatchedReason" ADD VALUE 'UNLINKED_GROUP';

-- AlterTable
ALTER TABLE "WhatsAppUnmatchedMessage" ADD COLUMN     "providerGroupId" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppMedia" (
    "id" TEXT NOT NULL,
    "providerMediaId" TEXT NOT NULL,
    "type" "WhatsAppMediaType" NOT NULL,
    "mimeType" TEXT,
    "sha256" TEXT,
    "fileName" TEXT,
    "caption" TEXT,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "byteSize" INTEGER,
    "status" "WhatsAppMediaStatus" NOT NULL DEFAULT 'PENDING',
    "blobUrl" TEXT,
    "blobPathname" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "storedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadMessageId" TEXT,
    "projectMessageId" TEXT,
    "unmatchedMessageId" TEXT,

    CONSTRAINT "WhatsAppMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWhatsAppGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "businessPhoneNumberId" TEXT NOT NULL,
    "businessDisplayNumber" TEXT NOT NULL,
    "providerGroupId" TEXT,
    "createRequestId" TEXT,
    "subject" TEXT NOT NULL,
    "inviteLink" TEXT,
    "inviteLinkAt" TIMESTAMP(3),
    "status" "ProjectWhatsAppGroupStatus" NOT NULL,
    "origin" "ProjectWhatsAppGroupOrigin" NOT NULL,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWhatsAppGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWhatsAppParticipant" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "phoneE164" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWhatsAppParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWhatsAppMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "kind" "WhatsAppMessageKind" NOT NULL,
    "body" TEXT NOT NULL,
    "senderWaId" TEXT,
    "senderPhoneE164" TEXT,
    "senderName" TEXT,
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

    CONSTRAINT "ProjectWhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMedia_leadMessageId_key" ON "WhatsAppMedia"("leadMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMedia_projectMessageId_key" ON "WhatsAppMedia"("projectMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMedia_unmatchedMessageId_key" ON "WhatsAppMedia"("unmatchedMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMedia_status_createdAt_idx" ON "WhatsAppMedia"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWhatsAppGroup_projectId_key" ON "ProjectWhatsAppGroup"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWhatsAppGroup_providerGroupId_key" ON "ProjectWhatsAppGroup"("providerGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWhatsAppGroup_createRequestId_key" ON "ProjectWhatsAppGroup"("createRequestId");

-- CreateIndex
CREATE INDEX "ProjectWhatsAppGroup_status_requestedAt_idx" ON "ProjectWhatsAppGroup"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWhatsAppParticipant_groupId_waId_key" ON "ProjectWhatsAppParticipant"("groupId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWhatsAppMessage_providerMessageId_key" ON "ProjectWhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWhatsAppMessage_idempotencyKey_key" ON "ProjectWhatsAppMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectWhatsAppMessage_groupId_occurredAt_idx" ON "ProjectWhatsAppMessage"("groupId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectWhatsAppMessage_projectId_occurredAt_idx" ON "ProjectWhatsAppMessage"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppUnmatchedMessage_providerGroupId_status_idx" ON "WhatsAppUnmatchedMessage"("providerGroupId", "status");

-- AddForeignKey
ALTER TABLE "WhatsAppMedia" ADD CONSTRAINT "WhatsAppMedia_leadMessageId_fkey" FOREIGN KEY ("leadMessageId") REFERENCES "LeadWhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMedia" ADD CONSTRAINT "WhatsAppMedia_projectMessageId_fkey" FOREIGN KEY ("projectMessageId") REFERENCES "ProjectWhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMedia" ADD CONSTRAINT "WhatsAppMedia_unmatchedMessageId_fkey" FOREIGN KEY ("unmatchedMessageId") REFERENCES "WhatsAppUnmatchedMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWhatsAppGroup" ADD CONSTRAINT "ProjectWhatsAppGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWhatsAppGroup" ADD CONSTRAINT "ProjectWhatsAppGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWhatsAppParticipant" ADD CONSTRAINT "ProjectWhatsAppParticipant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectWhatsAppGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWhatsAppMessage" ADD CONSTRAINT "ProjectWhatsAppMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectWhatsAppGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWhatsAppMessage" ADD CONSTRAINT "ProjectWhatsAppMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A media row belongs to exactly one message: a lead's, a project group's, or
-- one still waiting in the unmatched review queue.
ALTER TABLE "WhatsAppMedia" ADD CONSTRAINT "WhatsAppMedia_one_message_check"
  CHECK (num_nonnulls("leadMessageId", "projectMessageId", "unmatchedMessageId") = 1);
