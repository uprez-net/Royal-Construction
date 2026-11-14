import type { NextRequest } from "next/server";
import { start } from "workflow/api";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { retryWhatsAppMedia } from "@/lib/domain/whatsapp/media";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { storeWhatsAppMediaFiles } from "@/lib/workflow/whatsapp-media";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Try copying a WhatsApp file into storage again, after it failed.
 *
 * The domain puts it back in the queue; the workflow does the copy. If the
 * workflow cannot be started the file stays queued and the daily sweep
 * copies it, so the answer says "queued", never "saved".
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    await retryWhatsAppMedia(principal, { mediaId }, prisma);
    let started = true;
    try {
      await start(storeWhatsAppMediaFiles, [[mediaId]]);
    } catch (error) {
      started = false;
      console.error("[whatsapp] Could not start the media workflow", error);
    }
    return successResponse({ queued: true, started });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Media retry failed", error);
    return errorResponse("Could not retry the file.", {
      code: "WHATSAPP_MEDIA_RETRY_FAILED",
      status: 500,
    });
  }
}
