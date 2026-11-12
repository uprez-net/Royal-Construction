import { FatalError, RetryableError, getStepMetadata } from "workflow";

import { vercelRecordingBlobPut } from "@/lib/blob-port";
import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { storeCallRecording } from "@/lib/domain/comms/calls/recordings";
import { DomainSideEffectError, isDomainError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";

/**
 * Copies call recordings and voicemails off the carrier into Blob storage,
 * then deletes the carrier's copy.
 *
 * Started by the webhook once a recording is on record, and by the daily
 * comms sweep for anything still pending. Each recording is its own step; a
 * replayed step finds it STORED and only retries the carrier-side delete. The
 * domain (lib/domain/comms/calls/recordings.ts) decides; this drives it.
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

export const storeCallRecordings = async (
  recordingIds: string[],
): Promise<string[]> => {
  "use workflow";
  const outcomes: string[] = [];
  for (const recordingId of recordingIds) {
    try {
      outcomes.push(await storeOne(recordingId));
    } catch {
      outcomes.push("error");
    }
  }
  return outcomes;
};
