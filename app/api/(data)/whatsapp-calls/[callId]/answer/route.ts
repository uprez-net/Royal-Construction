import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { answerWhatsAppCall } from "@/lib/domain/whatsapp/calls";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Answer a ringing WhatsApp call with the browser's SDP answer. The first
 * browser to claim it wins; a second is told someone already has it.
 */
const bodySchema = z.object({ sdpAnswer: z.string().min(10).max(20_000) });

export async function POST(request: NextRequest, ctx: { params: Promise<{ callId: string }> }) {
  const { callId } = await ctx.params;
  const parsed = await parseBodyWithResponse(request, bodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const call = await answerWhatsAppCall(
      principal,
      { callId, sdpAnswer: parsed.data.sdpAnswer },
      prisma,
      { whatsapp: createWhatsAppPortFromEnv() },
    );
    return successResponse(call);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Answer failed", error);
    return errorResponse("The call couldn't be answered.", { code: "WHATSAPP_CALL_ANSWER_FAILED", status: 500 });
  }
}
