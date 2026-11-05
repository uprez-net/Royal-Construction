import type { NextRequest } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { parsePositiveId, signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { requestLeadCall } from "@/lib/domain/comms/calls/outbound";
import { getLeadCalls } from "@/lib/domain/comms/calls/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * A lead's calls and whether they can be rung now (GET); ringing them (POST).
 *
 * POST needs an `Idempotency-Key` (one per press of Call, kept until the call
 * is placed): a double click or a retry rings the customer once.
 * `target` is where the member of staff takes it — their browser, or the
 * office mobile. `alreadyPlaced: true` means nothing new rang.
 */

const placeBodySchema = z.object({ target: z.enum(["browser", "mobile"]) });

export async function GET(_request: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await getLeadCalls(principal, { leadId }, prisma, { channel: commsRuntimeFromEnv().channel }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Failed to load a lead's calls", error);
    return errorResponse("Could not load the calls.", { code: "CALLS_LOAD_FAILED", status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse(
      "An Idempotency-Key header is required so a retry cannot ring the customer twice.",
    );
  }
  const parsed = await parseBodyWithResponse(request, placeBodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const runtime = commsRuntimeFromEnv();
    const result = await requestLeadCall(
      principal,
      { idempotencyKey, leadId, target: parsed.data.target },
      prisma,
      { channel: runtime.channel, voice: runtime.voice },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Placing a call failed unexpectedly", error);
    return errorResponse(
      "The call could not be placed, and whether the customer's phone rang is unknown. Check the call list before trying again.",
      { code: "CALL_PLACE_FAILED", status: 500 },
    );
  }
}
