-- Pending calls/messages: which inbound calls have been seen, and which
-- unmatched ones were dismissed. Call recordings gain a speech-to-text
-- transcript; existing stored recordings start PENDING so the comms sweep
-- transcribes them.

-- CreateEnum
CREATE TYPE "CallTranscriptStatus" AS ENUM ('PENDING', 'DONE', 'EMPTY', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "dismissedById" TEXT,
ADD COLUMN     "seenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CallRecording" ADD COLUMN     "transcribedAt" TIMESTAMP(3),
ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transcriptFailure" TEXT,
ADD COLUMN     "transcriptStatus" "CallTranscriptStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Call_direction_leadId_dismissedAt_idx" ON "Call"("direction", "leadId", "dismissedAt");

-- CreateIndex
CREATE INDEX "CallRecording_status_transcriptStatus_idx" ON "CallRecording"("status", "transcriptStatus");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

