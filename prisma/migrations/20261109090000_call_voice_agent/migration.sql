-- Inbound calls are answered by Mili, the voice agent (docs/comms-runbook.md).
ALTER TYPE "CallFlowStep" ADD VALUE 'AGENT';
ALTER TYPE "CallAnsweredBy" ADD VALUE 'AGENT';
ALTER TYPE "RecordingConsent" ADD VALUE 'DECLARED';

ALTER TABLE "Call" ADD COLUMN "agentTranscript" TEXT;
