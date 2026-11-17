-- Mili answers inbound callers from Royal's records, scoped to who the
-- carrier-provided number resolves to (issue #528). Every resolution, briefing
-- and lookup leaves one metadata-only row here: the class, how the caller was
-- identified, the query's name and the ids it read. No contents, no numbers.

-- CreateEnum
CREATE TYPE "VoiceCallerClass" AS ENUM ('ADMIN', 'SITE_MANAGER', 'CLIENT', 'TRADIE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallerAccessKind" AS ENUM ('RESOLVED', 'BRIEFING', 'LOOKUP', 'REFUSED');

-- CreateTable
CREATE TABLE "CallerAccessEvent" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "kind" "CallerAccessKind" NOT NULL,
    "callerClass" "VoiceCallerClass" NOT NULL,
    "verification" TEXT,
    "outcome" TEXT NOT NULL,
    "queryName" TEXT,
    "recordIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallerAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallerAccessEvent_callId_createdAt_idx" ON "CallerAccessEvent"("callId", "createdAt");

-- AddForeignKey
ALTER TABLE "CallerAccessEvent" ADD CONSTRAINT "CallerAccessEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
