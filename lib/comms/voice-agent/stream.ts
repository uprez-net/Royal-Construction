import { CommsError, type CommsProviderName } from "@/lib/domain/ports/comms";

import type { CommsConfig } from "../config";
import { signStreamToken } from "./token";

// Where a carrier streams a call for Mili, and the token that lets it in.
//
// Each carrier has its own path (/api/comms/voice-agent/twilio, …/telnyx)
// because their stream frames differ. The token travels the way the carrier
// allows: Telnyx keeps a query string on `stream_url`, Twilio drops it and
// passes `<Parameter>`s in its "start" frame instead.

/** How long after the stream starts its token still opens the route. */
const STREAM_TOKEN_GRACE_SECONDS = 5 * 60;

/** wss://<app>/api/comms/voice-agent/<provider> */
export function voiceAgentStreamUrl(
  origin: string,
  provider: CommsProviderName,
): string {
  const url = new URL(`/api/comms/voice-agent/${provider}`, origin);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.toString();
}

export function voiceAgentStream(
  config: CommsConfig,
  provider: CommsProviderName,
  call: {
    readonly callId: string | null;
    readonly providerCallId: string;
    readonly maxSeconds: number;
  },
  now: Date = new Date(),
): { readonly url: string; readonly token: string } {
  const { secret } = config.voiceAgent;
  const origin = config.webhookOrigin;
  if (!config.voiceAgent.enabled || !secret || !origin || !call.callId) {
    throw new CommsError(
      "Mili isn't configured in this runtime.",
      "config",
      "VOICE_AGENT_CONFIG",
    );
  }
  return {
    token: signStreamToken(
      {
        callControlId: call.providerCallId,
        callId: call.callId,
        expiresAt:
          Math.floor(now.getTime() / 1000)
          + call.maxSeconds
          + STREAM_TOKEN_GRACE_SECONDS,
        maxSeconds: call.maxSeconds,
        provider,
      },
      secret,
    ),
    url: voiceAgentStreamUrl(origin, provider),
  };
}
