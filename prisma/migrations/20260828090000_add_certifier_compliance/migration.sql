-- CreateEnum
CREATE TYPE "CertifierEngagementStatus" AS ENUM ('NOT_STARTED', 'COLLECTING_DOCS', 'OUTREACH_SENT', 'AWAITING_RESPONSE', 'RESPONSE_RECEIVED', 'SIGNING', 'CHECKLIST_EXTRACTING', 'CHECKLIST_TRACKING', 'INSURANCE', 'IN_REVIEW', 'APPROVED');

-- CreateEnum
CREATE TYPE "ComplianceDocumentType" AS ENUM ('DEPOSITED_PLAN', 'TITLE_SEARCH_DETAIL_AND_LEVEL', 'SURVEY', 'PRELIMINARY_ARCHITECTURAL_PLANS', 'PLANNING_CERTIFICATE_10_7', 'FULL_ARCHITECTURAL_DESIGN', 'INVOICE', 'FEE_PROPOSAL', 'CDC_FORM', 'CHECKLIST', 'SIGNED_FEE_PROPOSAL', 'SIGNED_CDC_FORM', 'CHECKLIST_ITEM', 'HOME_INSURANCE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ComplianceDocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'RECEIVED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CertifierEmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "complianceDocumentId" TEXT;

-- CreateTable
CREATE TABLE "CertifierEngagement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "refToken" TEXT NOT NULL,
    "subjectAddress" TEXT NOT NULL,
    "certifierName" TEXT,
    "certifierEmail" TEXT,
    "certifierPhone" TEXT,
    "status" "CertifierEngagementStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertifierEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "documentType" "ComplianceDocumentType" NOT NULL,
    "status" "ComplianceDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "label" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertifierEmail" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "emailFrom" TEXT NOT NULL,
    "emailTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "direction" "CertifierEmailDirection" NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertifierEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertifierEngagement_projectId_key" ON "CertifierEngagement"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CertifierEngagement_refToken_key" ON "CertifierEngagement"("refToken");

-- CreateIndex
CREATE INDEX "CertifierEngagement_status_idx" ON "CertifierEngagement"("status");

-- CreateIndex
CREATE INDEX "ComplianceDocument_engagementId_idx" ON "ComplianceDocument"("engagementId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_engagementId_order_idx" ON "ComplianceDocument"("engagementId", "order");

-- CreateIndex
CREATE INDEX "ComplianceDocument_status_idx" ON "ComplianceDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CertifierEmail_checksum_key" ON "CertifierEmail"("checksum");

-- CreateIndex
CREATE INDEX "CertifierEmail_engagementId_idx" ON "CertifierEmail"("engagementId");

-- CreateIndex
CREATE INDEX "CertifierEmail_engagementId_sentAt_idx" ON "CertifierEmail"("engagementId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "File_complianceDocumentId_idx" ON "File"("complianceDocumentId");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_complianceDocumentId_fkey" FOREIGN KEY ("complianceDocumentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertifierEngagement" ADD CONSTRAINT "CertifierEngagement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "CertifierEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertifierEmail" ADD CONSTRAINT "CertifierEmail_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "CertifierEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
