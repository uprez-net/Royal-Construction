-- SMS and phone calls through Twilio or Telnyx, and WhatsApp calling.
--
-- Additive only: new enums, new tables, two nullable columns and enum values.
-- No existing row is rewritten.

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'LEAD_SMS_SEND';
ALTER TYPE "OutboxEventKind" ADD VALUE 'LEAD_CALL_PLACE';
ALTER TYPE "OutboxEventKind" ADD VALUE 'WHATSAPP_CALL_PERMISSION_REQUEST';
ALTER TYPE "OutboxEventKind" ADD VALUE 'WHATSAPP_CALL_CONNECT';

-- AlterEnum
ALTER TYPE "HistoryType" ADD VALUE 'SMS';

-- CreateEnum
CREATE TYPE "CommsProvider" AS ENUM ('TWILIO', 'TELNYX');

-- CreateEnum
CREATE TYPE "CommsDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "SmsUnmatchedReason" AS ENUM ('NO_MATCH', 'AMBIGUOUS', 'UNKNOWN_BUSINESS_NUMBER');

-- CreateEnum
CREATE TYPE "SmsReviewStatus" AS ENUM ('PENDING', 'ATTACHED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CallFlowStep" AS ENUM ('DIALING_CUSTOMER', 'RECORDING_CONSENT', 'RINGING_BROWSER', 'RINGING_MOBILE', 'CONNECTED', 'VOICEMAIL', 'ENDED');

-- CreateEnum
CREATE TYPE "CallStaffTarget" AS ENUM ('BROWSER', 'MOBILE');

-- CreateEnum
CREATE TYPE "CallAnsweredBy" AS ENUM ('BROWSER', 'MOBILE', 'VOICEMAIL');

-- CreateEnum
CREATE TYPE "RecordingConsent" AS ENUM ('NOT_ASKED', 'GRANTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CallRecordingKind" AS ENUM ('CALL', 'VOICEMAIL');

-- CreateEnum
CREATE TYPE "CallRecordingStatus" AS ENUM ('PENDING', 'STORED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppCallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'COMPLETED', 'REJECTED', 'MISSED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppCallPermissionStatus" AS ENUM ('REQUESTED', 'GRANTED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "commsBrowserSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "smsOptedOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER,
    "direction" "CommsDirection" NOT NULL,
    "provider" "CommsProvider" NOT NULL,
    "businessNumber" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "status" "SmsStatus" NOT NULL,
    "statusAt" TIMESTAMP(3) NOT NULL,
    "providerErrorCode" TEXT,
    "providerErrorTitle" TEXT,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "authorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "unmatchedReason" "SmsUnmatchedReason",
    "reviewStatus" "SmsReviewStatus",
    "candidateLeadIds" INTEGER[],
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsStatusEvent" (
    "id" TEXT NOT NULL,
    "provider" "CommsProvider" NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "provider" "CommsProvider" NOT NULL,
    "direction" "CommsDirection" NOT NULL,
    "leadId" INTEGER,
    "candidateLeadIds" INTEGER[],
    "businessNumber" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "providerCallId" TEXT,
    "status" "CallStatus" NOT NULL,
    "flowStep" "CallFlowStep" NOT NULL,
    "staffTarget" "CallStaffTarget",
    "staffUserId" TEXT,
    "answeredBy" "CallAnsweredBy",
    "recordingConsent" "RecordingConsent" NOT NULL DEFAULT 'NOT_ASKED',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "hangupCause" TEXT,
    "providerErrorCode" TEXT,
    "providerErrorTitle" TEXT,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecording" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "provider" "CommsProvider" NOT NULL,
    "kind" "CallRecordingKind" NOT NULL,
    "providerRecordingId" TEXT NOT NULL,
    "status" "CallRecordingStatus" NOT NULL DEFAULT 'PENDING',
    "durationSeconds" INTEGER,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "blobUrl" TEXT,
    "blobPathname" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "storedAt" TIMESTAMP(3),
    "providerDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "CommsProvider" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CommsWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCall" (
    "id" TEXT NOT NULL,
    "providerCallId" TEXT,
    "direction" "CommsDirection" NOT NULL,
    "leadId" INTEGER,
    "businessPhoneNumberId" TEXT NOT NULL,
    "businessDisplayNumber" TEXT NOT NULL,
    "customerPhoneE164" TEXT NOT NULL,
    "status" "WhatsAppCallStatus" NOT NULL,
    "remoteSdp" TEXT,
    "staffUserId" TEXT,
    "idempotencyKey" TEXT,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCallPermission" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER,
    "businessPhoneNumberId" TEXT NOT NULL,
    "customerPhoneE164" TEXT NOT NULL,
    "status" "WhatsAppCallPermissionStatus" NOT NULL,
    "permanent" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3)[],
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppCallPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_idempotencyKey_key" ON "SmsMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SmsMessage_leadId_occurredAt_idx" ON "SmsMessage"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "SmsMessage_reviewStatus_occurredAt_idx" ON "SmsMessage"("reviewStatus", "occurredAt");

-- CreateIndex
CREATE INDEX "SmsMessage_customerNumber_idx" ON "SmsMessage"("customerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_provider_providerMessageId_key" ON "SmsMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "SmsStatusEvent_appliedAt_idx" ON "SmsStatusEvent"("appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsStatusEvent_provider_providerMessageId_status_key" ON "SmsStatusEvent"("provider", "providerMessageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Call_idempotencyKey_key" ON "Call"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Call_leadId_startedAt_idx" ON "Call"("leadId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_status_startedAt_idx" ON "Call"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_provider_providerCallId_key" ON "Call"("provider", "providerCallId");

-- CreateIndex
CREATE INDEX "CallRecording_status_createdAt_idx" ON "CallRecording"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecording_provider_providerRecordingId_key" ON "CallRecording"("provider", "providerRecordingId");

-- CreateIndex
CREATE INDEX "CommsWebhookEvent_receivedAt_idx" ON "CommsWebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommsWebhookEvent_provider_dedupeKey_key" ON "CommsWebhookEvent"("provider", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCall_providerCallId_key" ON "WhatsAppCall"("providerCallId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCall_idempotencyKey_key" ON "WhatsAppCall"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppCall_status_startedAt_idx" ON "WhatsAppCall"("status", "startedAt");

-- CreateIndex
CREATE INDEX "WhatsAppCall_leadId_startedAt_idx" ON "WhatsAppCall"("leadId", "startedAt");

-- CreateIndex
CREATE INDEX "WhatsAppCallPermission_leadId_idx" ON "WhatsAppCallPermission"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCallPermission_businessPhoneNumberId_customerPhoneE_key" ON "WhatsAppCallPermission"("businessPhoneNumberId", "customerPhoneE164");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCall" ADD CONSTRAINT "WhatsAppCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCall" ADD CONSTRAINT "WhatsAppCall_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCallPermission" ADD CONSTRAINT "WhatsAppCallPermission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

