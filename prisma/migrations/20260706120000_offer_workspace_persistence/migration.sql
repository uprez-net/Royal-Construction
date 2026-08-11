-- Offer workspace persistence (ADR 0002).
-- Structural changes only. The ACCEPTED -> AGREED data update lives in the
-- next migration, because a newly ADDed enum value cannot be USED in the
-- same transaction that adds it.

-- CreateEnum
CREATE TYPE "EnvelopeDocType" AS ENUM ('TENDER', 'CONTRACT');

-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('CREATED', 'SENT', 'DELIVERED', 'COMPLETED', 'VOIDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('BUILDER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SignerStatus" AS ENUM ('CREATED', 'SENT', 'DELIVERED', 'SIGNED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OfferStatus" ADD VALUE 'AGREED';
ALTER TYPE "OfferStatus" ADD VALUE 'TENDER_DRAFT';
ALTER TYPE "OfferStatus" ADD VALUE 'TENDER_SENT';
ALTER TYPE "OfferStatus" ADD VALUE 'TENDER_SIGNED';
ALTER TYPE "OfferStatus" ADD VALUE 'CONTRACT_DRAFT';
ALTER TYPE "OfferStatus" ADD VALUE 'CONTRACT_SENT';
ALTER TYPE "OfferStatus" ADD VALUE 'CONTRACT_SIGNED';
ALTER TYPE "OfferStatus" ADD VALUE 'PROJECT';
ALTER TYPE "OfferStatus" ADD VALUE 'SUPERSEDED';

-- DropIndex
DROP INDEX "Offer_leadId_key";

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "agreedSnapshot" JSONB,
ADD COLUMN     "baseReference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contractValueIncGst" DECIMAL(12,2),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "revisionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stateVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supersededById" TEXT,
ADD COLUMN     "workspaceState" JSONB;

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "documentData" JSONB NOT NULL,
    "executedPdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "documentData" JSONB NOT NULL,
    "executedPdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "docType" "EnvelopeDocType" NOT NULL,
    "tenderId" TEXT,
    "contractId" TEXT,
    "docusignId" TEXT,
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'CREATED',
    "documentVersion" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeSignature" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientRole" "SignerRole" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "routingOrder" INTEGER NOT NULL,
    "status" "SignerStatus" NOT NULL DEFAULT 'CREATED',
    "signedAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "docusignRecipientId" TEXT,

    CONSTRAINT "EnvelopeSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferDocumentSend" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerFileVersion" INTEGER NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "trackedLinkToken" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "OfferDocumentSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferStatusEvent" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "fromStatus" "OfferStatus",
    "toStatus" "OfferStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferReferenceCounter" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferReferenceCounter_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tender_offerId_key" ON "Tender"("offerId");

-- CreateIndex
CREATE INDEX "Tender_offerId_idx" ON "Tender"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_offerId_key" ON "Contract"("offerId");

-- CreateIndex
CREATE INDEX "Contract_offerId_idx" ON "Contract"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_docusignId_key" ON "Envelope"("docusignId");

-- CreateIndex
CREATE INDEX "Envelope_tenderId_idx" ON "Envelope"("tenderId");

-- CreateIndex
CREATE INDEX "Envelope_contractId_idx" ON "Envelope"("contractId");

-- CreateIndex
CREATE INDEX "Envelope_status_idx" ON "Envelope"("status");

-- CreateIndex
CREATE INDEX "EnvelopeSignature_envelopeId_idx" ON "EnvelopeSignature"("envelopeId");

-- CreateIndex
CREATE INDEX "EnvelopeSignature_status_idx" ON "EnvelopeSignature"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OfferDocumentSend_trackedLinkToken_key" ON "OfferDocumentSend"("trackedLinkToken");

-- CreateIndex
CREATE INDEX "OfferDocumentSend_offerId_idx" ON "OfferDocumentSend"("offerId");

-- CreateIndex
CREATE INDEX "OfferStatusEvent_offerId_idx" ON "OfferStatusEvent"("offerId");

-- CreateIndex
CREATE INDEX "OfferStatusEvent_at_idx" ON "OfferStatusEvent"("at");

-- CreateIndex
CREATE INDEX "Offer_isActive_idx" ON "Offer"("isActive");

-- CreateIndex
CREATE INDEX "Offer_baseReference_idx" ON "Offer"("baseReference");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeSignature" ADD CONSTRAINT "EnvelopeSignature_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferDocumentSend" ADD CONSTRAINT "OfferDocumentSend_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferStatusEvent" ADD CONSTRAINT "OfferStatusEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One active Offer per Lead: partial unique index (Prisma cannot express a
-- filtered unique in the schema, so it is created here by hand).
CREATE UNIQUE INDEX "Offer_leadId_active_key" ON "Offer"("leadId") WHERE "isActive";
