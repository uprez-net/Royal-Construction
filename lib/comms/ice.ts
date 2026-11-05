import type { CommsRuntime } from "./factory";
import type { IceServer } from "./types";

// ICE servers for a staff browser's WebRTC leg (WhatsApp calling).
//
// A browser usually reaches WhatsApp's media servers directly; TURN is the
// fallback for networks that block outbound UDP. In order of preference:
// static TURN from the environment (any provider, e.g. Telnyx or a hosted
// coturn), then the phone provider's own TURN service when it has one
// (Twilio's Network Traversal Service), then public STUN alone.

const STUN: IceServer = { urls: "stun:stun.l.google.com:19302" };
const CACHE_MS = 45 * 60 * 1000;

let cached: { servers: readonly IceServer[]; until: number } | null = null;

export async function browserIceServers(
  runtime: Pick<CommsRuntime, "channel" | "adapterFor">,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<readonly IceServer[]> {
  const urls = env.WHATSAPP_CALL_TURN_URLS?.split(",").map((url) => url.trim()).filter(Boolean) ?? [];
  if (urls.length > 0) {
    return [
      STUN,
      {
        credential: env.WHATSAPP_CALL_TURN_CREDENTIAL?.trim() || undefined,
        urls,
        username: env.WHATSAPP_CALL_TURN_USERNAME?.trim() || undefined,
      },
    ];
  }
  if (cached && cached.until > now) return cached.servers;
  const adapter = runtime.channel ? runtime.adapterFor(runtime.channel.provider) : null;
  if (!adapter?.iceServers) return [STUN];
  try {
    const servers = [STUN, ...(await adapter.iceServers())];
    cached = { servers, until: now + CACHE_MS };
    return servers;
  } catch {
    console.warn("[whatsapp-calls] TURN credentials unavailable; browsers fall back to STUN.");
    return [STUN];
  }
}
