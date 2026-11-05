import type { NextRequest } from "next/server";
import { z } from "zod";

import { parsePositiveId, signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { startWhatsAppCall } from "@/lib/domain/whatsapp/calls";
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

/**
 * Ring a lead on WhatsApp from this browser. The body is the browser's SDP
 * offer; Meta's answer arrives on the webhook and the dialer polls the call
 * for it. Needs the customer's permission, and an `Idempotency-Key` per press.
 */
const bodySchema = z.object({ sdpOffer: z.string().min(10).max(20_000) });

export async function POST(request: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse("An Idempotency-Key header is required so a retry cannot ring twice.");
  }
  const parsed = await parseBodyWithResponse(request, bodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await startWhatsAppCall(
        principal,
        { idempotencyKey, leadId, sdpOffer: parsed.data.sdpOffer },
        prisma,
        { whatsapp: createWhatsAppPortFromEnv() },
      ),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Placing a call failed", error);
    return errorResponse("The WhatsApp call couldn't be placed.", { code: "WHATSAPP_CALL_PLACE_FAILED", status: 500 });
  }
}
