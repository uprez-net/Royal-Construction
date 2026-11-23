import { connection } from "next/server";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listPendingComms } from "@/lib/domain/comms/pending";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Calls Mili or the voicemail took, and texts, from numbers no lead owns. */
export async function GET() {
  // Per request, never prerendered: the answer depends on who is asking.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await listPendingComms(principal, prisma, {
        channel: commsRuntimeFromEnv().channel,
      }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Failed to load pending calls and messages", error);
    return errorResponse("Could not load pending calls and messages.", {
      code: "COMMS_PENDING_FAILED",
      status: 500,
    });
  }
}
