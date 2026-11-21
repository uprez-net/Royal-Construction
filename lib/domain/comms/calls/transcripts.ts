import {
  CallAnsweredBy,
  CallRecordingStatus,
  CallTranscriptStatus,
  CommsDirection,
  type Prisma,
} from "@prisma/client";

import type { DomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
} from "../../errors";
import type {
  CallTranscriptionPort,
  TranscriptSpeakerPort,
} from "../../ports/transcription";
import type { DomainPrincipal } from "../../principal";
import type { TranscriptSpeakerLabel } from "./transcript-lines";

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
//
// Speech-to-text gives one block of prose with nobody's name on it. A call
// recording is then split by speaker ("Royal: …" / "Caller: …", one line per
// turn, as Mili's live transcript is) when the split keeps every word in
// order; otherwise, or if the split fails, the prose is kept as it came.

export const MAX_TRANSCRIPT_ATTEMPTS = 3;
/**
 * The largest recording sent for transcription. The gateway takes the audio
 * as base64 in one JSON request, so a larger file is SKIPPED with the reason
 * rather than sent and refused; at the carriers' MP3 bitrates this is well
 * over an hour of conversation.
 */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
/** Kept on the row, at most. A longer transcript keeps its start. */
export const MAX_TRANSCRIPT_CHARS = 100_000;
/**
 * A longer transcript is kept as prose: splitting it means the model writing
 * the whole call back out, which is slow and costly past half an hour or so.
 */
export const MAX_SPEAKER_SPLIT_CHARS = 30_000;

export type TranscribeRecordingOutcome =
  | "transcribed"
  | "empty"
  | "skipped"
  | "not_ready"
  | "already_done"
  | "gave_up"
  /** Another run (the webhook's, the sweep's, a retry) holds this recording. */
  | "superseded";

export async function transcribeCallRecording(
  principal: DomainPrincipal,
  input: { readonly recordingId: string },
  db: DomainDb,
  ports: {
    readonly transcribe: CallTranscriptionPort;
    /** Absent: the transcript is kept as prose. */
    readonly speakers?: TranscriptSpeakerPort;
  },
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
      call: { select: { answeredBy: true, direction: true } },
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
  // Every write from here is conditional on the attempt count it read, so the
  // webhook's run, the daily sweep and a retry overlapping on one recording
  // cannot both call the model, and the loser's result never overwrites the
  // winner's.
  const settle = async (
    attempt: number,
    data: Prisma.CallRecordingUpdateManyMutationInput,
  ): Promise<boolean> => {
    const result = await db.callRecording.updateMany({
      data,
      where: {
        id: recording.id,
        transcriptAttempts: attempt,
        transcriptStatus: CallTranscriptStatus.PENDING,
      },
    });
    return result.count === 1;
  };

  if (
    recording.byteSize !== null
    && recording.byteSize > MAX_TRANSCRIBE_BYTES
  ) {
    const applied = await settle(recording.transcriptAttempts, {
      transcriptFailure: "This recording is too long to transcribe.",
      transcriptStatus: CallTranscriptStatus.SKIPPED,
    });
    return applied ? "skipped" : "superseded";
  }

  const attempts = recording.transcriptAttempts + 1;
  if (
    !(await settle(recording.transcriptAttempts, {
      transcriptAttempts: attempts,
    }))
  ) {
    return "superseded";
  }

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
    const applied = await settle(
      attempts,
      retryable
        ? { transcriptFailure: reason }
        : {
            transcriptFailure: reason,
            transcriptStatus: CallTranscriptStatus.FAILED,
          },
    );
    // A later run has claimed it: that run retries, not this one.
    if (!applied) return "superseded";
    throw new DomainSideEffectError(reason, "transcription", retryable, {
      cause: error,
    });
  }
  if (result === null) {
    // Our copy is missing: nothing to transcribe until the recording is
    // stored again, and retrying the model would not help.
    const applied = await settle(attempts, {
      transcriptFailure: "The stored recording couldn't be found.",
      transcriptStatus: CallTranscriptStatus.FAILED,
    });
    return applied ? "gave_up" : "superseded";
  }

  const plain = normaliseTranscript(result.text);
  const text = plain
    ? await splitBySpeaker(plain, recording, ports.speakers)
    : plain;
  const applied = await settle(attempts, {
    transcribedAt: new Date(),
    transcript: text || null,
    transcriptFailure: null,
    transcriptStatus: text
      ? CallTranscriptStatus.DONE
      : CallTranscriptStatus.EMPTY,
  });
  if (!applied) return "superseded";
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

type RecordingCall = {
  readonly answeredBy: CallAnsweredBy | null;
  readonly direction: CommsDirection;
} | null;

/**
 * Who may be speaking on a recording, and a sentence saying so for the model;
 * null for a voicemail, which is one voice.
 */
export function recordingSpeakers(recording: {
  readonly kind: string;
  readonly call?: RecordingCall;
}): {
  readonly speakers: readonly TranscriptSpeakerLabel[];
  readonly context: string;
} | null {
  const call = recording.call;
  if (recording.kind !== "CALL" || !call) return null;
  if (call.answeredBy === CallAnsweredBy.AGENT) {
    return {
      context:
        "An inbound phone call to Royal Constructions, a home builder, answered by Mili, its virtual receptionist. Caller is whoever rang. Royal is a person from the Royal team, if Mili put the caller through, and any recorded announcement.",
      speakers: ["Mili", "Caller", "Royal"],
    };
  }
  if (call.direction === CommsDirection.OUTBOUND) {
    return {
      context:
        "An outbound phone call from someone on the Royal Constructions team (Royal) to a client, tradie or other contact (Contact). A recorded announcement counts as Royal.",
      speakers: ["Royal", "Contact"],
    };
  }
  return {
    context:
      "An inbound phone call to Royal Constructions answered by someone on the Royal team (Royal). Caller is whoever rang. A recorded announcement counts as Royal.",
    speakers: ["Royal", "Caller"],
  };
}

/**
 * Lower-cased words and numbers, other punctuation and spacing ignored. A
 * number keeps its sign, currency and separators ("$1,500", "1.5", "-3",
 * "10%", "9:30"), so a split that turns "$1,500" into "$1.500" or drops the
 * "$" does not match.
 */
function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[$£€+\-−]?\p{N}+(?:[.,:/'\-]\p{N}+)*%?|[\p{L}\p{M}]+/gu) ?? []
  );
}

/**
 * The split as "Speaker: text" lines, a speaker's consecutive turns joined;
 * null unless it uses only the offered labels and keeps every word of the
 * transcript, in order, adding none. Punctuation may differ.
 */
export function speakerLines(
  transcript: string,
  turns: readonly { readonly speaker: string; readonly text: string }[],
  speakers: readonly TranscriptSpeakerLabel[],
): string | null {
  const merged: { speaker: TranscriptSpeakerLabel; text: string }[] = [];
  for (const turn of turns) {
    const said = turn.text.replace(/\s+/g, " ").trim();
    if (!said) continue;
    const speaker = speakers.find((label) => label === turn.speaker);
    if (!speaker) return null;
    const last = merged.at(-1);
    if (last?.speaker === speaker) last.text = `${last.text} ${said}`;
    else merged.push({ speaker, text: said });
  }
  if (merged.length === 0) return null;
  const expected = words(transcript);
  const got = words(merged.map((turn) => turn.text).join(" "));
  if (
    expected.length !== got.length
    || expected.some((word, index) => word !== got[index])
  ) {
    return null;
  }
  return merged.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
}

/** The transcript by speaker, or as it came when it cannot be split safely. */
async function splitBySpeaker(
  transcript: string,
  recording: {
    readonly id: string;
    readonly kind: string;
    readonly call?: RecordingCall;
  },
  port: TranscriptSpeakerPort | undefined,
): Promise<string> {
  const who = recordingSpeakers(recording);
  if (!port || !who || transcript.length > MAX_SPEAKER_SPLIT_CHARS) {
    return transcript;
  }
  try {
    const turns = await port({
      context: who.context,
      speakers: who.speakers,
      text: transcript,
    });
    const lines = speakerLines(transcript, turns, who.speakers);
    if (lines) return lines;
    console.warn(
      `[transcripts] the speaker split of recording ${recording.id} did not keep the transcript's words; keeping it as prose.`,
    );
  } catch (error) {
    // A failed model call is reported by the wrapped gateway; the transcript
    // is still good, just not split.
    console.warn(
      `[transcripts] recording ${recording.id} could not be split by speaker (${
        error instanceof Error ? error.name : "error"
      }); keeping it as prose.`,
    );
  }
  return transcript;
}
