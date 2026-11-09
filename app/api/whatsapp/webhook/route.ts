import { start } from "workflow/api";

import prisma from "@/lib/prisma";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  handleWhatsAppWebhookDelivery,
  handleWhatsAppWebhookVerification,
} from "@/lib/whatsapp/webhook-handler";
import { storeWhatsAppMediaFiles } from "@/lib/workflow/whatsapp-media";

/**
 * Meta WhatsApp Cloud API webhook (issue #333).
 *
 * Public: Meta calls it with no session, so it is listed in proxy.ts and
 * authenticates on its own — the verify token for the GET handshake, the
 * `X-Hub-Signature-256` HMAC for every POST. The rules live in
 * lib/whatsapp/webhook-handler.ts (transport) and lib/domain/leads/whatsapp
 * (what a message or status means); this file only supplies the database and
 * the configuration. docs/whatsapp-runbook.md covers setting it up.
 *
 * No `runtime`/`dynamic` export: Cache Components rejects them, and every
 * route is dynamic already.
 */

// Recording a delivery is a handful of short transactions; the budget is for
// a large batch after an outage, when Meta replays everything it held.
export const maxDuration = 60;

export function GET(request: Request): Response {
  return handleWhatsAppWebhookVerification(request, readWhatsAppConfig());
}

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppWebhookDelivery(request, {
    config: readWhatsAppConfig(),
    db: prisma,
    // Photos, voice notes and documents are copied into Blob storage by a
    // workflow, after the delivery is committed (lib/workflow/whatsapp-media.ts).
    onMediaRecorded: async (mediaIds) => {
      await start(storeWhatsAppMediaFiles, [[...mediaIds]]);
    },
  });
}
