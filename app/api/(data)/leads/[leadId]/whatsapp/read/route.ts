import prisma from "@/lib/prisma";
import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { markLeadWhatsAppRead } from "@/lib/domain/leads/whatsapp/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Clear a lead's WhatsApp unread count once the thread has been opened. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    await markLeadWhatsAppRead(principal, { leadId }, prisma);
    return successResponse({ leadId, unreadCount: 0 });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to mark a thread read", error);
    return errorResponse("Could not mark the conversation as read.", {
      code: "WHATSAPP_READ_FAILED",
      status: 500,
    });
  }
}
