-- The surveyor/architect/council half of the compliance flow.
--
-- The certifier engagement is left exactly as it was: it keeps its own token,
-- contact and documents, and every existing row and code path against it is
-- untouched. What is added beside it is one outreach row per other party, the
-- alerts those parties raise, and a nullable column on the mail table so a
-- message can say which of the threads it belongs to.

-- CreateEnum
CREATE TYPE "CompliancePartyType" AS ENUM ('SURVEYOR', 'ARCHITECT', 'COUNCIL');

-- CreateEnum
CREATE TYPE "ComplianceOutreachMode" AS ENUM ('OUTREACH', 'SELF_SUPPLIED');

-- CreateEnum
CREATE TYPE "ComplianceOutreachStatus" AS ENUM ('NOT_SENT', 'SENT', 'RESPONSE_RECEIVED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ComplianceAlertType" AS ENUM ('STALE_TITLE_SEARCH', 'DA_APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "ComplianceAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
-- The deed the surveyor is sent to start work. Appended, so every stored value
-- keeps its position.
ALTER TYPE "ComplianceDocumentType" ADD VALUE 'LAND_DEED';

-- AlterTable
-- Nullable, and null means the certifier's thread: that is the only thread
-- that existed when these rows were written, so no backfill is needed.
ALTER TABLE "CertifierEmail" ADD COLUMN "outreachId" TEXT;

-- CreateTable
CREATE TABLE "ComplianceOutreach" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "party" "CompliancePartyType" NOT NULL,
    "refToken" TEXT NOT NULL,
    "mode" "ComplianceOutreachMode" NOT NULL DEFAULT 'OUTREACH',
    "status" "ComplianceOutreachStatus" NOT NULL DEFAULT 'NOT_SENT',
    "tradieId" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "lastInboundMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceOutreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAlert" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "type" "ComplianceAlertType" NOT NULL,
    "status" "ComplianceAlertStatus" NOT NULL DEFAULT 'OPEN',
    "raisedByParty" "CompliancePartyType",
    "detail" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceOutreach_refToken_key" ON "ComplianceOutreach"("refToken");

-- CreateIndex
CREATE INDEX "ComplianceOutreach_engagementId_idx" ON "ComplianceOutreach"("engagementId");

-- CreateIndex
CREATE INDEX "ComplianceOutreach_status_idx" ON "ComplianceOutreach"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceOutreach_engagementId_party_key" ON "ComplianceOutreach"("engagementId", "party");

-- CreateIndex
CREATE INDEX "ComplianceAlert_engagementId_idx" ON "ComplianceAlert"("engagementId");

-- CreateIndex
CREATE INDEX "ComplianceAlert_engagementId_status_idx" ON "ComplianceAlert"("engagementId", "status");

-- CreateIndex
CREATE INDEX "CertifierEmail_outreachId_sentAt_idx" ON "CertifierEmail"("outreachId", "sentAt" DESC);

-- AddForeignKey
ALTER TABLE "CertifierEmail" ADD CONSTRAINT "CertifierEmail_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "ComplianceOutreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceOutreach" ADD CONSTRAINT "ComplianceOutreach_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "CertifierEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceOutreach" ADD CONSTRAINT "ComplianceOutreach_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAlert" ADD CONSTRAINT "ComplianceAlert_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "CertifierEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAlert" ADD CONSTRAINT "ComplianceAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
