import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { endCall } from "@/lib/domain/comms/calls/outbound";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Hang up a call from the CRM — cancel it while the customer's phone rings,
 * or end it once answered. The provider that placed it ends it.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ callId: string }> },
) {
  const { callId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const runtime = commsRuntimeFromEnv();
    return successResponse(
      await endCall(principal, { callId }, prisma, {
        voiceFor: runtime.voiceFor,
      }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Hang up failed", error);
    return errorResponse(
      "The call could not be ended. Hang up on the phone itself.",
      {
        code: "CALL_HANGUP_FAILED",
        status: 500,
      },
    );
  }
}
