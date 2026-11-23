import { connection } from "next/server";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listAdminInboundCalls } from "@/lib/domain/comms/calls/queries";
import { listUnmatchedSms } from "@/lib/domain/comms/sms/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Texts and calls from numbers that matched no single lead, waiting for a
 * person; and calls from the team's own numbers, under whose they are.
 */
export async function GET() {
  // Per request, never prerendered: the answer depends on who is asking.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const [sms, calls] = await Promise.all([
      listUnmatchedSms(principal, prisma),
      listAdminInboundCalls(principal, prisma, {
        channel: commsRuntimeFromEnv().channel,
      }),
    ]);
    return successResponse({
      calls: calls.unknown,
      sms,
      teamCalls: calls.team,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Failed to load the review queue", error);
    return errorResponse("Could not load unmatched texts and calls.", {
      code: "COMMS_UNMATCHED_FAILED",
      status: 500,
    });
  }
}
