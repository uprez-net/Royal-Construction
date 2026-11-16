import { NoTranscriptGeneratedError, transcribe } from "ai";

import { readStoredBlob } from "@/lib/blob-port";
import type { CallTranscriptionPort } from "@/lib/domain/ports/transcription";
import { gateway, TRANSCRIPTION_MODEL_ID } from "@/lib/model";

/** Names and trade terms the model should prefer when it hears them. */
const CONTEXT_BIAS = [
  "Royal Constructions",
  "Mili",
  "knockdown rebuild",
  "HBCF",
  "granny flat",
  "duplex",
  "DA",
  "CDC",
  "tradie",
  "site visit",
  "quote",
];

/**
 * The AI Gateway implementation of the domain's transcription port.
 *
 * Reads Royal's own stored copy (public or private Blob store — the carrier's
 * copy is already deleted) and sends it to the speech-to-text model. The model
 * is given the words Royal's calls are full of ("knockdown rebuild", "HBCF",
 * "Mili") as context bias, so they come out spelled right.
 * A failed model call is reported by the wrapped gateway in lib/model.ts.
 *
 * Silence is not a failure: a hang-up or an empty voicemail makes the SDK
 * throw NoTranscriptGeneratedError, which used to be retried three times and
 * then shown as "couldn't be transcribed". It is empty text, which the domain
 * records as EMPTY ("nobody said anything").
 */
export const gatewayCallTranscription: CallTranscriptionPort = async (
  audio,
) => {
  const stored = await readStoredBlob(audio.blobUrl);
  if (!stored) return null;
  const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());
  try {
    const result = await transcribe({
      audio: bytes,
      model: gateway.transcription(TRANSCRIPTION_MODEL_ID),
      // Keyed by the provider behind the gateway model (Mistral's Voxtral).
      providerOptions: {
        mistral: { contextBias: CONTEXT_BIAS, language: "en" },
      },
    });
    return { text: result.text };
  } catch (error) {
    if (NoTranscriptGeneratedError.isInstance(error)) return { text: "" };
    throw error;
  }
};
