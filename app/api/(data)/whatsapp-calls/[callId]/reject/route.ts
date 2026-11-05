import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { rejectWhatsAppCall } from "@/lib/domain/leads/whatsapp/calls";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Decline a ringing WhatsApp call. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ callId: string }> },
) {
  const { callId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await rejectWhatsAppCall(principal, { callId }, prisma, {
        whatsapp: createWhatsAppPortFromEnv(),
      }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Reject failed", error);
    return errorResponse("The call couldn't be declined.", {
      code: "WHATSAPP_CALL_REJECT_FAILED",
      status: 500,
    });
  }
}
