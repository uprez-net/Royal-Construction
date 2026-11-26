import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listOwnerCalls } from "@/lib/domain/comms/calls/owner-call";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The calls Mili makes to the owner for Hermes (Admin → Agent calls): what is
 * still to ring, then the most recent. ADMIN only.
 */
export async function GET() {
  // Per request, never prerendered: the list is live.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(await listOwnerCalls(principal, prisma));
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[agent-calls] Loading the agent calls failed", error);
    return errorResponse("Could not load the agent calls.", {
      code: "AGENT_CALLS_LOAD_FAILED",
      status: 500,
    });
  }
}
