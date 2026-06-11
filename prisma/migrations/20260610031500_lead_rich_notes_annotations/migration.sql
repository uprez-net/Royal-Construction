-- CreateEnum
CREATE TYPE "AnnotationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "notesDoc" JSONB;

-- CreateTable
CREATE TABLE "LeadNoteAnnotation" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER NOT NULL,
    "selectedText" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "mentionedUserIds" TEXT[],
    "status" "AnnotationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LeadNoteAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadNoteAnnotation_leadId_idx" ON "LeadNoteAnnotation"("leadId");

-- CreateIndex
CREATE INDEX "LeadNoteAnnotation_status_idx" ON "LeadNoteAnnotation"("status");

-- AddForeignKey
ALTER TABLE "LeadNoteAnnotation" ADD CONSTRAINT "LeadNoteAnnotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
