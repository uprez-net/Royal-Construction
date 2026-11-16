import { transcribe } from "ai";

import { readStoredBlob } from "@/lib/blob-port";
import type { CallTranscriptionPort } from "@/lib/domain/ports/transcription";
import { gateway, TRANSCRIPTION_MODEL_ID } from "@/lib/model";

/**
 * The AI Gateway implementation of the domain's transcription port.
 *
 * Reads Royal's own stored copy (public or private Blob store — the carrier's
 * copy is already deleted) and sends it to the speech-to-text model. The model
 * is told what it is listening to, so the trade words and names Royal's calls
 * are full of ("knockdown rebuild", "HBCF", "Mili") come out spelled right.
 * A failed model call is reported by the wrapped gateway in lib/model.ts.
 */
export const gatewayCallTranscription: CallTranscriptionPort = async (
  audio,
) => {
  const stored = await readStoredBlob(audio.blobUrl);
  if (!stored) return null;
  const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());
  const result = await transcribe({
    audio: bytes,
    model: gateway.transcription(TRANSCRIPTION_MODEL_ID),
    providerOptions: {
      openai: {
        language: "en",
        prompt:
          audio.kind === "VOICEMAIL"
            ? "A voicemail left for Royal Constructions, a residential home builder in Sydney, Australia. Australian English."
            : "A phone call with Royal Constructions, a residential home builder in Sydney, Australia. Mili is the company's virtual receptionist. Topics: new homes, knockdown rebuilds, extensions, renovations, quotes, site visits, HBCF insurance, tradies. Australian English.",
      },
    },
  });
  return { text: result.text };
};
