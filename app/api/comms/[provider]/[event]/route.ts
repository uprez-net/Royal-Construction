import { start } from "workflow/api";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { handleCommsWebhook } from "@/lib/comms/webhook-handler";
import prisma from "@/lib/prisma";
import { storeCallRecordings } from "@/lib/workflow/call-recording";

/**
 * SMS and call callbacks from Twilio or Telnyx (docs/twilio-plivo-comms/06).
 *
 * Public: the carrier calls it with no session, so it is listed in proxy.ts
 * and authenticates on its own — the carrier's signature over the exact URL
 * and raw body. Everything lives in lib/comms/webhook-handler.ts (transport)
 * and lib/domain/comms (what a text or a call event means); this file only
 * supplies the database, the configuration and the recording workflow.
 * docs/comms-runbook.md lists the URL to give each carrier.
 *
 * No `runtime`/`dynamic` export: Cache Components rejects them.
 */

// Twilio waits for call XML on the voice-* events; keep well inside its
// fifteen-second limit. Telnyx command calls fit in the same budget.
export const maxDuration = 15;

export async function POST(
  request: Request,
  ctx: { params: Promise<{ provider: string; event: string }> },
): Promise<Response> {
  return handleCommsWebhook(request, await ctx.params, {
    db: prisma,
    onRecordingRecorded: async (recordingIds) => {
      await start(storeCallRecordings, [[...recordingIds]]);
    },
    runtime: commsRuntimeFromEnv(),
  });
}
