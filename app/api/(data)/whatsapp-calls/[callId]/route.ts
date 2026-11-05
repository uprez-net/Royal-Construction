import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { getWhatsAppCall } from "@/lib/domain/whatsapp/calls";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse, unauthorizedResponse } from "@/utils/validators/response";

/** One WhatsApp call: its state, and Meta's SDP answer once an outbound call is picked up. */
export async function GET(_request: Request, ctx: { params: Promise<{ callId: string }> }) {
  const { callId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(await getWhatsAppCall(principal, { callId }, prisma));
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Failed to load a call", error);
    return errorResponse("Could not load the call.", { code: "WHATSAPP_CALL_FAILED", status: 500 });
  }
}
