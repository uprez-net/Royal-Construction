import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { readOwnerCallDetail } from "@/lib/domain/comms/calls/owner-call";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * One agent call: its briefing, the call with its transcript and recordings,
 * and every event (scheduled, placed, each lookup and question to Hermes).
 * ADMIN only.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ ownerCallId: string }> },
) {
  await connection();
  const { ownerCallId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await readOwnerCallDetail(principal, { ownerCallId }, prisma),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[agent-calls] Loading an agent call failed", error);
    return errorResponse("Could not load the agent call.", {
      code: "AGENT_CALL_LOAD_FAILED",
      status: 500,
    });
  }
}
