import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { endWhatsAppCall } from "@/lib/domain/leads/whatsapp/calls";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Hang up a WhatsApp call, or cancel one still ringing the customer. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ callId: string }> },
) {
  const { callId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await endWhatsAppCall(principal, { callId }, prisma, {
        whatsapp: createWhatsAppPortFromEnv(),
      }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Hang up failed", error);
    return errorResponse("The call couldn't be ended.", {
      code: "WHATSAPP_CALL_HANGUP_FAILED",
      status: 500,
    });
  }
}
