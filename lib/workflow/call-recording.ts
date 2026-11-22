import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { FatalError, RetryableError, getStepMetadata } from "workflow";

import { vercelRecordingBlobPut } from "@/lib/blob-port";
import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import {
  gatewayCallTranscription,
  gatewayTranscriptSpeakers,
} from "@/lib/comms/transcription";
import { storeCallRecording } from "@/lib/domain/comms/calls/recordings";
import { transcribeCallRecording } from "@/lib/domain/comms/calls/transcripts";
import { DomainSideEffectError, isDomainError } from "@/lib/domain/errors";
import { markReported, wasReported } from "@/lib/observability/filter";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";

/**
 * Copies call recordings and voicemails off the carrier into Blob storage,
 * deletes the carrier's copy, then transcribes ours.
 *
 * Started by the webhook once a recording is on record, and by the daily
 * comms sweep for anything still pending. Each recording is its own step; a
 * replayed step finds it STORED and only retries the carrier-side delete.
 * Transcribing is a step of its own, so a model outage never re-downloads a
 * recording, and a recording that fails to transcribe is still kept. The
 * domain (lib/domain/comms/calls/recordings.ts, transcripts.ts) decides; this
 * drives it.
 */

async function storeOne(recordingId: string): Promise<string> {
  "use step";
  const runtime = commsRuntimeFromEnv();
  try {
    return await storeCallRecording(
      systemPrincipal("workflow:call-recording"),
      { recordingId },
      prisma,
      { put: vercelRecordingBlobPut, recordingsFor: runtime.recordingsFor },
    );
  } catch (error) {
    // The step's own error is deliberately plain; the cause is what someone
    // fixing it needs, so it goes to the log.
    console.error(
      `[call-recording] storing recording ${recordingId} failed:`,
      error instanceof Error ? error.message : error,
    );
    if (error instanceof DomainSideEffectError && error.retryable) {
      const { attempt } = getStepMetadata();
      throw new RetryableError(error.message, {
        retryAfter: Math.min(15_000 * attempt ** 2, 5 * 60_000),
      });
    }
    throw new FatalError(
      isDomainError(error) ? error.message : "Storing a call recording failed.",
    );
  }
}
// Five attempts in all, matching MAX_RECORDING_ATTEMPTS in the domain. A
// literal on purpose: reading the constant would pull the domain module — and
// @prisma/client — into the workflow sandbox (tests/comms/recording-workflow).
storeOne.maxRetries = 4;

async function transcribeOne(recordingId: string): Promise<string> {
  "use step";
  try {
    return await transcribeCallRecording(
      systemPrincipal("workflow:call-recording"),
      { recordingId },
      prisma,
      {
        speakers: gatewayTranscriptSpeakers,
        transcribe: gatewayCallTranscription,
      },
    );
  } catch (error) {
    // A model failure was already reported by the wrapped gateway (vendor ai,
    // operation transcribe). Marked here too, and the error object logged, so
    // console capture recognises it and the log line is not a second event.
    // Anything else (the stored copy unreadable) is reported by this line.
    if (error instanceof Error && wasReported(error.cause)) {
      markReported(error);
    }
    console.error(
      `[call-recording] transcribing recording ${recordingId} failed:`,
      error,
    );
    if (error instanceof DomainSideEffectError && error.retryable) {
      const { attempt } = getStepMetadata();
      throw new RetryableError(error.message, {
        retryAfter: Math.min(30_000 * attempt ** 2, 5 * 60_000),
      });
    }
    throw new FatalError(
      isDomainError(error)
        ? error.message
        : "Transcribing a call recording failed.",
    );
  }
}
// Three attempts in all, matching MAX_TRANSCRIPT_ATTEMPTS in the domain; a
// literal for the same sandbox reason as storeOne's.
transcribeOne.maxRetries = 2;

export const storeCallRecordings = async (
  recordingIds: string[],
): Promise<string[]> => {
  "use workflow";
  try {
    return await runStoreCallRecordings(recordingIds);
  } catch (error) {
    await reportWorkflowError("storeCallRecordings", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runStoreCallRecordings = async (
  recordingIds: string[],
): Promise<string[]> => {
  const outcomes: string[] = [];
  for (const recordingId of recordingIds) {
    let stored: string;
    try {
      stored = await storeOne(recordingId);
    } catch {
      outcomes.push("error");
      continue;
    }
    // A recording that was never kept has nothing to transcribe.
    if (stored === "gave_up") {
      outcomes.push(stored);
      continue;
    }
    let transcript: string;
    try {
      transcript = await transcribeOne(recordingId);
    } catch {
      transcript = "error";
    }
    outcomes.push(`${stored}; transcript ${transcript}`);
  }
  return outcomes;
};
