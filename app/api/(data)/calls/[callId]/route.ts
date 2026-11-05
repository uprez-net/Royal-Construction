import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { getCall } from "@/lib/domain/comms/calls/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse, unauthorizedResponse } from "@/utils/validators/response";

/** One call: who is ringing the dialer, and how a call went. */
export async function GET(_request: Request, ctx: { params: Promise<{ callId: string }> }) {
  const { callId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(await getCall(principal, { callId }, prisma));
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Failed to load a call", error);
    return errorResponse("Could not load the call.", { code: "CALL_LOAD_FAILED", status: 500 });
  }
}
