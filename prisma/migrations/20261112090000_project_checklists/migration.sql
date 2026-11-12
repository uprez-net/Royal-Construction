-- Project checklists (issue #420): six stage checklists per project, the
-- handover inspection rows, defects raised against them, their history,
-- signatures and downloaded documents.

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChecklistItemState" AS ENUM ('UNCHECKED', 'CHECKED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ChecklistIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ChecklistNotificationStatus" AS ENUM ('NOT_SENT', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ChecklistIssueEventKind" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'COMMENT', 'EMAIL_SENT', 'EMAIL_FAILED', 'EVIDENCE_ADDED');

-- CreateEnum
CREATE TYPE "ChecklistSignaturePurpose" AS ENUM ('CHECKLIST_CLOSURE', 'ISSUE_VERIFICATION', 'EXPORT');

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'CHECKLIST_ISSUE_EMAIL_SEND';

-- CreateTable
CREATE TABLE "ProjectChecklist" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "stage" "ProjectStage" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "comments" TEXT,
    "checkedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "sectionOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "state" "ChecklistItemState" NOT NULL DEFAULT 'UNCHECKED',
    "naReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistAttachment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "issueId" TEXT,
    "fileId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistIssue" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "comments" TEXT,
    "status" "ChecklistIssueStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTradieId" TEXT,
    "requestKey" TEXT,
    "notificationStatus" "ChecklistNotificationStatus" NOT NULL DEFAULT 'NOT_SENT',
    "notificationError" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "notifiedTo" TEXT,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verificationNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistIssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "ChecklistIssueEventKind" NOT NULL,
    "fromStatus" "ChecklistIssueStatus",
    "toStatus" "ChecklistIssueStatus",
    "note" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistSignature" (
    "id" TEXT NOT NULL,
    "purpose" "ChecklistSignaturePurpose" NOT NULL,
    "checklistId" TEXT,
    "issueId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "imageDataUrl" TEXT NOT NULL,
    "signedById" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistExport" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "final" BOOLEAN NOT NULL,
    "statusAtExport" "ChecklistStatus" NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "signatureId" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectChecklist_projectId_idx" ON "ProjectChecklist"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChecklist_projectId_number_key" ON "ProjectChecklist"("projectId", "number");

-- CreateIndex
CREATE INDEX "ChecklistItem_checklistId_order_idx" ON "ChecklistItem"("checklistId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_checklistId_key_key" ON "ChecklistItem"("checklistId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistAttachment_fileId_key" ON "ChecklistAttachment"("fileId");

-- CreateIndex
CREATE INDEX "ChecklistAttachment_itemId_idx" ON "ChecklistAttachment"("itemId");

-- CreateIndex
CREATE INDEX "ChecklistAttachment_issueId_idx" ON "ChecklistAttachment"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistIssue_requestKey_key" ON "ChecklistIssue"("requestKey");

-- CreateIndex
CREATE INDEX "ChecklistIssue_checklistId_status_idx" ON "ChecklistIssue"("checklistId", "status");

-- CreateIndex
CREATE INDEX "ChecklistIssue_itemId_idx" ON "ChecklistIssue"("itemId");

-- CreateIndex
CREATE INDEX "ChecklistIssue_assignedTradieId_idx" ON "ChecklistIssue"("assignedTradieId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistIssue_checklistId_number_key" ON "ChecklistIssue"("checklistId", "number");

-- CreateIndex
CREATE INDEX "ChecklistIssueEvent_issueId_createdAt_idx" ON "ChecklistIssueEvent"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "ChecklistSignature_checklistId_idx" ON "ChecklistSignature"("checklistId");

-- CreateIndex
CREATE INDEX "ChecklistSignature_issueId_idx" ON "ChecklistSignature"("issueId");

-- CreateIndex
CREATE INDEX "ChecklistExport_checklistId_generatedAt_idx" ON "ChecklistExport"("checklistId", "generatedAt");

-- AddForeignKey
ALTER TABLE "ProjectChecklist" ADD CONSTRAINT "ProjectChecklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "ProjectChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAttachment" ADD CONSTRAINT "ChecklistAttachment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAttachment" ADD CONSTRAINT "ChecklistAttachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ChecklistIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAttachment" ADD CONSTRAINT "ChecklistAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistIssue" ADD CONSTRAINT "ChecklistIssue_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "ProjectChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistIssue" ADD CONSTRAINT "ChecklistIssue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistIssue" ADD CONSTRAINT "ChecklistIssue_assignedTradieId_fkey" FOREIGN KEY ("assignedTradieId") REFERENCES "Tradie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistIssueEvent" ADD CONSTRAINT "ChecklistIssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ChecklistIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistSignature" ADD CONSTRAINT "ChecklistSignature_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "ProjectChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistSignature" ADD CONSTRAINT "ChecklistSignature_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ChecklistIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistExport" ADD CONSTRAINT "ChecklistExport_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "ProjectChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistExport" ADD CONSTRAINT "ChecklistExport_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "ChecklistSignature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

