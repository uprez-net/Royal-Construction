import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { markLeadSmsRead } from "@/lib/domain/comms/sms/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Mark a lead's inbound texts read, when someone opens the thread. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      marked: await markLeadSmsRead(principal, { leadId }, prisma),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[sms] Failed to mark a thread read", error);
    return errorResponse("Could not mark the texts read.", {
      code: "SMS_READ_FAILED",
      status: 500,
    });
  }
}
