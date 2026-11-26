import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { cancelOwnerCall } from "@/lib/domain/comms/calls/owner-call";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Cancel a scheduled agent call before it rings. ADMIN only. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ ownerCallId: string }> },
) {
  const { ownerCallId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await cancelOwnerCall(principal, { ownerCallId }, prisma),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[agent-calls] Cancelling an agent call failed", error);
    return errorResponse("Could not cancel the call.", {
      code: "AGENT_CALL_CANCEL_FAILED",
      status: 500,
    });
  }
}
