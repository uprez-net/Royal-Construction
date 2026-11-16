import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { markLeadCommsRead } from "@/lib/domain/comms/unread";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Mark a lead's unread calls and texts read, when its Phone & SMS window opens. */
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
      marked: await markLeadCommsRead(principal, { leadId }, prisma),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[comms] Failed to mark a lead's calls and texts read",
      error,
    );
    return errorResponse("Could not mark the calls and texts read.", {
      code: "COMMS_READ_FAILED",
      status: 500,
    });
  }
}
