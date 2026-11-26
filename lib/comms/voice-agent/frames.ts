import type { CommsProviderName } from "@/lib/domain/ports/comms";

// The carriers' media-stream frames, as the relay sees them.
//
// Both carriers send JSON text frames over the WebSocket they open to the
// relay, with base64 8 kHz μ-law audio, and accept audio back. The shapes
// differ in small ways:
//
//                Twilio Media Streams          Telnyx media streaming
//   start        start.callSid, streamSid,     start.call_control_id,
//                start.customParameters        stream_id
//   send audio   { event, streamSid, media }   { event, media }
//
// Field names are from the carriers' docs, not a captured stream: VERIFY
// against one real session per carrier and add the frames to tests/comms.

export type CarrierFrame =
  | {
      readonly kind: "start";
      /** Twilio CallSid / Telnyx call_control_id. */
      readonly providerCallId: string | null;
      readonly streamId: string | null;
      /** Twilio passes it in customParameters; Telnyx in the URL instead. */
      readonly token: string | null;
    }
  | { readonly kind: "media"; readonly payload: string }
  | { readonly kind: "stop" }
  | { readonly kind: "other" };

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCarrierFrame(
  dialect: CommsProviderName,
  raw: string,
): CarrierFrame {
  let frame: Json;
  try {
    frame = object(JSON.parse(raw));
  } catch {
    return { kind: "other" };
  }
  switch (frame.event) {
    case "start": {
      const start = object(frame.start);
      if (dialect === "twilio") {
        const custom = object(start.customParameters);
        return {
          kind: "start",
          providerCallId: text(start.callSid),
          streamId: text(start.streamSid) ?? text(frame.streamSid),
          token: text(custom.token),
        };
      }
      return {
        kind: "start",
        providerCallId: text(start.call_control_id),
        streamId: text(frame.stream_id),
        token: null,
      };
    }
    case "media": {
      const media = object(frame.media);
      const track = text(media.track);
      // Only the caller: Mili must never hear herself back.
      if (track && track !== "inbound" && track !== "inbound_track") {
        return { kind: "other" };
      }
      const payload = text(media.payload);
      return payload ? { kind: "media", payload } : { kind: "other" };
    }
    case "stop":
      return { kind: "stop" };
    default:
      return { kind: "other" };
  }
}

/**
 * Drop the audio the carrier has queued but not yet played: hold music stops
 * the moment Mili speaks again. Both carriers take a "clear" event.
 */
export function carrierClearFrame(
  dialect: CommsProviderName,
  streamId: string | null,
): string {
  return JSON.stringify(
    dialect === "twilio"
      ? { event: "clear", streamSid: streamId }
      : { event: "clear" },
  );
}

/** One frame of Mili's audio (base64 μ-law) for the carrier to play. */
export function carrierMediaFrame(
  dialect: CommsProviderName,
  streamId: string | null,
  payload: string,
): string {
  return JSON.stringify(
    dialect === "twilio"
      ? { event: "media", media: { payload }, streamSid: streamId }
      : { event: "media", media: { payload } },
  );
}
