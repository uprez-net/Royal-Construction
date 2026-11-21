import { start } from "workflow/api";

import prisma from "@/lib/prisma";
import { readWhatsAppBridgeConfig } from "@/lib/whatsapp-bridge/config";
import { handleWhatsAppBridgeWebhook } from "@/lib/whatsapp-bridge/webhook-handler";
import { storeWhatsAppMediaFiles } from "@/lib/workflow/whatsapp-media";

/**
 * Events from Royal's WhatsApp bridge (services/whatsapp-bridge): messages in
 * project groups, delivery ticks, group changes and the session's state.
 *
 * Public: the bridge calls it with no session, so it is listed in proxy.ts and
 * authenticates every POST itself — an HMAC over the timestamp and the raw
 * body (lib/whatsapp-bridge/webhook-signature.ts). The rules live in
 * lib/whatsapp-bridge/webhook-handler.ts and lib/domain/projects/whatsapp;
 * docs/whatsapp-bridge.md is the contract.
 */

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppBridgeWebhook(request, {
    config: readWhatsAppBridgeConfig(),
    db: prisma,
    // The bridge downloaded the file; a workflow copies it into Blob storage.
    onMediaRecorded: async (mediaIds) => {
      await start(storeWhatsAppMediaFiles, [[...mediaIds]]);
    },
  });
}
