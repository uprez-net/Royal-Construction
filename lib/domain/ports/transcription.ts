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
 */
export type CallTranscriptionPort = (audio: {
  readonly blobUrl: string;
  readonly mimeType: string | null;
  readonly kind: "CALL" | "VOICEMAIL";
}) => Promise<{ readonly text: string } | null>;
