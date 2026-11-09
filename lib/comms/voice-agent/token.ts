import { createHmac, timingSafeEqual } from "node:crypto";

import type { CommsProviderName } from "@/lib/domain/ports/comms";

// The token that lets a carrier's media stream reach Mili.
//
// The voice-agent WebSocket route is public: Twilio and Telnyx open it with no
// session. When the app hands a call to Mili it signs a token for that one
// call under COMMS_AGENT_SECRET, and the carrier presents it (stream.ts says
// how each carrier carries it). A session starts only when the token is ours,
// unexpired, and names the call the carrier then says it is streaming — so
// nobody can run up AI Gateway spend, or listen in, by connecting to the
// route themselves.

/** A secret shorter than this is reported and the agent stays off. */
export const VOICE_AGENT_SECRET_MIN_LENGTH = 32;

export type StreamTokenClaims = {
  /** Royal's Call.id. */
  readonly callId: string;
  /** The carrier's id for the customer's leg (Telnyx call_control_id, Twilio CallSid). */
  readonly callControlId: string;
  /** The carrier streaming the call. */
  readonly provider: CommsProviderName;
  /** Unix seconds. */
  readonly expiresAt: number;
  /** The conversation's ceiling, in seconds. */
  readonly maxSeconds: number;
};

function b64url(bytes: Buffer | string): string {
  return Buffer.from(bytes).toString("base64url");
}

function mac(secret: string, text: string): Buffer {
  return createHmac("sha256", secret).update(text, "utf8").digest();
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signStreamToken(
  claims: StreamTokenClaims,
  secret: string,
): string {
  const body = b64url(
    JSON.stringify({
      c: claims.callId,
      cc: claims.callControlId,
      exp: claims.expiresAt,
      max: claims.maxSeconds,
      p: claims.provider,
    }),
  );
  return `${body}.${b64url(mac(secret, body))}`;
}

export function verifyStreamToken(
  token: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): StreamTokenClaims | null {
  if (!token || token.length > 2_000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!sameBytes(Buffer.from(signature, "base64url"), mac(secret, body))) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const { c, cc, exp, max, p } = parsed;
    if (
      typeof c !== "string"
      || !c
      || typeof cc !== "string"
      || !cc
      || typeof exp !== "number"
      || typeof max !== "number"
      || !Number.isFinite(max)
      || max <= 0
      || (p !== "twilio" && p !== "telnyx")
    ) {
      return null;
    }
    if (exp * 1000 < now.getTime()) return null;
    return {
      callControlId: cc,
      callId: c,
      expiresAt: exp,
      maxSeconds: max,
      provider: p,
    };
  } catch {
    return null;
  }
}
