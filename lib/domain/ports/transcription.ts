import type { TranscriptSpeakerLabel } from "../comms/calls/transcript-lines";

/**
 * One stretch of speech on one channel of a two-channel recording. Channel 0
 * is the customer's leg; channel 1 is what was played to them.
 */
export type TranscriptSegment = {
  readonly channel: 0 | 1;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly text: string;
};

/**
 * Speech-to-text for a stored call recording or voicemail.
 *
 * A port because the reader (Blob storage) and the model (the AI Gateway) are
 * SDKs and network calls the domain may not import. The implementation reads
 * the stored copy itself, so the domain never handles the audio bytes.
 *
 * - Resolves with the words heard, in reading order. An empty string means the
 *   audio held no speech; that is an answer, not a failure.
 * - Resolves `null` when the stored copy is gone (a miss in storage).
 * - A thrown error is a failure to transcribe: the domain records it and tries
 *   again, a bounded number of times.
 * - With `splitChannels`, a two-channel recording is transcribed a channel at
 *   a time and comes back with `segments` as well (#613). A recording that is
 *   not two channels, or cannot be split, comes back as one text without
 *   them, and the domain falls back to splitting the prose.
 */
export type CallTranscriptionPort = (audio: {
  readonly blobUrl: string;
  readonly mimeType: string | null;
  readonly kind: "CALL" | "VOICEMAIL";
  readonly splitChannels?: true;
}) => Promise<{
  readonly text: string;
  /** Present only when the channels were transcribed apart. */
  readonly segments?: readonly TranscriptSegment[];
} | null>;

/**
 * Splits a recording's transcript into turns by who is speaking.
 *
 * Speech-to-text returns one block of prose with no speakers, so a text model
 * reads it and says where each turn starts and who says it. The domain checks
 * the answer (every word kept, in order, only the labels it offered) and keeps
 * the plain text if it is wrong, so this port can only ever add labels.
 *
 * - Resolves with the turns, in order, each labelled with one of `speakers`.
 * - A thrown error means no split; the plain transcript is kept.
 */
export type TranscriptSpeakerPort = (input: {
  readonly text: string;
  readonly speakers: readonly TranscriptSpeakerLabel[];
  /** Who is on this call, in a sentence, for the model. */
  readonly context: string;
}) => Promise<readonly { readonly speaker: string; readonly text: string }[]>;
