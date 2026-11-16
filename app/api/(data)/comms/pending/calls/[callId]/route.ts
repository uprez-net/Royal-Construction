import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { resolvePendingCall } from "@/lib/domain/comms/pending";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** File a pending call onto a lead, or dismiss it. */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attach"),
    leadId: z.number().int().positive(),
  }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ callId: string }> },
) {
  const { callId } = await ctx.params;
  const parsed = await parseBodyWithResponse(request, bodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const call = await resolvePendingCall(
      principal,
      { ...parsed.data, callId },
      prisma,
    );
    return successResponse({ call });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Filing a pending call failed", error);
    return errorResponse("Could not file the call.", {
      code: "CALL_FILE_FAILED",
      status: 500,
    });
  }
}
