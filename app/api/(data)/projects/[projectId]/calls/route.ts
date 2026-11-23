import type { NextRequest } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  getProjectCalls,
  requestProjectCall,
} from "@/lib/domain/comms/calls/project";
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
 * A project's phone (ADMIN only): its people, its calls, and whether a call
 * can be placed now (GET); ringing one of its people or a typed number (POST).
 *
 * POST needs an `Idempotency-Key` (one per press of Call, kept until the call
 * is placed): a double click or a retry rings once. `to` is a contact's
 * `ref` from the GET, resolved to their number on the server, or a typed
 * `number`. `target` and `phoneId` are as for a lead call.
 */

const placeBodySchema = z.object({
  phoneId: z.string().min(1).max(64).nullish(),
  target: z.enum(["browser", "mobile"]),
  to: z.union([
    z.object({ contactRef: z.string().min(1).max(120) }),
    z.object({ number: z.string().min(3).max(40) }),
  ]),
});

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await getProjectCalls(principal, { projectId }, prisma, {
        channel: commsRuntimeFromEnv().channel,
      }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Failed to load a project's calls", error);
    return errorResponse("Could not load the project's calls.", {
      code: "PROJECT_CALLS_LOAD_FAILED",
      status: 500,
    });
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse(
      "An Idempotency-Key header is required so a retry cannot ring anyone twice.",
    );
  }
  const parsed = await parseBodyWithResponse(request, placeBodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const runtime = commsRuntimeFromEnv();
    return successResponse(
      await requestProjectCall(
        principal,
        {
          idempotencyKey,
          phoneId: parsed.data.phoneId ?? null,
          projectId,
          target: parsed.data.target,
          to: parsed.data.to,
        },
        prisma,
        { channel: runtime.channel, voice: runtime.voice },
      ),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Placing a project call failed unexpectedly", error);
    return errorResponse(
      "The call could not be placed, and whether the phone rang is unknown. Check the project's calls before trying again.",
      { code: "CALL_PLACE_FAILED", status: 500 },
    );
  }
}
