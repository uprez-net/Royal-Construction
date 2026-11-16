import { CallRecordingStatus, CallTranscriptStatus } from "@prisma/client";

import type { DomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
} from "../../errors";
import type { CallTranscriptionPort } from "../../ports/transcription";
import type { DomainPrincipal } from "../../principal";

// Turning a stored call recording or voicemail into text.
//
// Every recording Royal keeps is transcribed once it is stored: outbound calls
// (recorded when announced), every inbound call (Mili's included — her live
// transcript is kept separately and can be lost if the call's function is cut
// off, so this is the copy that cannot be), and voicemails, which otherwise
// can only be listened to. Calls from a number no lead owns are transcribed the
// same as any other: the transcript is how the office decides where they go.
//
// The transcript is personal information like the audio, so it lives on the
// recording row and is served by the same staff-only routes.

export const MAX_TRANSCRIPT_ATTEMPTS = 3;
/**
 * The transcription model's upload limit. A larger file is SKIPPED with the
 * reason rather than sent and refused; at the carriers' MP3 bitrates this is
 * well over an hour of conversation.
 */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
/** Kept on the row, at most. A longer transcript keeps its start. */
export const MAX_TRANSCRIPT_CHARS = 100_000;

export type TranscribeRecordingOutcome =
  | "transcribed"
  | "empty"
  | "skipped"
  | "not_ready"
  | "already_done"
  | "gave_up";

export async function transcribeCallRecording(
  principal: DomainPrincipal,
  input: { readonly recordingId: string },
  db: DomainDb,
  ports: { readonly transcribe: CallTranscriptionPort },
): Promise<TranscribeRecordingOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Recordings are transcribed by the recording workflow only.",
    );
  }
  const recording = await db.callRecording.findUnique({
    select: {
      blobUrl: true,
      byteSize: true,
      id: true,
      kind: true,
      mimeType: true,
      status: true,
      transcriptAttempts: true,
      transcriptStatus: true,
    },
    where: { id: input.recordingId },
  });
  if (!recording) throw new DomainNotFoundError("Recording not found");
  if (recording.transcriptStatus === CallTranscriptStatus.FAILED) {
    return "gave_up";
  }
  if (recording.transcriptStatus !== CallTranscriptStatus.PENDING) {
    return "already_done";
  }
  // Not stored yet (or never will be): the sweep comes back once it is.
  if (recording.status !== CallRecordingStatus.STORED || !recording.blobUrl) {
    return "not_ready";
  }
  if (
    recording.byteSize !== null
    && recording.byteSize > MAX_TRANSCRIBE_BYTES
  ) {
    await db.callRecording.update({
      data: {
        transcriptFailure: "This recording is too long to transcribe.",
        transcriptStatus: CallTranscriptStatus.SKIPPED,
      },
      where: { id: recording.id },
    });
    return "skipped";
  }

  const attempts = recording.transcriptAttempts + 1;
  await db.callRecording.update({
    data: { transcriptAttempts: attempts },
    where: { id: recording.id },
  });

  let result;
  try {
    result = await ports.transcribe({
      blobUrl: recording.blobUrl,
      kind: recording.kind,
      mimeType: recording.mimeType,
    });
  } catch (error) {
    const retryable = attempts < MAX_TRANSCRIPT_ATTEMPTS;
    const reason = "The recording couldn't be transcribed.";
    await db.callRecording.update({
      data: retryable
        ? { transcriptFailure: reason }
        : {
            transcriptFailure: reason,
            transcriptStatus: CallTranscriptStatus.FAILED,
          },
      where: { id: recording.id },
    });
    throw new DomainSideEffectError(reason, "transcription", retryable, {
      cause: error,
    });
  }
  if (result === null) {
    // Our copy is missing: nothing to transcribe until the recording is
    // stored again, and retrying the model would not help.
    await db.callRecording.update({
      data: {
        transcriptFailure: "The stored recording couldn't be found.",
        transcriptStatus: CallTranscriptStatus.FAILED,
      },
      where: { id: recording.id },
    });
    return "gave_up";
  }

  const text = normaliseTranscript(result.text);
  await db.callRecording.update({
    data: {
      transcribedAt: new Date(),
      transcript: text || null,
      transcriptFailure: null,
      transcriptStatus: text
        ? CallTranscriptStatus.DONE
        : CallTranscriptStatus.EMPTY,
    },
    where: { id: recording.id },
  });
  return text ? "transcribed" : "empty";
}

/** Trimmed, runs of blank space folded, capped. */
export function normaliseTranscript(raw: string): string {
  const text = raw
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  return `${text.slice(0, MAX_TRANSCRIPT_CHARS - 2).trimEnd()} …`;
}
