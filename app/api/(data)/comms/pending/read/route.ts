import type { NextRequest } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { markPendingCommsRead } from "@/lib/domain/comms/pending";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Mark the pending items the window just showed as read. */
const bodySchema = z.object({
  callIds: z.array(z.string().min(1).max(64)).max(200),
  smsIds: z.array(z.string().min(1).max(64)).max(200),
});

export async function POST(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, bodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      marked: await markPendingCommsRead(principal, parsed.data, prisma, {
        channel: commsRuntimeFromEnv().channel,
      }),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Failed to mark pending items read", error);
    return errorResponse("Could not mark the calls and messages read.", {
      code: "COMMS_PENDING_READ_FAILED",
      status: 500,
    });
  }
}
