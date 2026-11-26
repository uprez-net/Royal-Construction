import { experimental_upgradeWebSocket } from "@vercel/functions";
import { connection } from "next/server";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { handleVoiceAgentStream } from "@/lib/comms/voice-agent/stream-handler";
import prisma from "@/lib/prisma";

/**
 * Mili, the voice agent: Twilio or Telnyx opens a WebSocket here for an
 * answered call — inbound, or her own call to the owner line — and streams
 * its audio both ways.
 *
 * Public: the carrier has no session, so it is listed in proxy.ts and a
 * session only starts for a token the app signed for that one call. Vercel
 * upgrades the request and keeps this function alive for the whole
 * conversation, so `maxDuration` bounds it — VOICE_AGENT_MAX_SECONDS (270 s)
 * ends an inbound conversation first, and OWNER_CALL_MAX_SECONDS (900 s) an
 * owner call. 1,000 s leaves room for setup, her goodbye and the report.
 * Above 800 s this is Vercel's extended-duration beta (Pro), which must be set
 * per function, as here. Everything lives in
 * lib/comms/voice-agent/stream-handler.ts.
 *
 * Only a Vercel deployment can upgrade; under `next dev` the stream is
 * refused and the call goes to the office mobile, then voicemail.
 *
 * No `runtime`/`dynamic` export: Cache Components rejects them.
 */

export const maxDuration = 1000;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  await connection();
  return handleVoiceAgentStream(request, await ctx.params, {
    db: prisma,
    runtime: commsRuntimeFromEnv(),
    upgrade: (handler) => experimental_upgradeWebSocket(handler),
  });
}
