import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { sendProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/send";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

const sendSchema = z.object({ body: z.string().max(10_000) });

/**
 * Send one message into a project's WhatsApp group.
 *
 * `Idempotency-Key` is required: the comms tab mints one per composed message
 * and keeps it until the send succeeds, so a double click or a retry after a
 * timeout is one message in the group. `alreadySent: true` means nothing went
 * out this time.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse(
      "An Idempotency-Key header is required so a retry cannot message the group twice.",
    );
  }
  const parsed = await parseBodyWithResponse(request, sendSchema);
  if (!parsed.success) return parsed.response;

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await sendProjectWhatsAppMessage(
      principal,
      { body: parsed.data.body, idempotencyKey, projectId },
      prisma,
      { whatsapp: createWhatsAppPortFromEnv() },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Group send failed unexpectedly", error);
    return errorResponse(
      "The message could not be sent, and its outcome is unknown. Reload the conversation before trying again.",
      { code: "PROJECT_WHATSAPP_SEND_FAILED", status: 500 },
    );
  }
}
